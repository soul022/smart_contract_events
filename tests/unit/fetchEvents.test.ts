import { parseFeesCollectedLog } from '../../src/scanner/fetchEvents';
import { CHAINS } from '../../src/chains';
import { buildEvent } from '../helpers/buildEvent';

const polygon = CHAINS.find((c) => c.name === 'polygon')!;

describe('parseFeesCollectedLog', () => {
  it('parses a checksummed log into the canonical lowercased shape', () => {
    const parsed = parseFeesCollectedLog(polygon, buildEvent());
    expect(parsed.chainId).toBe(137);
    expect(parsed.txHash).toBe(parsed.txHash.toLowerCase());
    expect(parsed.txHash.startsWith('0xabcdef')).toBe(true);
    expect(parsed.token).toBe('0xc2132d05d31c914a87c6611c10748aeb04b58e8f');
    expect(parsed.integrator).toBe('0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae');
    expect(parsed.integratorFee).toBe('1000000');
    expect(parsed.lifiFee).toBe('200000');
    expect(parsed.blockHash).toBe(parsed.blockHash.toLowerCase());
    expect(parsed.contractAddress).toBe(polygon.contractAddress);
  });

  it('preserves native-asset token (0x0) without rejection', () => {
    const ev = buildEvent({
      token: '0x0000000000000000000000000000000000000000',
      integratorFee: '5000000000000000',
      lifiFee: '1000000000000000',
    });
    const parsed = parseFeesCollectedLog(polygon, ev);
    expect(parsed.token).toBe('0x0000000000000000000000000000000000000000');
    expect(parsed.integratorFee).toBe('5000000000000000');
  });

  it('throws when args are missing', () => {
    const ev = buildEvent({ args: undefined });
    expect(() => parseFeesCollectedLog(polygon, ev)).toThrow(/missing args/);
  });
});
