import { Server } from 'node:http';
import { config } from '../config';
import { logger } from '../logger';
import { connectMongo, disconnectMongo } from '../db/connection';
import { createApp } from './server';
import { setupShutdown } from '../shutdown';

const SHUTDOWN_TIMEOUT_MS = 10_000;

const closeServer = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
    setTimeout(() => {
      logger.warn('http server close timeout, forcing exit path');
      resolve();
    }, SHUTDOWN_TIMEOUT_MS).unref();
  });

const main = async (): Promise<void> => {
  await connectMongo({ uri: config.mongoUri, maxPoolSize: 10 });
  const app = createApp();
  const server = app.listen(config.port, () => {
    logger.info({ port: config.port }, 'api listening');
  });

  setupShutdown(async () => {
    await closeServer(server);
    await disconnectMongo();
  });
};

main().catch((err) => {
  logger.error({ err }, 'api failed to start');
  process.exit(1);
});
