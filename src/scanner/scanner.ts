import { ethers } from 'ethers';
import { ChainConfig } from '../chains';
import { logger } from '../logger';
import { FeeCollectedEventModel } from '../db/models/FeeCollectedEvent';
import { ScanStateModel } from '../db/models/ScanState';
import { fetchFeeEvents, ParsedFeeCollectedEvent } from './fetchEvents';
import { revalidateRecentWindow } from './reorg';
import { isRangeTooLarge } from '../retry';

export const MIN_CHUNK_SIZE = 16;
const PROGRESS_LOG_EVERY_N_CHUNKS = 100;

export type ScanRange = { from: number; to: number };

export type ScanSummary = {
  chunksProcessed: number;
  totalEventsFound: number;
  totalUpsertedCount: number;
  totalAlreadyPresentCount: number;
  blocksAdvanced: number;
  durationMs: number;
};

export type ScanInputs = {
  chain: ChainConfig;
  contract: ethers.Contract;
  fromBlock: number;
  toBlock: number;
  cancelled?: () => boolean;
  // last block we finished in the previous run
  // used to re-check recent blocks for reorgs
  previousLastScannedBlock?: number;
};

// for normal scan we use $setOnInsert so duplicate events are ignored
// reorg code uses $set because old rows may need block data updates
const buildUpsertOps = (
  events: ParsedFeeCollectedEvent[],
): {
  updateOne: {
    filter: { chainId: number; txHash: string; logIndex: number };
    update: { $setOnInsert: ParsedFeeCollectedEvent };
    upsert: true;
  };
}[] =>
  events.map((e) => ({
    updateOne: {
      filter: { chainId: e.chainId, txHash: e.txHash, logIndex: e.logIndex },
      update: { $setOnInsert: e },
      upsert: true,
    },
  }));

type BulkResult = { upsertedCount: number; matchedCount: number };

export const writeBatch = async (events: ParsedFeeCollectedEvent[]): Promise<BulkResult> => {
  if (events.length === 0) return { upsertedCount: 0, matchedCount: 0 };
  const ops = buildUpsertOps(events);
  const res = await FeeCollectedEventModel.bulkWrite(ops, { ordered: false });
  // ordered:false can still return write errors
  // fail here so scan_state does not move past missing rows
  const hasWriteErrors = typeof res.hasWriteErrors === 'function' ? res.hasWriteErrors() : false;
  if (hasWriteErrors) {
    throw new Error(
      `bulkWrite reported ${res.getWriteErrors().length} write error(s); not advancing ScanState`,
    );
  }
  return {
    upsertedCount: res.upsertedCount ?? 0,
    matchedCount: res.matchedCount ?? 0,
  };
};

// use $max so scan cursor only moves forward
// this protects us if two scanners accidentally run
const advanceScanState = async (chain: ChainConfig, toBlock: number): Promise<void> => {
  await ScanStateModel.updateOne(
    { chainId: chain.chainId, contractAddress: chain.contractAddress },
    { $max: { lastScannedBlock: toBlock } },
    { upsert: true },
  );
};

// liveness heartbeat distinct from cursor; no upsert so cold-start runs
// with nothing to do do not create a row missing lastScannedBlock
const markRunCompleted = async (chain: ChainConfig): Promise<void> => {
  await ScanStateModel.updateOne(
    { chainId: chain.chainId, contractAddress: chain.contractAddress },
    { $set: { lastRunAt: new Date() } },
  );
};

type ProcessChunkResult = {
  eventsFound: number;
  upsertedCount: number;
  alreadyPresentCount: number;
};

const processChunk = async (
  chain: ChainConfig,
  contract: ethers.Contract,
  range: ScanRange,
): Promise<ProcessChunkResult> => {
  const events = await fetchFeeEvents(chain, contract, range.from, range.to);
  const { upsertedCount, matchedCount } = await writeBatch(events);
  await advanceScanState(chain, range.to);
  return {
    eventsFound: events.length,
    upsertedCount,
    alreadyPresentCount: matchedCount,
  };
};

const processChunkAdaptive = async (
  chain: ChainConfig,
  contract: ethers.Contract,
  range: ScanRange,
): Promise<ProcessChunkResult> => {
  try {
    return await processChunk(chain, contract, range);
  } catch (err) {
    if (!isRangeTooLarge(err)) throw err;
    const span = range.to - range.from + 1;
    if (span <= MIN_CHUNK_SIZE) {
      logger.error(
        { range, span, err },
        'range-too-large at minimum chunk size; surfacing failure',
      );
      throw err;
    }
    const mid = range.from + Math.floor(span / 2) - 1;
    logger.warn({ range, halvedAt: mid }, 'range-too-large from RPC; halving chunk in flight');
    const left = await processChunkAdaptive(chain, contract, {
      from: range.from,
      to: mid,
    });
    const right = await processChunkAdaptive(chain, contract, {
      from: mid + 1,
      to: range.to,
    });
    return {
      eventsFound: left.eventsFound + right.eventsFound,
      upsertedCount: left.upsertedCount + right.upsertedCount,
      alreadyPresentCount: left.alreadyPresentCount + right.alreadyPresentCount,
    };
  }
};

const formatEta = (
  blocksDone: number,
  totalBlocks: number,
  elapsedMs: number,
): { blocksPerSec: number; etaSec: number } => {
  const blocksPerSec = elapsedMs > 0 ? (blocksDone * 1000) / elapsedMs : 0;
  const remaining = Math.max(totalBlocks - blocksDone, 0);
  const etaSec = blocksPerSec > 0 ? Math.round(remaining / blocksPerSec) : 0;
  return { blocksPerSec: Number(blocksPerSec.toFixed(2)), etaSec };
};

export const runScan = async (inputs: ScanInputs): Promise<ScanSummary> => {
  const { chain, contract, fromBlock, toBlock, cancelled, previousLastScannedBlock } = inputs;

  // before scanning new blocks, fix any recent old blocks changed by reorg
  // first run has nothing old to check
  if (previousLastScannedBlock !== undefined) {
    await revalidateRecentWindow(chain, contract, previousLastScannedBlock, { cancelled });
  }

  if (toBlock < fromBlock) {
    logger.info({ chain: chain.name, fromBlock, toBlock }, 'nothing to scan (toBlock < fromBlock)');
    if (!cancelled?.()) {
      await markRunCompleted(chain);
    }
    return {
      chunksProcessed: 0,
      totalEventsFound: 0,
      totalUpsertedCount: 0,
      totalAlreadyPresentCount: 0,
      blocksAdvanced: 0,
      durationMs: 0,
    };
  }
  const totalBlocks = toBlock - fromBlock + 1;
  const start = Date.now();
  logger.info(
    {
      chain: chain.name,
      contract: chain.contractAddress,
      fromBlock,
      toBlock,
      chunkSize: chain.chunkSize,
      totalBlocks,
    },
    'scan starting',
  );

  let cursor = fromBlock;
  let chunksProcessed = 0;
  let totalEventsFound = 0;
  let totalUpsertedCount = 0;
  let totalAlreadyPresentCount = 0;

  while (cursor <= toBlock) {
    if (cancelled?.()) {
      logger.info({ cursor }, 'cancellation requested between chunks');
      break;
    }
    const to = Math.min(cursor + chain.chunkSize - 1, toBlock);
    const range: ScanRange = { from: cursor, to };
    const chunkStart = Date.now();
    const result = await processChunkAdaptive(chain, contract, range);
    const durationMs = Date.now() - chunkStart;

    chunksProcessed += 1;
    totalEventsFound += result.eventsFound;
    totalUpsertedCount += result.upsertedCount;
    totalAlreadyPresentCount += result.alreadyPresentCount;

    logger.debug(
      {
        range,
        eventsFound: result.eventsFound,
        upsertedCount: result.upsertedCount,
        alreadyPresentCount: result.alreadyPresentCount,
        durationMs,
      },
      'chunk done',
    );

    if (chunksProcessed % PROGRESS_LOG_EVERY_N_CHUNKS === 0) {
      const elapsedMs = Date.now() - start;
      const blocksDone = to - fromBlock + 1;
      const { blocksPerSec, etaSec } = formatEta(blocksDone, totalBlocks, elapsedMs);
      logger.info(
        {
          chunksProcessed,
          totalUpsertedCount,
          totalAlreadyPresentCount,
          elapsedSec: Math.round(elapsedMs / 1000),
          blocksPerSec,
          etaSec,
        },
        'scan progress',
      );
      // this is for log dashboards
      // keep all metric fields in one log line
      logger.info(
        {
          event: 'metric',
          metric: 'scanner_progress',
          chain: chain.name,
          scanLagBlocks: toBlock - to,
          chunksProcessed,
          eventsUpserted: totalUpsertedCount,
          eventsAlreadyPresent: totalAlreadyPresentCount,
          scanDurationMs: elapsedMs,
        },
        'scanner metric',
      );
    }

    cursor = to + 1;
  }

  const durationMs = Date.now() - start;
  const blocksAdvanced = Math.min(cursor, toBlock + 1) - fromBlock;
  const summary: ScanSummary = {
    chunksProcessed,
    totalEventsFound,
    totalUpsertedCount,
    totalAlreadyPresentCount,
    blocksAdvanced,
    durationMs,
  };
  // skip heartbeat on cancelled runs; let the next scheduled run refresh it
  if (!cancelled?.()) {
    await markRunCompleted(chain);
  }
  logger.info(summary, 'scan complete');
  return summary;
};
