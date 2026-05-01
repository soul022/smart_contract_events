import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { connectMongo, disconnectMongo } from '../../src/db/connection';
import { FeeCollectedEventModel } from '../../src/db/models/FeeCollectedEvent';
import { ScanStateModel } from '../../src/db/models/ScanState';

let memoryServer: MongoMemoryServer | undefined;

export const startInMemoryMongo = async (): Promise<string> => {
  memoryServer = await MongoMemoryServer.create();
  const uri = memoryServer.getUri();
  await connectMongo({ uri, maxPoolSize: 5 });
  await FeeCollectedEventModel.syncIndexes();
  await ScanStateModel.syncIndexes();
  return uri;
};

export const stopInMemoryMongo = async (): Promise<void> => {
  await disconnectMongo();
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = undefined;
  }
};

export const clearAllCollections = async (): Promise<void> => {
  if (mongoose.connection.readyState !== 1) return;
  await FeeCollectedEventModel.deleteMany({});
  await ScanStateModel.deleteMany({});
};
