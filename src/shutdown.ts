import { logger } from './logger';

export type ShutdownHandler = () => Promise<void> | void;

const SIGNALS: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];

export const setupShutdown = (onShutdown: ShutdownHandler): void => {
  let shuttingDown = false;
  const handler = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutdown signal received');
    try {
      await onShutdown();
      logger.info('shutdown complete, exiting 0');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'shutdown handler failed');
      process.exit(1);
    }
  };
  for (const sig of SIGNALS) {
    process.on(sig, handler);
  }
};

export const createCancellationToken = (): {
  cancelled: () => boolean;
  cancel: () => void;
} => {
  let flag = false;
  return {
    cancelled: () => flag,
    cancel: () => {
      flag = true;
    },
  };
};
