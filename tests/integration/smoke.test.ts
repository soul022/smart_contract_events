import request from 'supertest';
import { createApp } from '../../src/api/server';
import { FeeCollectedEventModel } from '../../src/db/models/FeeCollectedEvent';
import { ScanStateModel } from '../../src/db/models/ScanState';
import { clearAllCollections, startInMemoryMongo, stopInMemoryMongo } from '../helpers/mongo';

const POLYGON_CHAIN_ID = 137;
const FEE_COLLECTOR = '0xbd6c7b0d2f68c2b7805d88388319cfb6ecb50ea9';
const INTEGRATOR = '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae';
const TX_HASH = '0x' + 'a'.repeat(64);
const BLOCK_HASH = '0x' + 'b'.repeat(64);

describe('API end-to-end smoke', () => {
  beforeAll(async () => {
    await startInMemoryMongo();
  });
  afterAll(async () => {
    await stopInMemoryMongo();
  });
  beforeEach(async () => {
    await clearAllCollections();
  });

  it('boots the API and round-trips /health and /events through the full middleware stack', async () => {
    const app = createApp();

    await ScanStateModel.create({
      chainId: POLYGON_CHAIN_ID,
      contractAddress: FEE_COLLECTOR,
      lastScannedBlock: 78_600_500,
    });
    await FeeCollectedEventModel.create({
      chainId: POLYGON_CHAIN_ID,
      txHash: TX_HASH,
      logIndex: 0,
      blockNumber: 78_600_500,
      blockHash: BLOCK_HASH,
      contractAddress: FEE_COLLECTOR,
      token: '0x0000000000000000000000000000000000000000',
      integrator: INTEGRATOR,
      integratorFee: '1000',
      lifiFee: '200',
    });

    const health = await request(app).get('/health');
    expect(health.status).toBe(200);
    expect(health.body.status).toBe('ok');
    expect(health.body.mongo).toBe('connected');
    expect(health.headers['cache-control']).toBe('no-store');
    expect(health.headers['x-request-id']).toBeDefined();
    expect(health.body.scans).toHaveLength(1);
    expect(health.body.scans[0]).toMatchObject({
      chainId: POLYGON_CHAIN_ID,
      contractAddress: FEE_COLLECTOR,
      lastScannedBlock: 78_600_500,
    });

    const suppliedRequestId = 'smoke-test-1';
    const events = await request(app)
      .get('/events')
      .set('X-Request-Id', suppliedRequestId)
      .query({ integrator: INTEGRATOR, chain: 'polygon' });

    expect(events.status).toBe(200);
    expect(events.headers['cache-control']).toBe('no-store');
    expect(events.headers['x-request-id']).toBe(suppliedRequestId);
    expect(events.body.pagination).toEqual({ limit: 50, offset: 0, returned: 1 });
    expect(events.body.data).toHaveLength(1);
    expect(events.body.data[0]).toMatchObject({
      chainId: POLYGON_CHAIN_ID,
      txHash: TX_HASH,
      logIndex: 0,
      blockNumber: 78_600_500,
      blockHash: BLOCK_HASH,
      contractAddress: FEE_COLLECTOR,
      integrator: INTEGRATOR,
      integratorFee: '1000',
      lifiFee: '200',
    });
  });

  it('returns INVALID_CHAIN through the same middleware stack', async () => {
    const app = createApp();
    const res = await request(app)
      .get('/events')
      .query({ integrator: INTEGRATOR, chain: 'not-a-chain' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_CHAIN');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-request-id']).toBeDefined();
  });
});
