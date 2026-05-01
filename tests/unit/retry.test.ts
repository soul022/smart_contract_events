import { classifyError, isRangeTooLarge, withRetry } from '../../src/retry';

describe('classifyError', () => {
  it('flags JSON-RPC range error code -32602 as range-too-large', () => {
    expect(classifyError({ code: -32602, message: 'invalid params' })).toBe('range-too-large');
  });

  it('flags message containing "result set too large" as range-too-large', () => {
    expect(classifyError(new Error('query returned more than 10000 results'))).toBe(
      'range-too-large',
    );
  });

  it('flags ECONNRESET / timeout as retry', () => {
    expect(classifyError(new Error('socket hang up'))).toBe('retry');
    expect(classifyError(new Error('ETIMEDOUT'))).toBe('retry');
    expect(classifyError({ code: 'NETWORK_ERROR', message: 'x' })).toBe('retry');
  });

  it('flags 5xx server error message as retry', () => {
    expect(classifyError(new Error('502 bad gateway'))).toBe('retry');
    expect(classifyError(new Error('service unavailable'))).toBe('retry');
  });

  it('flags revert / 4xx style as fail-fast', () => {
    expect(classifyError(new Error('execution reverted'))).toBe('fail-fast');
    expect(classifyError({ message: 'invalid signature' })).toBe('fail-fast');
  });
});

describe('withRetry', () => {
  const noDelays = { delaysMs: [0, 0, 0], label: 'test' };

  it('returns successful value on first try', async () => {
    const op = jest.fn().mockResolvedValue(42);
    await expect(withRetry(op, noDelays)).resolves.toBe(42);
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('retries transient errors and eventually succeeds', async () => {
    const op = jest
      .fn()
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockRejectedValueOnce(new Error('ETIMEDOUT'))
      .mockResolvedValue('ok');
    await expect(withRetry(op, noDelays)).resolves.toBe('ok');
    expect(op).toHaveBeenCalledTimes(3);
  });

  it('does not retry fail-fast errors', async () => {
    const op = jest.fn().mockRejectedValue(new Error('execution reverted'));
    await expect(withRetry(op, noDelays)).rejects.toThrow('execution reverted');
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('wraps range-too-large and surfaces immediately', async () => {
    const op = jest.fn().mockRejectedValue({ code: -32602, message: 'too large' });
    await expect(withRetry(op, noDelays)).rejects.toThrow(/range-too-large/);
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('exposes a type guard for range-too-large', () => {
    expect(isRangeTooLarge(new Error('plain'))).toBe(false);
    const wrapped = Object.assign(new Error('x'), { __rangeTooLarge: true });
    expect(isRangeTooLarge(wrapped)).toBe(true);
  });

  it('aborts backoff and rethrows when cancelled mid-sleep', async () => {
    const op = jest.fn().mockRejectedValueOnce(new Error('socket hang up'));
    let cancelFlag = false;
    setTimeout(() => {
      cancelFlag = true;
    }, 50);
    const start = Date.now();
    await expect(
      withRetry(op, { delaysMs: [5_000], label: 'cancel', cancelled: () => cancelFlag }),
    ).rejects.toThrow('socket hang up');
    expect(Date.now() - start).toBeLessThan(2_000);
    expect(op).toHaveBeenCalledTimes(1);
  });
});
