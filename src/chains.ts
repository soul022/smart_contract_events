// Addresses and deploy blocks:
//   https://github.com/lifinance/contracts/tree/main/deployments
//   https://li.quest/v1/chains
// Refer Readme for additional context on how to add new chains.
export type ChainConfig = Readonly<{
  chainId: number;
  name: string;
  rpcEnvVar: string;
  contractAddress: string;
  startBlock: number;
  chunkSize: number;
  confirmations: number;
  rpcTimeoutMs: number;
  // this is for how far back we re-check old scanned blocks
  // keeping this <= confirmations so reorged blocks can still be revisited and fixed if needed
  reorgWindow: number;
}>;

// per-chain scanner settings
// startBlock is where this contract starts, confirmations means skip latest blocks
export const CHAINS: readonly ChainConfig[] = [
  {
    chainId: 137,
    name: 'polygon',
    rpcEnvVar: 'POLYGON_RPC_URL',
    contractAddress: '0xbd6c7b0d2f68c2b7805d88388319cfb6ecb50ea9',
    startBlock: 78_600_000,
    chunkSize: 2_000,
    confirmations: 64,
    rpcTimeoutMs: 30_000,
    reorgWindow: 64,
  },
  {
    chainId: 1,
    name: 'ethereum',
    rpcEnvVar: 'ETHEREUM_RPC_URL',
    contractAddress: '0x3ef238c36035880efbdfa239d218186b79ad1d6f',
    startBlock: 23_322_816,
    chunkSize: 1_000,
    confirmations: 64,
    rpcTimeoutMs: 30_000,
    reorgWindow: 64,
  },
];

export const getChain = (name: string): ChainConfig => {
  const normalized = name.trim().toLowerCase();
  const c = CHAINS.find((x) => x.name === normalized);
  if (!c) {
    throw new Error(`Unknown chain: ${name}. Available: ${CHAINS.map((x) => x.name).join(', ')}`);
  }
  return c;
};

// shared helper for chain and chainId params
// API turns errors into 400, CLI turns errors into exit(1)

export type ChainSelectorInput = {
  chain?: string | undefined;
  chainId?: string | undefined;
};

export type ChainSelectorResult =
  | { ok: true; chainId: number | undefined }
  | { ok: false; message: string };

const isPresent = (s: string | undefined): s is string => s !== undefined && s.trim() !== '';

export const parseChainSelector = (input: ChainSelectorInput): ChainSelectorResult => {
  const hasName = isPresent(input.chain);
  const hasId = isPresent(input.chainId);

  if (!hasName && !hasId) return { ok: true, chainId: undefined };

  let fromName: number | undefined;
  let fromId: number | undefined;

  if (hasName) {
    try {
      fromName = getChain(input.chain as string).chainId;
    } catch {
      return {
        ok: false,
        message: `Unknown chain: ${input.chain}. Available: ${CHAINS.map((c) => c.name).join(', ')}`,
      };
    }
  }

  if (hasId) {
    const raw = (input.chainId as string).trim();
    const parsed = Number.parseInt(raw, 10);
    // parseInt would turn "137x" or "137.5" into 137
    // so check the parsed value still matches the raw input
    if (!Number.isFinite(parsed) || `${parsed}` !== raw || parsed < 1) {
      return { ok: false, message: 'chainId must be a positive integer' };
    }
    const known = CHAINS.find((c) => c.chainId === parsed);
    if (!known) {
      return {
        ok: false,
        message: `Unknown chainId: ${parsed}. Known: ${CHAINS.map((c) => c.chainId).join(', ')}`,
      };
    }
    fromId = parsed;
  }

  if (fromName !== undefined && fromId !== undefined && fromName !== fromId) {
    return {
      ok: false,
      message: `chain and chainId disagree: chain=${input.chain} resolves to ${fromName}, chainId=${fromId}`,
    };
  }

  return { ok: true, chainId: fromName ?? fromId };
};
