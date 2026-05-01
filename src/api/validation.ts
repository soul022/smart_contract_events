import { tryNormalizeAddress } from '../address';
import { parseChainSelector } from '../chains';

export type EventsQuery = {
  integrator: string;
  limit: number;
  offset: number;
  chainId?: number;
  contractAddress?: string;
  token?: string;
};

export type ValidationError = {
  code: 'INVALID_ADDRESS' | 'INVALID_PAGINATION' | 'INVALID_CHAIN';
  message: string;
};

export type ValidationResult =
  | { ok: true; value: EventsQuery }
  | { ok: false; error: ValidationError };

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const parseIntStrict = (raw: unknown): number | null => {
  if (typeof raw !== 'string') return null;
  if (!/^-?\d+$/.test(raw)) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
};

// here repeated query params become arrays
// we reject them because all filters here are scalar
const KEY_TO_CODE: Record<string, ValidationError['code']> = {
  integrator: 'INVALID_ADDRESS',
  contractAddress: 'INVALID_ADDRESS',
  token: 'INVALID_ADDRESS',
  chain: 'INVALID_CHAIN',
  chainId: 'INVALID_CHAIN',
  limit: 'INVALID_PAGINATION',
  offset: 'INVALID_PAGINATION',
};

const rejectDuplicateScalar = (q: Record<string, unknown>): ValidationError | null => {
  for (const [key, code] of Object.entries(KEY_TO_CODE)) {
    if (Array.isArray(q[key])) {
      return { code, message: `${key} must be a single value, not a list` };
    }
  }
  return null;
};

export const parseEventsQuery = (q: Record<string, unknown>): ValidationResult => {
  const dup = rejectDuplicateScalar(q);
  if (dup) return { ok: false, error: dup };

  const integratorRaw = q.integrator;
  if (typeof integratorRaw !== 'string' || integratorRaw.trim() === '') {
    return {
      ok: false,
      error: {
        code: 'INVALID_ADDRESS',
        message: 'integrator is required',
      },
    };
  }
  // zero address is invalid for integrator/contract
  // token=0x0 is allowed because it means native asset
  const integrator = tryNormalizeAddress(integratorRaw);
  if (integrator === null || integrator === ZERO_ADDRESS) {
    return {
      ok: false,
      error: {
        code: 'INVALID_ADDRESS',
        message: 'integrator must be a valid non-zero EVM address',
      },
    };
  }

  const selector = parseChainSelector({
    chain: typeof q.chain === 'string' ? q.chain : undefined,
    chainId: typeof q.chainId === 'string' ? q.chainId : undefined,
  });
  if (!selector.ok) {
    return { ok: false, error: { code: 'INVALID_CHAIN', message: selector.message } };
  }

  let contractAddress: string | undefined;
  if (typeof q.contractAddress === 'string' && q.contractAddress.trim() !== '') {
    const norm = tryNormalizeAddress(q.contractAddress);
    if (norm === null || norm === ZERO_ADDRESS) {
      return {
        ok: false,
        error: {
          code: 'INVALID_ADDRESS',
          message: 'contractAddress must be a valid non-zero EVM address',
        },
      };
    }
    contractAddress = norm;
  }

  let token: string | undefined;
  if (typeof q.token === 'string' && q.token.trim() !== '') {
    const norm = tryNormalizeAddress(q.token);
    if (norm === null) {
      return {
        ok: false,
        error: { code: 'INVALID_ADDRESS', message: 'token must be a valid EVM address' },
      };
    }
    token = norm;
  }

  let limit = DEFAULT_LIMIT;
  if (q.limit !== undefined) {
    const parsed = parseIntStrict(q.limit);
    if (parsed === null || parsed < 1) {
      return {
        ok: false,
        error: {
          code: 'INVALID_PAGINATION',
          message: 'limit must be a positive integer',
        },
      };
    }
    limit = Math.min(parsed, MAX_LIMIT);
  }

  let offset = 0;
  if (q.offset !== undefined) {
    const parsed = parseIntStrict(q.offset);
    if (parsed === null || parsed < 0) {
      return {
        ok: false,
        error: {
          code: 'INVALID_PAGINATION',
          message: 'offset must be a non-negative integer',
        },
      };
    }
    offset = parsed;
  }

  const value: EventsQuery = { integrator, limit, offset };
  if (selector.chainId !== undefined) value.chainId = selector.chainId;
  if (contractAddress !== undefined) value.contractAddress = contractAddress;
  if (token !== undefined) value.token = token;

  return { ok: true, value };
};
