import { ethers } from 'ethers';
import { CHAINS } from '../../src/chains';
import { FEE_COLLECTOR_ABI } from '../../src/chain/feeCollectorAbi';
import { parseFeesCollectedLog } from '../../src/scanner/fetchEvents';
import realLogs from '../fixtures/realPolygonLogs.json';

type RawLog = {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
  blockHash: string;
  logIndex: string;
  removed: boolean;
  _expected: {
    blockNumber: number;
    logIndex: number;
    token: string;
    integrator: string;
    integratorFee: string;
    lifiFee: string;
  };
};

const polygon = CHAINS.find((c) => c.name === 'polygon')!;
const iface = new ethers.utils.Interface(FEE_COLLECTOR_ABI);

const rawLogToEvent = (raw: RawLog): ethers.Event => {
  const parsed = iface.parseLog({ topics: raw.topics, data: raw.data });
  return {
    address: raw.address,
    blockNumber: Number.parseInt(raw.blockNumber, 16),
    blockHash: raw.blockHash,
    transactionHash: raw.transactionHash,
    logIndex: Number.parseInt(raw.logIndex, 16),
    transactionIndex: 0,
    removed: raw.removed,
    topics: raw.topics,
    data: raw.data,
    args: parsed.args,
    event: parsed.name,
    eventSignature: parsed.signature,
  } as unknown as ethers.Event;
};

describe('parseFeesCollectedLog against real on-chain payloads', () => {
  // Three logs captured from Polygon mainnet via an archive RPC
  // (https://polygon.gateway.tenderly.co), in the block range 78,600,000
  // to 78,600,050. Each is a real FeesCollected emission whose persisted
  // row was verified in Mongo during E2E. Locks in the mapping from raw
  // log bytes to the parsed row so any change to the parser, ABI, or
  // normalization shows up as a diff against the expected shape.
  for (const raw of realLogs as RawLog[]) {
    it(`parses real log at block ${raw._expected.blockNumber} logIndex ${raw._expected.logIndex}`, () => {
      const event = rawLogToEvent(raw);
      const parsed = parseFeesCollectedLog(polygon, event);

      expect(parsed.chainId).toBe(137);
      expect(parsed.contractAddress).toBe(polygon.contractAddress);
      expect(parsed.txHash).toBe(raw.transactionHash);
      expect(parsed.blockHash).toBe(raw.blockHash);
      expect(parsed.blockNumber).toBe(raw._expected.blockNumber);
      expect(parsed.logIndex).toBe(raw._expected.logIndex);
      expect(parsed.token).toBe(raw._expected.token);
      expect(parsed.integrator).toBe(raw._expected.integrator);
      expect(parsed.integratorFee).toBe(raw._expected.integratorFee);
      expect(parsed.lifiFee).toBe(raw._expected.lifiFee);
    });
  }

  it('preserves losslessness of large BigNumber fees as decimal strings', () => {
    const big = (realLogs as RawLog[]).find(
      (r) => r._expected.integratorFee === '3759746876400226517',
    );
    expect(big).toBeDefined();
    const event = rawLogToEvent(big!);
    const parsed = parseFeesCollectedLog(polygon, event);
    expect(parsed.integratorFee).toBe('3759746876400226517');
    expect(parsed.lifiFee).toBe('939936719100056629');
  });
});
