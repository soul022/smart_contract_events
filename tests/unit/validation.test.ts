import { parseEventsQuery } from '../../src/api/validation';

const VALID = '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE';
const VALID_LC = '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae';

describe('parseEventsQuery', () => {
  it('accepts a checksummed integrator and returns lowercased', () => {
    const r = parseEventsQuery({ integrator: VALID });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.integrator).toBe(VALID_LC);
  });

  it('rejects missing integrator with INVALID_ADDRESS', () => {
    const r = parseEventsQuery({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_ADDRESS');
  });

  it('rejects malformed integrator with INVALID_ADDRESS', () => {
    const r = parseEventsQuery({ integrator: '0xnope' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_ADDRESS');
  });

  it('clamps limit > 100 down to 100', () => {
    const r = parseEventsQuery({ integrator: VALID, limit: '500' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.limit).toBe(100);
  });

  it('uses defaults when limit/offset are absent', () => {
    const r = parseEventsQuery({ integrator: VALID });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.limit).toBe(50);
      expect(r.value.offset).toBe(0);
    }
  });

  it('rejects negative offset with INVALID_PAGINATION', () => {
    const r = parseEventsQuery({ integrator: VALID, offset: '-1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_PAGINATION');
  });

  it('rejects non-numeric limit with INVALID_PAGINATION', () => {
    const r = parseEventsQuery({ integrator: VALID, limit: 'abc' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_PAGINATION');
  });

  it('resolves chain=polygon to chainId 137', () => {
    const r = parseEventsQuery({ integrator: VALID, chain: 'polygon' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.chainId).toBe(137);
  });

  it('rejects disagreeing chain and chainId with INVALID_CHAIN', () => {
    const r = parseEventsQuery({ integrator: VALID, chain: 'polygon', chainId: '1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_CHAIN');
  });

  it('normalizes contractAddress to lowercase', () => {
    const r = parseEventsQuery({
      integrator: VALID,
      contractAddress: '0xbD6C7B0d2f68c2b7805d88388319cfB6EcB50eA9',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.contractAddress).toBe('0xbd6c7b0d2f68c2b7805d88388319cfb6ecb50ea9');
  });

  it('rejects malformed contractAddress with field-identifying message', () => {
    const r = parseEventsQuery({ integrator: VALID, contractAddress: '0xnope' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('INVALID_ADDRESS');
      expect(r.error.message).toMatch(/contractAddress/);
    }
  });

  it('normalizes token to lowercase', () => {
    const r = parseEventsQuery({
      integrator: VALID,
      token: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.token).toBe('0xc2132d05d31c914a87c6611c10748aeb04b58e8f');
  });

  it('rejects malformed token with field-identifying message', () => {
    const r = parseEventsQuery({ integrator: VALID, token: '0xnope' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('INVALID_ADDRESS');
      expect(r.error.message).toMatch(/token/);
    }
  });

  it('populates all filters together', () => {
    const r = parseEventsQuery({
      integrator: VALID,
      chain: 'polygon',
      contractAddress: '0xbd6c7b0d2f68c2b7805d88388319cfb6ecb50ea9',
      token: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f',
      limit: '10',
      offset: '5',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.integrator).toBe(VALID_LC);
      expect(r.value.chainId).toBe(137);
      expect(r.value.contractAddress).toBe('0xbd6c7b0d2f68c2b7805d88388319cfb6ecb50ea9');
      expect(r.value.token).toBe('0xc2132d05d31c914a87c6611c10748aeb04b58e8f');
      expect(r.value.limit).toBe(10);
      expect(r.value.offset).toBe(5);
    }
  });

  it('omits optional filters when absent', () => {
    const r = parseEventsQuery({ integrator: VALID });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.chainId).toBeUndefined();
      expect(r.value.contractAddress).toBeUndefined();
      expect(r.value.token).toBeUndefined();
    }
  });

  const ZERO = '0x0000000000000000000000000000000000000000';

  it('rejects zero-address integrator with INVALID_ADDRESS', () => {
    const r = parseEventsQuery({ integrator: ZERO });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('INVALID_ADDRESS');
      expect(r.error.message).toMatch(/non-zero/);
    }
  });

  it('rejects zero-address contractAddress with INVALID_ADDRESS', () => {
    const r = parseEventsQuery({ integrator: VALID, contractAddress: ZERO });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_ADDRESS');
  });

  it('accepts zero-address token (native asset signal)', () => {
    const r = parseEventsQuery({ integrator: VALID, token: ZERO });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.token).toBe(ZERO);
  });

  it.each([
    {
      name: 'chain',
      query: { integrator: VALID, chain: ['polygon', 'ethereum'] },
      code: 'INVALID_CHAIN',
    },
    {
      name: 'limit',
      query: { integrator: VALID, limit: ['10', '20'] },
      code: 'INVALID_PAGINATION',
    },
    {
      name: 'token',
      query: { integrator: VALID, token: [ZERO, ZERO] },
      code: 'INVALID_ADDRESS',
    },
  ] as const)('rejects duplicate $name with $code', ({ query, code }) => {
    const r = parseEventsQuery(query);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe(code);
  });
});
