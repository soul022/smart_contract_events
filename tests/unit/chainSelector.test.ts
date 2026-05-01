import { parseChainSelector } from '../../src/chains';

describe('parseChainSelector', () => {
  it('returns ok with undefined chainId when neither input is given', () => {
    const r = parseChainSelector({});
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.chainId).toBeUndefined();
  });

  it('resolves chainId from a name', () => {
    const r = parseChainSelector({ chain: 'polygon' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.chainId).toBe(137);
  });

  it('resolves chainId from a numeric id', () => {
    const r = parseChainSelector({ chainId: '137' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.chainId).toBe(137);
  });

  it('rejects when chain and chainId disagree', () => {
    const r = parseChainSelector({ chain: 'polygon', chainId: '1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/disagree/);
  });

  it('rejects unknown chain name', () => {
    const r = parseChainSelector({ chain: 'avalanche' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/avalanche/);
  });

  it('rejects malformed chainId (non-numeric / zero / negative)', () => {
    for (const bad of ['abc', '0', '-1']) {
      const r = parseChainSelector({ chainId: bad });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toMatch(/positive integer/);
    }
  });
});
