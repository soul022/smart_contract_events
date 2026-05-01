import { normalizeAddress, tryNormalizeAddress } from '../../src/address';

describe('address helpers', () => {
  const checksummed = '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE';
  const lowercased = '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae';

  it.each([checksummed, lowercased])(
    'normalizes valid input %s to lowercase canonical',
    (input) => {
      expect(normalizeAddress(input)).toBe(lowercased);
      expect(tryNormalizeAddress(input)).toBe(lowercased);
    },
  );

  it.each(['not-an-address', '0x1234'])('rejects invalid input %s', (input) => {
    expect(() => normalizeAddress(input)).toThrow();
    expect(tryNormalizeAddress(input)).toBeNull();
  });
});
