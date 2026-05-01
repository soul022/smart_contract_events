import { config } from '../config';
import { logger } from '../logger';
import { connectMongo, disconnectMongo } from '../db/connection';
import { FeeCollectedEventModel } from '../db/models/FeeCollectedEvent';
import { ScanStateModel } from '../db/models/ScanState';
import { buildContract, buildProvider, probeRpc, verifyContractCode } from '../chain/provider';
import { runScan, ScanSummary } from './scanner';
import { createCancellationToken, setupShutdown } from '../shutdown';
import { resolveChain } from './resolveChain';
import { resolveResumeState } from './resume';

const main = async (): Promise<void> => {
  const chain = resolveChain(process.argv.slice(2));
  logger.info({ chain: chain.name, chainId: chain.chainId }, 'scanner starting');

  // setup shutdown early so ctrl+c or SIGTERM can clean up Mongo/run state
  const token = createCancellationToken();
  let mongoConnected = false;
  let runPromise: Promise<ScanSummary> | null = null;

  setupShutdown(async () => {
    token.cancel();
    if (runPromise) {
      // let current chunk finish before shutdown
      // so we don't lose any data
      // ignore late scan errors because we are already stopping
      try {
        await runPromise;
      } catch (err) {
        logger.warn({ err }, 'runScan rejected during shutdown');
      }
    }
    if (mongoConnected) {
      await disconnectMongo();
    }
  });

  await connectMongo({ uri: config.mongoUri, maxPoolSize: 5 });
  mongoConnected = true;
  await FeeCollectedEventModel.createIndexes();
  await ScanStateModel.createIndexes();

  const provider = buildProvider(chain);
  const currentBlock = await probeRpc(provider, chain);
  await verifyContractCode(provider, chain);
  const safeTip = currentBlock - chain.confirmations;
  const { fromBlock, previousLastScannedBlock } = await resolveResumeState(chain);

  // we do not need to stop here when there are no new blocks
  // because runScan handles that case and previousLastScannedBlock handles reorgs
  const contract = buildContract(chain, provider);
  runPromise = runScan({
    chain,
    contract,
    fromBlock,
    toBlock: safeTip,
    cancelled: token.cancelled,
    previousLastScannedBlock,
  });
  await runPromise;

  await disconnectMongo();
  mongoConnected = false;
};

if (require.main === module) {
  main().catch((err) => {
    logger.error({ err }, 'scanner failed');
    process.exit(1);
  });
}
