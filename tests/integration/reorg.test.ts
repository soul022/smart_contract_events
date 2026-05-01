import { ethers } from 'ethers';
import { CHAINS, ChainConfig } from '../../src/chains';
import { FeeCollectedEventModel } from '../../src/db/models/FeeCollectedEvent';
import { revalidateRecentWindow } from '../../src/scanner/reorg';
import { clearAllCollections, startInMemoryMongo, stopInMemoryMongo } from '../helpers/mongo';
import { buildEvent } from '../helpers/buildEvent';

// Use a small reorgWindow so individual tests stay readable. The 64 default
// would force every fixture to span 64 blocks; 8 makes the math obvious.
// Also override startBlock to 0 so the early-return on
// `lastScannedBlock < startBlock` only fires for the explicit cold-start case.
const polygon: ChainConfig = {
  ...CHAINS.find((c) => c.name === 'polygon')!,
  reorgWindow: 8,
  startBlock: 0,
};

const tx = (suffix: string): string => `0x${suffix.padEnd(64, '0')}`;

type QueryFilterFn = (
  filter: unknown,
  fromBlock: number,
  toBlock: number,
) => Promise<ethers.Event[]>;

type FakeContract = {
  filters: { FeesCollected: () => Record<string, unknown> };
  queryFilter: jest.Mock<Promise<ethers.Event[]>, [unknown, number, number]>;
};

const makeContract = (impl: QueryFilterFn): FakeContract => ({
  filters: { FeesCollected: () => ({}) },
  queryFilter: jest.fn(impl),
});

const insertRow = async (blockNumber: number, txSuffix: string, logIndex = 0): Promise<void> => {
  await FeeCollectedEventModel.create({
    chainId: polygon.chainId,
    txHash: tx(txSuffix),
    logIndex,
    blockNumber,
    blockHash: `0x${'b'.repeat(64)}`,
    contractAddress: polygon.contractAddress,
    token: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f',
    integrator: '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae',
    integratorFee: '1000',
    lifiFee: '200',
  });
};

describe('revalidateRecentWindow', () => {
  beforeAll(async () => {
    await startInMemoryMongo();
  });
  afterAll(async () => {
    await stopInMemoryMongo();
  });
  beforeEach(async () => {
    await clearAllCollections();
  });

  it('deletes a stored event whose canonical block now has no event (removed by reorg)', async () => {
    // Stored: row at block 100. Canonical: window returns no events.
    await insertRow(100, 'aa');
    const contract = makeContract(async () => []);

    await revalidateRecentWindow(polygon, contract as unknown as ethers.Contract, 100);

    const remaining = await FeeCollectedEventModel.find({}).lean();
    expect(remaining).toHaveLength(0);
  });

  it('inserts a canonical event in a previously-empty block (new event after reorg)', async () => {
    // Stored: nothing at block 100. Canonical: one event at block 100.
    const contract = makeContract(async (_f, from, to) => {
      expect(from).toBe(93);
      expect(to).toBe(100);
      return [buildEvent({ blockNumber: 100, logIndex: 0, txHash: tx('cc') })];
    });

    await revalidateRecentWindow(polygon, contract as unknown as ethers.Contract, 100);

    const rows = await FeeCollectedEventModel.find({}).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0].blockNumber).toBe(100);
    expect(rows[0].txHash).toBe(tx('cc'));
  });

  it('leaves rows unchanged when canonical and stored agree (no reorg)', async () => {
    await insertRow(100, 'dd');
    const contract = makeContract(async () => [
      buildEvent({ blockNumber: 100, logIndex: 0, txHash: tx('dd') }),
    ]);

    await revalidateRecentWindow(polygon, contract as unknown as ethers.Contract, 100);

    const rows = await FeeCollectedEventModel.find({}).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0].txHash).toBe(tx('dd'));
  });

  it('skips revalidation when lastScannedBlock is below startBlock (cold start)', async () => {
    const contract = makeContract(async () => []);
    await revalidateRecentWindow(
      polygon,
      contract as unknown as ethers.Contract,
      polygon.startBlock - 1,
    );
    expect(contract.queryFilter).not.toHaveBeenCalled();
  });

  it('queries only the bounded reorg window, not [reorgFrom, safeTip], even when scanner is far behind', async () => {
    // The bug class this test pins: a far-behind scanner must NOT trigger a
    // reorg-validation re-fetch over the entire backlog. The window is
    // bounded by reorgWindow regardless of how far behind we are.
    const lastScannedBlock = 1_000;
    const contract = makeContract(async () => []);

    await revalidateRecentWindow(polygon, contract as unknown as ethers.Contract, lastScannedBlock);

    expect(contract.queryFilter).toHaveBeenCalledTimes(1);
    const callArgs = contract.queryFilter.mock.calls[0];
    expect(callArgs[1]).toBe(993); // lastScannedBlock - reorgWindow + 1 = 1000 - 8 + 1
    expect(callArgs[2]).toBe(1_000); // lastScannedBlock, NOT safeTip / chain tip
  });

  it('replaces a stale event whose txHash changed in the new chain', async () => {
    // Same logical event re-mined in a different transaction after a reorg.
    // Old txHash 'ee' must be deleted, new txHash 'ff' must be inserted.
    await insertRow(100, 'ee');
    const contract = makeContract(async () => [
      buildEvent({ blockNumber: 100, logIndex: 0, txHash: tx('ff') }),
    ]);

    await revalidateRecentWindow(polygon, contract as unknown as ethers.Contract, 100);

    const rows = await FeeCollectedEventModel.find({}).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0].txHash).toBe(tx('ff'));
  });

  it('skips the stale-row delete when cancelled after canonical write', async () => {
    // pins the safety property: cancellation between write and delete leaves
    // Mongo as a strict superset of canonical, never a hole
    await insertRow(100, 'aa');
    let cancelFlag = false;
    const contract = makeContract(async () => {
      cancelFlag = true;
      return [];
    });

    await revalidateRecentWindow(polygon, contract as unknown as ethers.Contract, 100, {
      cancelled: () => cancelFlag,
    });

    const rows = await FeeCollectedEventModel.find({}).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0].txHash).toBe(tx('aa'));
  });

  it('updates canonical row fields when txHash and logIndex stay the same after reorg', async () => {
    await insertRow(100, 'aa');
    const contract = makeContract(async () => [
      buildEvent({
        blockNumber: 101,
        blockHash: `0x${'c'.repeat(64)}`,
        logIndex: 0,
        txHash: tx('aa'),
      }),
    ]);

    await revalidateRecentWindow(polygon, contract as unknown as ethers.Contract, 101);

    const rows = await FeeCollectedEventModel.find({}).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0].txHash).toBe(tx('aa'));
    expect(rows[0].blockNumber).toBe(101);
    expect(rows[0].blockHash).toBe(`0x${'c'.repeat(64)}`);
  });
});
