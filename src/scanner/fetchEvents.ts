import { ethers } from 'ethers';
import { ChainConfig } from '../chains';
import { normalizeAddress } from '../address';
import { withRetry } from '../retry';

export type ParsedFeeCollectedEvent = {
  chainId: number;
  txHash: string;
  logIndex: number;
  blockNumber: number;
  blockHash: string;
  contractAddress: string;
  token: string;
  integrator: string;
  integratorFee: string;
  lifiFee: string;
};

// here we are converting raw contract event into the row we store in Mongo
// also fees are kept as strings so we do not lose precision
export const parseFeesCollectedLog = (
  chain: ChainConfig,
  log: ethers.Event,
): ParsedFeeCollectedEvent => {
  const args = log.args;
  if (!args) {
    throw new Error(`parsed log missing args at ${log.transactionHash}:${log.logIndex}`);
  }
  const token = normalizeAddress(args._token as string);
  const integrator = normalizeAddress(args._integrator as string);
  const integratorFee = (args._integratorFee as ethers.BigNumber).toString();
  const lifiFee = (args._lifiFee as ethers.BigNumber).toString();
  return {
    chainId: chain.chainId,
    txHash: log.transactionHash.toLowerCase(),
    logIndex: log.logIndex,
    blockNumber: log.blockNumber,
    blockHash: log.blockHash.toLowerCase(),
    contractAddress: chain.contractAddress,
    token,
    integrator,
    integratorFee,
    lifiFee,
  };
};

export type FetchOptions = {
  cancelled?: () => boolean;
};

export const fetchFeeEvents = async (
  chain: ChainConfig,
  contract: ethers.Contract,
  fromBlock: number,
  toBlock: number,
  opts: FetchOptions = {},
): Promise<ParsedFeeCollectedEvent[]> => {
  const filter = contract.filters.FeesCollected();
  const logs = await withRetry<ethers.Event[]>(
    () => contract.queryFilter(filter, fromBlock, toBlock) as Promise<ethers.Event[]>,
    { label: `queryFilter[${fromBlock},${toBlock}]`, cancelled: opts.cancelled },
  );
  return logs.map((log) => parseFeesCollectedLog(chain, log));
};
