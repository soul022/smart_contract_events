import { errSerializer } from '../../src/logger';

type Serialized = { type: string; message: string; stack?: string; cause?: Serialized };

describe('errSerializer', () => {
  it('scrubs MongoDB URIs from err.message', () => {
    const err = new Error('failed to connect mongodb://user:pass@example.com/db');
    const out = errSerializer(err) as Serialized;
    expect(out.message).not.toMatch(/user:pass/);
    expect(out.message).not.toMatch(/mongodb:\/\//);
    expect(out.message).toMatch(/\[REDACTED_URL\]/);
  });

  it('scrubs http URLs from err.stack', () => {
    const err = new Error('boom');
    err.stack = 'Error: boom\n    at fetch (https://api.example.com/key=secret)';
    const out = errSerializer(err) as Serialized;
    expect(out.stack).toBeDefined();
    expect(out.stack).not.toMatch(/api\.example\.com/);
    expect(out.stack).toMatch(/\[REDACTED_URL\]/);
  });

  it('recursively scrubs err.cause', () => {
    const inner = new Error('inner mongodb+srv://u:p@cluster/db');
    const outer = new Error('outer wrapper') as Error & { cause?: unknown };
    outer.cause = inner;
    const out = errSerializer(outer) as Serialized;
    expect(out.cause).toBeDefined();
    expect(out.cause?.message).not.toMatch(/u:p/);
    expect(out.cause?.message).toMatch(/\[REDACTED_URL\]/);
  });

  it('passes non-Error values through unchanged', () => {
    expect(errSerializer('plain string')).toBe('plain string');
    expect(errSerializer(42)).toBe(42);
    expect(errSerializer(null)).toBeNull();
  });

  it('preserves type and short messages', () => {
    const err = new TypeError('bad input');
    const out = errSerializer(err) as Serialized;
    expect(out.type).toBe('TypeError');
    expect(out.message).toBe('bad input');
  });

  it('scrubs non-built-in URI schemes (redis, postgres, amqp)', () => {
    for (const uri of [
      'redis://user:pass@cache.example.com:6379',
      'postgres://admin:secret@db.example.com/prod',
      'amqp://guest:guest@queue.example.com',
    ]) {
      const out = errSerializer(new Error(`connect failed ${uri}`)) as Serialized;
      expect(out.message).not.toContain('user:pass');
      expect(out.message).not.toContain('admin:secret');
      expect(out.message).not.toContain('guest:guest');
      expect(out.message).toMatch(/\[REDACTED_URL\]/);
    }
  });
});
