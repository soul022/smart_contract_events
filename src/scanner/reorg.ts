import { ethers } from 'ethers';
import { ChainConfig } from '../chains';
import { logger } from '../logger';
import { FeeCollectedEventModel } from '../db/models/FeeCollectedEvent';
import { fetchFeeEvents, ParsedFeeCollectedEvent } from './fetchEvents';

const writeCanonicalRows = async (events: ParsedFeeCollectedEvent[]): Promise<void> => {
  if (events.length === 0) return;
  const res = await FeeCollectedEventModel.bulkWrite(
    events.map((e) => ({
      updateOne: {
        filter: { chainId: e.chainId, txHash: e.txHash, logIndex: e.logIndex },
        update: { $set: e },
        upsert: true,
      },
    })),
    { ordered: false },
  );
  const hasWriteErrors = typeof res.hasWriteErrors === 'function' ? res.hasWriteErrors() : false;
  if (hasWriteErrors) {
    throw new Error(
      `reorg bulkWrite reported ${res.getWriteErrors().length} write error(s); not deleting stale rows`,
    );
  }
};

export type RevalidateOptions = {
  cancelled?: () => boolean;
};

// chain can first say block 100 has event A, then later block 100 is replaced
// event A may be gone, changed, or replaced by event B
// Since we already saved old block events in Mongo, we re-check recent blocks
// and remove anything which is no longer on the canonical chain.
//
// We only check [reorgFrom, lastScannedBlock]. The normal scan loop handles
// new blocks after that. Also insert/update canonical rows first, then delete
// stale rows, so a crash does not create temporary holes.
// cancellation between write and delete leaves a superset of canonical, not a hole
export const revalidateRecentWindow = async (
  chain: ChainConfig,
  contract: ethers.Contract,
  lastScannedBlock: number,
  opts: RevalidateOptions = {},
): Promise<void> => {
  if (lastScannedBlock < chain.startBlock) return;
  if (opts.cancelled?.()) return;

  const reorgFrom = Math.max(chain.startBlock, lastScannedBlock - chain.reorgWindow + 1);
  const reorgTo = lastScannedBlock;

  logger.info(
    { chain: chain.name, reorgFrom, reorgTo, window: chain.reorgWindow },
    'reorg revalidation starting',
  );

  const canonical = await fetchFeeEvents(chain, contract, reorgFrom, reorgTo, {
    cancelled: opts.cancelled,
  });
  if (opts.cancelled?.()) {
    logger.info({ chain: chain.name }, 'reorg revalidation cancelled before write');
    return;
  }

  // first save the latest chain version, then delete old rows
  // using $set because same txHash/logIndex can still get new block data
  await writeCanonicalRows(canonical);
  if (opts.cancelled?.()) {
    logger.info({ chain: chain.name }, 'reorg revalidation cancelled before stale delete');
    return;
  }

  // Anything stored in this window but missing from canonicalKeys is stale.
  const canonicalKeys = new Set(canonical.map((e) => `${e.txHash}:${e.logIndex}`));

  const stored = await FeeCollectedEventModel.find({
    chainId: chain.chainId,
    contractAddress: chain.contractAddress,
    blockNumber: { $gte: reorgFrom, $lte: reorgTo },
  })
    .select({ txHash: 1, logIndex: 1 })
    .lean();

  const toDelete = stored
    .filter((s) => !canonicalKeys.has(`${s.txHash}:${s.logIndex}`))
    .map((s) => ({ txHash: s.txHash, logIndex: s.logIndex }));

  if (toDelete.length === 0) {
    logger.info(
      {
        chain: chain.name,
        reorgFrom,
        reorgTo,
        canonicalCount: canonical.length,
        storedCount: stored.length,
      },
      'reorg revalidation complete: no stale rows',
    );
    return;
  }

  const deleteRes = await FeeCollectedEventModel.deleteMany({
    chainId: chain.chainId,
    contractAddress: chain.contractAddress,
    $or: toDelete.map((k) => ({ txHash: k.txHash, logIndex: k.logIndex })),
  });

  logger.warn(
    {
      chain: chain.name,
      reorgFrom,
      reorgTo,
      canonicalCount: canonical.length,
      staleDeleted: deleteRes.deletedCount,
    },
    'reorg revalidation deleted stale rows',
  );
};
