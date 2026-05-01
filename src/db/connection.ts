import mongoose from 'mongoose';
import { logger } from '../logger';

let registered = false;

const registerConnectionListeners = (): void => {
  if (registered) return;
  registered = true;
  mongoose.connection.on('error', (err) => logger.error({ err }, 'mongoose connection error'));
  mongoose.connection.on('disconnected', () => logger.warn('mongoose disconnected'));
};

export type ConnectOptions = {
  uri: string;
  maxPoolSize?: number;
};

export const connectMongo = async (opts: ConnectOptions): Promise<void> => {
  registerConnectionListeners();
  // we want to fail faster if Mongo URI is wrong
  // indexes are created by scanner startup in the beginning, not every API boot
  await mongoose.connect(opts.uri, {
    serverSelectionTimeoutMS: 5_000,
    maxPoolSize: opts.maxPoolSize ?? 10,
    minPoolSize: 1,
    autoIndex: false,
  });
  logger.info('mongoose connected');
};

export const disconnectMongo = async (): Promise<void> => {
  await mongoose.disconnect();
};
