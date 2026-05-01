import { FeeCollectedEventModel } from '../../src/db/models/FeeCollectedEvent';
import { clearAllCollections, startInMemoryMongo, stopInMemoryMongo } from '../helpers/mongo';
import fixtures from '../fixtures/feesCollected.json';

describe('DB integration', () => {
  beforeAll(async () => {
    await startInMemoryMongo();
  });

  afterAll(async () => {
    await stopInMemoryMongo();
  });

  beforeEach(async () => {
    await clearAllCollections();
  });

  it('bulk upsert by (chainId, txHash, logIndex) is idempotent under repeat application', async () => {
    const ops = fixtures.map((e) => ({
      updateOne: {
        filter: { chainId: e.chainId, txHash: e.txHash, logIndex: e.logIndex },
        update: { $setOnInsert: e },
        upsert: true,
      },
    }));

    const first = await FeeCollectedEventModel.bulkWrite(ops, { ordered: false });
    const second = await FeeCollectedEventModel.bulkWrite(ops, { ordered: false });

    expect(first.upsertedCount).toBe(fixtures.length);
    expect(second.upsertedCount).toBe(0);
    expect(second.matchedCount).toBe(fixtures.length);

    const total = await FeeCollectedEventModel.countDocuments({});
    expect(total).toBe(fixtures.length);
  });

  it('persists native-asset events (token = 0x0) verbatim', async () => {
    await FeeCollectedEventModel.insertMany(fixtures);
    const native = await FeeCollectedEventModel.findOne({
      token: '0x0000000000000000000000000000000000000000',
    }).lean();
    expect(native).not.toBeNull();
    expect(native?.integratorFee).toBe('5000000000000000');
  });
});
