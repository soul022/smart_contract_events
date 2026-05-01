import { logger } from './logger';

type RetryDecision = 'retry' | 'fail-fast' | 'range-too-large';

// RPCs use different messages when a block range is too large
// if we catch it here scanner will halve the chunk and retry
const RANGE_TOO_LARGE_PATTERNS = [
  'result set too large',
  'query returned more than',
  'response size exceeded',
  'block range is too wide',
  'query exceeds max',
  'too many results',
];

const RANGE_ERROR_CODES = new Set<number>([-32602, -32005]);

const lc = (s: unknown): string => (typeof s === 'string' ? s.toLowerCase() : '');

export const classifyError = (err: unknown): RetryDecision => {
  if (!err) return 'fail-fast';
  const e = err as {
    code?: number | string;
    message?: string;
    error?: { message?: string; code?: number };
    body?: string;
  };

  const code = typeof e.code === 'number' ? e.code : e.error?.code;
  if (code !== undefined && RANGE_ERROR_CODES.has(code)) {
    return 'range-too-large';
  }

  const msg = lc(e.message) + ' ' + lc(e.error?.message) + ' ' + lc(e.body);
  if (RANGE_TOO_LARGE_PATTERNS.some((p) => msg.includes(p))) {
    return 'range-too-large';
  }

  if (
    msg.includes('timeout') ||
    msg.includes('econnreset') ||
    msg.includes('econnrefused') ||
    msg.includes('etimedout') ||
    msg.includes('socket hang up') ||
    msg.includes('network') ||
    msg.includes('server error') ||
    msg.includes('bad gateway') ||
    msg.includes('service unavailable') ||
    msg.includes('gateway timeout')
  ) {
    return 'retry';
  }

  if (typeof e.code === 'string') {
    const c = e.code;
    if (c === 'NETWORK_ERROR' || c === 'TIMEOUT' || c === 'SERVER_ERROR') {
      return 'retry';
    }
  }

  return 'fail-fast';
};

const DEFAULT_DELAYS_MS = [500, 1000, 2000, 4000, 8000];

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// poll the cancel flag while sleeping so SIGTERM does not wait the full delay
const CANCEL_POLL_MS = 100;
const interruptibleSleep = async (ms: number, cancelled?: () => boolean): Promise<boolean> => {
  if (!cancelled) {
    await sleep(ms);
    return false;
  }
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (cancelled()) return true;
    const remaining = deadline - Date.now();
    await sleep(Math.min(CANCEL_POLL_MS, remaining));
  }
  return cancelled();
};

const withJitter = (ms: number): number => Math.floor(Math.random() * ms);

export type RangeTooLargeError = Error & { __rangeTooLarge: true };
export const isRangeTooLarge = (err: unknown): err is RangeTooLargeError =>
  Boolean(err && typeof err === 'object' && (err as { __rangeTooLarge?: boolean }).__rangeTooLarge);

const wrapRangeTooLarge = (err: unknown): RangeTooLargeError => {
  const message = err instanceof Error ? err.message : String(err);
  const wrapped = new Error(`range-too-large: ${message}`) as RangeTooLargeError;
  wrapped.__rangeTooLarge = true;
  return wrapped;
};

export type RetryOptions = {
  delaysMs?: number[];
  label?: string;
  // if set and true between attempts, abort backoff and rethrow the last error
  cancelled?: () => boolean;
};

export const withRetry = async <T>(op: () => Promise<T>, opts: RetryOptions = {}): Promise<T> => {
  const delays = opts.delaysMs ?? DEFAULT_DELAYS_MS;
  const label = opts.label ?? 'op';
  let lastErr: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    try {
      return await op();
    } catch (err) {
      lastErr = err;
      const decision = classifyError(err);
      if (decision === 'range-too-large') {
        throw wrapRangeTooLarge(err);
      }
      if (decision === 'fail-fast') {
        throw err;
      }
      if (attempt === delays.length) {
        throw err;
      }
      const baseDelay = delays[attempt];
      const wait = withJitter(baseDelay);
      logger.warn(
        { err, attempt: attempt + 1, label, waitMs: wait },
        'retrying after transient error',
      );
      const interrupted = await interruptibleSleep(wait, opts.cancelled);
      if (interrupted) {
        logger.info({ label }, 'retry backoff cancelled by shutdown signal');
        throw err;
      }
    }
  }
  throw lastErr;
};
