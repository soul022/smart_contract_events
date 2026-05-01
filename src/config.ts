import * as dotenv from 'dotenv';

// load .env before building config
// entrypoints should import this before anything else that reads process.env
//
// in tests we skip .env because tests set their own env values
// this avoids accidentally using a real local MongoDB URI
if (process.env.NODE_ENV !== 'test') {
  dotenv.config();
}

export type AppConfig = Readonly<{
  mongoUri: string;
  logLevel: string;
  nodeEnv: string;
  port: number;
}>;

const validateMongoUri = (uri: string): void => {
  if (!uri.startsWith('mongodb://') && !uri.startsWith('mongodb+srv://')) {
    throw new Error('MONGODB_URI must start with mongodb:// or mongodb+srv://');
  }
};

const validatePort = (raw: string): number => {
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`PORT must be an integer in [1,65535], got: ${raw}`);
  }
  return n;
};

const required = (key: string): string => {
  const v = process.env[key];
  if (!v || v.trim() === '') {
    throw new Error(`Missing required env var: ${key}`);
  }
  return v;
};

const buildConfig = (): AppConfig => {
  const mongoUri = required('MONGODB_URI');
  validateMongoUri(mongoUri);

  const portRaw = process.env.PORT ?? '3000';
  const port = validatePort(portRaw);

  return Object.freeze({
    mongoUri,
    logLevel: process.env.LOG_LEVEL ?? 'info',
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port,
  });
};

export const config: AppConfig = buildConfig();

export const getRpcUrl = (envVar: string): string => {
  const v = process.env[envVar];
  if (!v || v.trim() === '') {
    throw new Error(`Missing required RPC env var: ${envVar}`);
  }
  try {
    new URL(v);
  } catch {
    throw new Error(`${envVar} is not a valid URL: ${v}`);
  }
  return v;
};
