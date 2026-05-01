import pino from 'pino';
import { config } from './config';

// using pino-pretty for dev-only; the production image should omit dev dependencies.
const tryDevTransport = (): { target: string; options: object } | undefined => {
  if (config.nodeEnv === 'production') return undefined;
  try {
    require.resolve('pino-pretty');
    return {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:standard' },
    };
  } catch {
    return undefined;
  }
};

const transport = tryDevTransport();

// these are fields where secrets may appear
// we do not redact every url/uri field because some URLs are safe to log
const redactPaths = [
  'mongoUri',
  'config.mongoUri',
  'connectionString',
  'err.connectionString',
  'err.cause.connectionString',
];

// hide full URLs because they may contain passwords or tokens
// catches mongodb://, mongodb+srv://, https://, etc.
const URL_PATTERN = /[a-z][a-z0-9+\-.]*:\/\/\S+/gi;

const scrubUrls = (s: string): string => s.replace(URL_PATTERN, '[REDACTED_URL]');

type SerializedError = {
  type: string;
  message: string;
  stack?: string;
  cause?: SerializedError;
};

export const errSerializer = (err: unknown): SerializedError | unknown => {
  if (!(err instanceof Error)) return err;
  const out: SerializedError = {
    type: err.name,
    message: scrubUrls(err.message),
  };
  if (err.stack) out.stack = scrubUrls(err.stack);
  const cause = (err as { cause?: unknown }).cause;
  if (cause !== undefined) {
    out.cause = errSerializer(cause) as SerializedError;
  }
  return out;
};

export const logger = pino({
  level: config.logLevel,
  redact: { paths: redactPaths, censor: '[REDACTED]' },
  serializers: { err: errSerializer },
  ...(transport ? { transport } : {}),
});
