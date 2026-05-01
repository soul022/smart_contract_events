import { ChainConfig } from '../chains';
import { ScanStateModel } from '../db/models/ScanState';

export type ResumeState = {
  // where scanner should start this run
  fromBlock: number;
  // last block completed in earlier run
  // missing on first run
  previousLastScannedBlock?: number;
};

export const resolveResumeState = async (chain: ChainConfig): Promise<ResumeState> => {
  const existing = await ScanStateModel.findOne({
    chainId: chain.chainId,
    contractAddress: chain.contractAddress,
  }).lean();
  if (existing && typeof existing.lastScannedBlock === 'number') {
    return {
      fromBlock: existing.lastScannedBlock + 1,
      previousLastScannedBlock: existing.lastScannedBlock,
    };
  }
  return { fromBlock: chain.startBlock };
};
