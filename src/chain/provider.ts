import { ethers } from 'ethers';
import { logger } from '../logger';
import { ChainConfig } from '../chains';
import { getRpcUrl } from '../config';
import { FEE_COLLECTOR_ABI } from './feeCollectorAbi';

export const buildProvider = (chain: ChainConfig): ethers.providers.JsonRpcProvider => {
  const url = getRpcUrl(chain.rpcEnvVar);
  // adding timeout so bad RPC calls do not hang
  const provider = new ethers.providers.JsonRpcProvider({
    url,
    timeout: chain.rpcTimeoutMs,
  });
  provider.on('error', (err) =>
    logger.warn({ err, chain: chain.name }, 'rpc provider transport error'),
  );
  return provider;
};

export const buildContract = (
  chain: ChainConfig,
  provider: ethers.providers.Provider,
): ethers.Contract => {
  return new ethers.Contract(chain.contractAddress, FEE_COLLECTOR_ABI, provider);
};

export const getCurrentBlock = async (provider: ethers.providers.Provider): Promise<number> => {
  return provider.getBlockNumber();
};

export const verifyContractCode = async (
  provider: ethers.providers.Provider,
  chain: ChainConfig,
): Promise<void> => {
  const code = await provider.getCode(chain.contractAddress);
  // check address has code so wrong chain/address fails early
  // bytecode/proxy checks can be added later if needed
  if (code === '0x') {
    throw new Error(
      `No contract bytecode at ${chain.contractAddress} on ${chain.name}; check ChainConfig and RPC URL`,
    );
  }
};

// probe RPC once at startup so bad URL or non-EVM endpoint fails early
export const probeRpc = async (
  provider: ethers.providers.Provider,
  chain: ChainConfig,
): Promise<number> => {
  try {
    return await getCurrentBlock(provider);
  } catch (err) {
    logger.error(
      { err, chain: chain.name, rpcEnvVar: chain.rpcEnvVar },
      'RPC unreachable / not an EVM JSON-RPC endpoint',
    );
    throw err;
  }
};
