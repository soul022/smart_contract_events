import { parseArgs } from 'node:util';
import { CHAINS, ChainConfig, getChain, parseChainSelector } from '../chains';

const DEFAULT_CHAIN = 'polygon';

export const resolveChain = (argv: string[]): ChainConfig => {
  const { values } = parseArgs({
    args: argv,
    options: {
      chain: { type: 'string' },
      chainId: { type: 'string' },
    },
    strict: true,
    allowPositionals: false,
  });

  const selector = parseChainSelector({
    chain: typeof values.chain === 'string' ? values.chain : undefined,
    chainId: typeof values.chainId === 'string' ? values.chainId : undefined,
  });
  if (!selector.ok) {
    throw new Error(selector.message);
  }
  if (selector.chainId === undefined) return getChain(DEFAULT_CHAIN);
  // already checked this chainId exists above
  return CHAINS.find((c) => c.chainId === selector.chainId)!;
};
