import request from 'supertest';
import mongoose from 'mongoose';
import { createApp } from '../../src/api/server';
import { FeeCollectedEventModel } from '../../src/db/models/FeeCollectedEvent';
import { ScanStateModel } from '../../src/db/models/ScanState';
import { clearAllCollections, startInMemoryMongo, stopInMemoryMongo } from '../helpers/mongo';
import fixtures from '../fixtures/feesCollected.json';

const VALID_CHECKSUMMED = '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE';
const VALID_LOWERCASE = '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae';
const UNKNOWN = '0x0000000000000000000000000000000000000001';

describe('API integration', () => {
  const app = createApp();

  beforeAll(async () => {
    await startInMemoryMongo();
  });
  afterAll(async () => {
    await stopInMemoryMongo();
  });
  beforeEach(async () => {
    await clearAllCollections();
    await FeeCollectedEventModel.insertMany(fixtures);
  });

  describe('GET /events', () => {
    it('returns integrator matches sorted by block desc, logIndex desc with documented headers', async () => {
      const res = await request(app).get('/events').query({ integrator: VALID_CHECKSUMMED });
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(2);
      for (const row of res.body.data) {
        expect(row.integrator).toBe(VALID_LOWERCASE);
      }
      for (let i = 1; i < res.body.data.length; i += 1) {
        const prev = res.body.data[i - 1];
        const curr = res.body.data[i];
        if (prev.blockNumber === curr.blockNumber) {
          expect(prev.logIndex).toBeGreaterThanOrEqual(curr.logIndex);
        } else {
          expect(prev.blockNumber).toBeGreaterThan(curr.blockNumber);
        }
      }
      expect(res.body.pagination.returned).toBe(res.body.data.length);
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('returns empty data for an unknown but valid integrator', async () => {
      const res = await request(app).get('/events').query({ integrator: UNKNOWN });
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.pagination.returned).toBe(0);
    });

    it('clamps limit > 100 to 100 and parses offset', async () => {
      const res = await request(app)
        .get('/events')
        .query({ integrator: VALID_LOWERCASE, limit: '500', offset: '0' });
      expect(res.status).toBe(200);
      expect(res.body.pagination.limit).toBe(100);
      expect(res.body.pagination.offset).toBe(0);
    });
  });

  describe('GET /events filters', () => {
    const POLYGON_CONTRACT = '0xbd6c7b0d2f68c2b7805d88388319cfb6ecb50ea9';
    const ETHEREUM_CONTRACT = '0x3ef238c36035880efbdfa239d218186b79ad1d6f';
    const USDC = '0xc2132d05d31c914a87c6611c10748aeb04b58e8f';
    const DAI = '0x6b175474e89094c44da98b954eedeac495271d0f';

    const baseRow = {
      blockHash: '0x' + 'a'.repeat(64),
      contractAddress: POLYGON_CONTRACT,
      token: USDC,
      integrator: VALID_LOWERCASE,
      integratorFee: '1000',
      lifiFee: '200',
    };

    const seed = async (rows: object[]): Promise<void> => {
      await clearAllCollections();
      await FeeCollectedEventModel.insertMany(rows);
    };

    it.each([
      {
        name: '?chain=polygon filters to Polygon rows only',
        rows: [
          {
            ...baseRow,
            chainId: 137,
            txHash: '0x' + '1'.repeat(64),
            logIndex: 0,
            blockNumber: 100,
          },
          { ...baseRow, chainId: 1, txHash: '0x' + '2'.repeat(64), logIndex: 0, blockNumber: 200 },
        ],
        query: { chain: 'polygon' },
        expected: { chainId: 137 },
      },
      {
        name: '?chainId=1 filters to Ethereum rows only',
        rows: [
          {
            ...baseRow,
            chainId: 137,
            txHash: '0x' + '3'.repeat(64),
            logIndex: 0,
            blockNumber: 100,
          },
          { ...baseRow, chainId: 1, txHash: '0x' + '4'.repeat(64), logIndex: 0, blockNumber: 200 },
        ],
        query: { chainId: '1' },
        expected: { chainId: 1 },
      },
      {
        name: '?contractAddress filters to that contract only',
        rows: [
          {
            ...baseRow,
            chainId: 1,
            contractAddress: POLYGON_CONTRACT,
            txHash: '0x' + '5'.repeat(64),
            logIndex: 0,
            blockNumber: 100,
          },
          {
            ...baseRow,
            chainId: 1,
            contractAddress: ETHEREUM_CONTRACT,
            txHash: '0x' + '6'.repeat(64),
            logIndex: 0,
            blockNumber: 200,
          },
        ],
        query: { contractAddress: ETHEREUM_CONTRACT },
        expected: { contractAddress: ETHEREUM_CONTRACT },
      },
      {
        name: '?token filters to that token only',
        rows: [
          {
            ...baseRow,
            chainId: 137,
            token: USDC,
            txHash: '0x' + '7'.repeat(64),
            logIndex: 0,
            blockNumber: 100,
          },
          {
            ...baseRow,
            chainId: 137,
            token: DAI,
            txHash: '0x' + '8'.repeat(64),
            logIndex: 0,
            blockNumber: 200,
          },
        ],
        query: { token: DAI },
        expected: { token: DAI },
      },
    ])('$name', async ({ rows, query, expected }) => {
      await seed(rows);
      const res = await request(app)
        .get('/events')
        .query({ integrator: VALID_LOWERCASE, ...query });
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0]).toMatchObject(expected);
    });

    it('combines chain, contractAddress, and token into a scoped intersection', async () => {
      await seed([
        // matches the full filter set
        {
          ...baseRow,
          chainId: 1,
          contractAddress: ETHEREUM_CONTRACT,
          token: USDC,
          txHash: '0x' + '9'.repeat(64),
          logIndex: 0,
          blockNumber: 100,
        },
        // wrong chain
        {
          ...baseRow,
          chainId: 137,
          contractAddress: ETHEREUM_CONTRACT,
          token: USDC,
          txHash: '0x' + 'a'.repeat(64),
          logIndex: 0,
          blockNumber: 100,
        },
        // wrong contract
        {
          ...baseRow,
          chainId: 1,
          contractAddress: POLYGON_CONTRACT,
          token: USDC,
          txHash: '0x' + 'b'.repeat(64),
          logIndex: 0,
          blockNumber: 100,
        },
        // wrong token
        {
          ...baseRow,
          chainId: 1,
          contractAddress: ETHEREUM_CONTRACT,
          token: DAI,
          txHash: '0x' + 'c'.repeat(64),
          logIndex: 0,
          blockNumber: 100,
        },
      ]);
      const res = await request(app).get('/events').query({
        integrator: VALID_LOWERCASE,
        chain: 'ethereum',
        contractAddress: ETHEREUM_CONTRACT,
        token: USDC,
      });
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].chainId).toBe(1);
      expect(res.body.data[0].contractAddress).toBe(ETHEREUM_CONTRACT);
      expect(res.body.data[0].token).toBe(USDC);
    });

    it('paginates correctly under combined filters', async () => {
      const rows = [];
      for (let i = 0; i < 5; i += 1) {
        rows.push({
          ...baseRow,
          chainId: 137,
          txHash: '0x' + i.toString().padStart(64, 'd'),
          logIndex: 0,
          blockNumber: 100 + i,
        });
      }
      await seed(rows);
      const page1 = await request(app)
        .get('/events')
        .query({ integrator: VALID_LOWERCASE, chain: 'polygon', limit: '2', offset: '0' });
      const page2 = await request(app)
        .get('/events')
        .query({ integrator: VALID_LOWERCASE, chain: 'polygon', limit: '2', offset: '2' });
      expect(page1.body.data).toHaveLength(2);
      expect(page2.body.data).toHaveLength(2);
      const txs1 = page1.body.data.map((r: { txHash: string }) => r.txHash);
      const txs2 = page2.body.data.map((r: { txHash: string }) => r.txHash);
      for (const tx of txs1) expect(txs2).not.toContain(tx);
    });

    it('uses deterministic tie-breakers when blockNumber and logIndex match', async () => {
      await seed([
        {
          ...baseRow,
          chainId: 137,
          txHash: '0x' + 'b'.repeat(64),
          logIndex: 0,
          blockNumber: 100,
        },
        {
          ...baseRow,
          chainId: 1,
          txHash: '0x' + 'c'.repeat(64),
          logIndex: 0,
          blockNumber: 100,
        },
        {
          ...baseRow,
          chainId: 1,
          txHash: '0x' + 'a'.repeat(64),
          logIndex: 0,
          blockNumber: 100,
        },
      ]);
      const res = await request(app).get('/events').query({ integrator: VALID_LOWERCASE });
      expect(
        res.body.data.map((r: { chainId: number; txHash: string }) => [r.chainId, r.txHash]),
      ).toEqual([
        [1, '0x' + 'a'.repeat(64)],
        [1, '0x' + 'c'.repeat(64)],
        [137, '0x' + 'b'.repeat(64)],
      ]);
    });
  });

  describe('GET /health', () => {
    it('returns 200 with scan rows and ageSeconds driven by lastRunAt when connected', async () => {
      const longAgo = new Date(Date.now() - 60 * 60 * 1000);
      const recently = new Date(Date.now() - 5 * 1000);
      // bypass timestamps middleware so updatedAt is stale but lastRunAt fresh
      await ScanStateModel.collection.insertOne({
        chainId: 137,
        contractAddress: '0xbd6c7b0d2f68c2b7805d88388319cfb6ecb50ea9',
        lastScannedBlock: 78_600_500,
        lastRunAt: recently,
        createdAt: longAgo,
        updatedAt: longAgo,
      });
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.mongo).toBe('connected');
      expect(res.body.scans[0].lastRunAt).toBe(recently.toISOString());
      expect(res.body.scans[0].ageSeconds).toBeLessThan(60);
    });

    it('returns 503 + degraded when mongo is disconnected', async () => {
      Object.defineProperty(mongoose.connection, 'readyState', {
        value: 0,
        configurable: true,
      });
      try {
        const res = await request(app).get('/health');
        expect(res.status).toBe(503);
        expect(res.body.status).toBe('degraded');
        expect(res.body.mongo).toBe('disconnected');
      } finally {
        // Remove the masking value-property so the underlying prototype getter
        // resumes returning the live readyState. Restoring with `value: original`
        // would leave a frozen number where mongoose expects a live getter.
        delete (mongoose.connection as unknown as Record<string, unknown>).readyState;
      }
    });
  });

  describe('error handler', () => {
    it('returns 500 + INTERNAL_ERROR when the events route throws', async () => {
      const spy = jest.spyOn(FeeCollectedEventModel, 'find').mockImplementationOnce((() => {
        throw new Error('boom');
      }) as unknown as typeof FeeCollectedEventModel.find);
      const res = await request(app).get('/events').query({ integrator: VALID_LOWERCASE });
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
      spy.mockRestore();
    });
  });

  describe('request id', () => {
    it('mints an X-Request-Id when the caller does not supply one', async () => {
      const res = await request(app).get('/health');
      const id = res.headers['x-request-id'];
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });

    it('echoes a caller-supplied X-Request-Id', async () => {
      const supplied = 'caller-trace-1234';
      const res = await request(app).get('/health').set('X-Request-Id', supplied);
      expect(res.headers['x-request-id']).toBe(supplied);
    });
  });

  describe('url length guard', () => {
    it('rejects very long URLs with 414 and still emits documented headers', async () => {
      const pad = 'a'.repeat(5000);
      const res = await request(app).get(`/events?integrator=${VALID_LOWERCASE}&pad=${pad}`);
      expect(res.status).toBe(414);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['x-request-id']).toBeDefined();
    });
  });
});
