import { ethers } from 'ethers';
import { CHAINS, ChainConfig } from '../../src/chains';
import { FeeCollectedEventModel } from '../../src/db/models/FeeCollectedEvent';
import { ScanStateModel } from '../../src/db/models/ScanState';
import { runScan } from '../../src/scanner/scanner';
import { clearAllCollections, startInMemoryMongo, stopInMemoryMongo } from '../helpers/mongo';
import { buildEvent } from '../helpers/buildEvent';

const polygon: ChainConfig = {
  ...CHAINS.find((c) => c.name === 'polygon')!,
  chunkSize: 100,
};

// Pad a short suffix into a 32-byte tx hash. Used only here to give each
// synthetic event a unique txHash deterministically derived from the chunk.
const tx = (suffix: string): string => `0x${suffix.padEnd(64, '0')}`;

type QueryFilterFn = (
  filter: unknown,
  fromBlock: number,
  toBlock: number,
) => Promise<ethers.Event[]>;

type FakeContract = {
  filters: { FeesCollected: () => Record<string, unknown> };
  queryFilter: jest.Mock<Promise<ethers.Event[]>, [unknown, number, number]>;
};

const makeContract = (impl: QueryFilterFn): FakeContract => ({
  filters: { FeesCollected: () => ({}) },
  queryFilter: jest.fn(impl),
});

describe('runScan integration', () => {
  beforeAll(async () => {
    await startInMemoryMongo();
  });
  afterAll(async () => {
    await stopInMemoryMongo();
  });
  beforeEach(async () => {
    await clearAllCollections();
  });

  it('chunks the range and advances ScanState only after upsert', async () => {
    const fromBlock = 100;
    const toBlock = 349;
    const seenRanges: Array<{ from: number; to: number }> = [];
    const contract = makeContract(async (_f, from, to) => {
      seenRanges.push({ from, to });
      return [
        buildEvent({
          blockNumber: from,
          logIndex: 0,
          txHash: tx(`${from}a`),
        }),
      ];
    });

    const summary = await runScan({
      chain: polygon,
      contract: contract as unknown as ethers.Contract,
      fromBlock,
      toBlock,
    });

    expect(seenRanges[0]).toEqual({ from: 100, to: 199 });
    expect(seenRanges[1]).toEqual({ from: 200, to: 299 });
    expect(seenRanges[2]).toEqual({ from: 300, to: 349 });

    expect(summary.chunksProcessed).toBe(3);
    expect(summary.totalUpsertedCount).toBe(3);
    expect(summary.blocksAdvanced).toBe(toBlock - fromBlock + 1);

    const state = await ScanStateModel.findOne({
      chainId: polygon.chainId,
      contractAddress: polygon.contractAddress,
    }).lean();
    expect(state?.lastScannedBlock).toBe(toBlock);
  });

  it('idempotent re-run upserts zero new docs and reports alreadyPresent', async () => {
    const fromBlock = 100;
    const toBlock = 199;
    const queryFn: QueryFilterFn = async (_f, from) => [
      buildEvent({ blockNumber: from, logIndex: 0, txHash: tx(`${from}a`) }),
      buildEvent({ blockNumber: from + 5, logIndex: 1, txHash: tx(`${from}b`) }),
    ];
    const c1 = makeContract(queryFn);
    const c2 = makeContract(queryFn);

    const first = await runScan({
      chain: polygon,
      contract: c1 as unknown as ethers.Contract,
      fromBlock,
      toBlock,
    });
    const second = await runScan({
      chain: polygon,
      contract: c2 as unknown as ethers.Contract,
      fromBlock,
      toBlock,
    });

    expect(first.totalUpsertedCount).toBeGreaterThan(0);
    expect(second.totalUpsertedCount).toBe(0);
    expect(second.totalAlreadyPresentCount).toBeGreaterThan(0);
    expect(await FeeCollectedEventModel.countDocuments({})).toBe(first.totalUpsertedCount);
  });

  it('does not regress ScanState when an older overlapping run completes later', async () => {
    await ScanStateModel.create({
      chainId: polygon.chainId,
      contractAddress: polygon.contractAddress,
      lastScannedBlock: 1_000,
    });

    const contract = makeContract(async (_f, from) => [
      buildEvent({ blockNumber: from, logIndex: 0, txHash: tx(`${from}a`) }),
    ]);

    await runScan({
      chain: polygon,
      contract: contract as unknown as ethers.Contract,
      fromBlock: 100,
      toBlock: 150,
    });

    const state = await ScanStateModel.findOne({
      chainId: polygon.chainId,
      contractAddress: polygon.contractAddress,
    }).lean();
    expect(state?.lastScannedBlock).toBe(1_000);
  });

  it('does not advance ScanState when bulkWrite throws on the very first chunk', async () => {
    jest.spyOn(FeeCollectedEventModel, 'bulkWrite').mockRejectedValueOnce(new Error('mongo down'));

    const contract = makeContract(async (_f, from) => [
      buildEvent({ blockNumber: from, logIndex: 0, txHash: tx(`${from}a`) }),
    ]);

    await expect(
      runScan({
        chain: polygon,
        contract: contract as unknown as ethers.Contract,
        fromBlock: 100,
        toBlock: 150,
      }),
    ).rejects.toThrow(/mongo down/);

    const state = await ScanStateModel.findOne({
      chainId: polygon.chainId,
    }).lean();
    expect(state).toBeNull();
  });

  it('does not advance ScanState when bulkWrite resolves with writeErrors (ordered: false partial failure)', async () => {
    jest.spyOn(FeeCollectedEventModel, 'bulkWrite').mockResolvedValueOnce({
      upsertedCount: 0,
      matchedCount: 0,
      hasWriteErrors: () => true,
      getWriteErrors: () => [{ index: 0, code: 11000, errmsg: 'simulated' }],
    } as unknown as Awaited<ReturnType<typeof FeeCollectedEventModel.bulkWrite>>);

    const contract = makeContract(async (_f, from) => [
      buildEvent({ blockNumber: from, logIndex: 0, txHash: tx(`${from}a`) }),
    ]);

    await expect(
      runScan({
        chain: polygon,
        contract: contract as unknown as ethers.Contract,
        fromBlock: 100,
        toBlock: 150,
      }),
    ).rejects.toThrow(/write error/);

    const state = await ScanStateModel.findOne({
      chainId: polygon.chainId,
    }).lean();
    expect(state).toBeNull();
  });

  it('halves the chunk in flight on RPC range-too-large', async () => {
    const seen: Array<{ from: number; to: number }> = [];
    let firstCall = true;
    const contract = makeContract(async (_f, from, to) => {
      seen.push({ from, to });
      if (firstCall && to - from + 1 > 50) {
        firstCall = false;
        const err = new Error('result set too large');
        throw err;
      }
      return [];
    });

    await runScan({
      chain: polygon,
      contract: contract as unknown as ethers.Contract,
      fromBlock: 0,
      toBlock: 99,
    });

    expect(seen[0]).toEqual({ from: 0, to: 99 });
    expect(seen.slice(1)).toEqual([
      { from: 0, to: 49 },
      { from: 50, to: 99 },
    ]);
  });

  it('retries transient network errors and recovers', async () => {
    let attempts = 0;
    const contract = makeContract(async (_f, from) => {
      attempts += 1;
      if (attempts === 1) throw new Error('socket hang up');
      return [buildEvent({ blockNumber: from, logIndex: 0, txHash: tx(`${from}a`) })];
    });

    const summary = await runScan({
      chain: polygon,
      contract: contract as unknown as ethers.Contract,
      fromBlock: 100,
      toBlock: 150,
    });

    expect(attempts).toBe(2);
    expect(summary.totalUpsertedCount).toBe(1);
  });

  it('cold-start guard: returns empty summary when toBlock < fromBlock', async () => {
    const contract = makeContract(async () => []);
    const summary = await runScan({
      chain: polygon,
      contract: contract as unknown as ethers.Contract,
      fromBlock: 200,
      toBlock: 100,
    });
    expect(summary.chunksProcessed).toBe(0);
    expect(contract.queryFilter).not.toHaveBeenCalled();
    // markRunCompleted must not upsert: cold-start with no work creates no row
    const state = await ScanStateModel.findOne({ chainId: polygon.chainId }).lean();
    expect(state).toBeNull();
  });

  it('honors the cancellation flag between chunks and exits cleanly', async () => {
    let cancelFlag = false;
    const cancelled = (): boolean => cancelFlag;

    let chunksRun = 0;
    const contract = makeContract(async (_f, from) => {
      chunksRun += 1;
      // Flip the cancel flag during the first chunk's queryFilter call so
      // the loop sees it after the chunk's bulkWrite + advanceScanState.
      if (chunksRun === 1) cancelFlag = true;
      return [buildEvent({ blockNumber: from, logIndex: 0, txHash: tx(`${from}a`) })];
    });

    const summary = await runScan({
      chain: polygon,
      contract: contract as unknown as ethers.Contract,
      fromBlock: 100,
      toBlock: 999,
      cancelled,
    });

    // Exactly one chunk runs to completion before the loop sees the flag.
    expect(chunksRun).toBe(1);
    expect(summary.chunksProcessed).toBe(1);
    expect(summary.totalUpsertedCount).toBe(1);

    // ScanState reflects the completed chunk, not partial progress.
    const state = await ScanStateModel.findOne({
      chainId: polygon.chainId,
      contractAddress: polygon.contractAddress,
    }).lean();
    expect(state?.lastScannedBlock).toBe(100 + polygon.chunkSize - 1);
    // partial run must not bump the heartbeat; next scheduled run refreshes it
    expect(state?.lastRunAt).toBeUndefined();
  });

  it('refreshes lastRunAt even when the cursor does not move (idle chain at safeTip)', async () => {
    // pins the bug fix: $max is a no-op when the chain is caught up, so
    // the heartbeat must come from a separate $set, not from cursor movement
    await ScanStateModel.create({
      chainId: polygon.chainId,
      contractAddress: polygon.contractAddress,
      lastScannedBlock: 200,
      lastRunAt: new Date(Date.now() - 60_000),
    });
    const stale = (
      await ScanStateModel.findOne({ chainId: polygon.chainId }).lean()
    )?.lastRunAt!.getTime();

    const contract = makeContract(async () => []);
    await runScan({
      chain: polygon,
      contract: contract as unknown as ethers.Contract,
      fromBlock: 100,
      toBlock: 150,
    });

    const fresh = (await ScanStateModel.findOne({ chainId: polygon.chainId }).lean())?.lastRunAt;
    expect(fresh!.getTime()).toBeGreaterThan(stale!);
  });

  it('emits a structured metric snapshot on the progress cadence', async () => {
    // Need 100+ chunks to hit the PROGRESS_LOG_EVERY_N_CHUNKS cadence.
    // Use chunkSize 1 over 100 blocks with empty queryFilter results so each
    // chunk is fast and no bulkWrite runs.
    const tinyChunk: ChainConfig = { ...polygon, chunkSize: 1 };
    const contract = makeContract(async () => []);

    const { logger } = await import('../../src/logger');
    const spy = jest.spyOn(logger, 'info');

    await runScan({
      chain: tinyChunk,
      contract: contract as unknown as ethers.Contract,
      fromBlock: 0,
      toBlock: 99, // 100 chunks
    });

    const metricCalls = spy.mock.calls.filter(
      (call) => (call[0] as { event?: string }).event === 'metric',
    );
    expect(metricCalls.length).toBeGreaterThanOrEqual(1);

    const snapshot = metricCalls[0][0] as Record<string, unknown>;
    expect(snapshot.metric).toBe('scanner_progress');
    expect(snapshot.chain).toBe('polygon');
    expect(typeof snapshot.scanLagBlocks).toBe('number');
    expect(typeof snapshot.chunksProcessed).toBe('number');
    expect(typeof snapshot.eventsUpserted).toBe('number');
    expect(typeof snapshot.eventsAlreadyPresent).toBe('number');
    expect(typeof snapshot.scanDurationMs).toBe('number');
    spy.mockRestore();
  });
});
