import { resolveChain } from '../../src/scanner/resolveChain';

describe('resolveChain', () => {
  it('defaults to polygon when no chain selector is provided', () => {
    const chain = resolveChain([]);
    expect(chain.name).toBe('polygon');
    expect(chain.chainId).toBe(137);
  });

  it('resolves --chainId to the matching chain config', () => {
    const chain = resolveChain(['--chainId', '137']);
    expect(chain.name).toBe('polygon');
    expect(chain.chainId).toBe(137);
  });

  it('supports --chainId=value form through parseArgs', () => {
    const chain = resolveChain(['--chainId=1']);
    expect(chain.name).toBe('ethereum');
    expect(chain.chainId).toBe(1);
  });

  it('rejects unknown flags instead of falling back to the default chain', () => {
    expect(() => resolveChain(['--chainn', 'ethereum'])).toThrow();
  });

  it('rejects positional arguments', () => {
    expect(() => resolveChain(['ethereum'])).toThrow();
  });
});
