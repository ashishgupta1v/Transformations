// tests/utils/retry.test.js
jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const { withRetry, sleep } = require('../../src/utils/retry');

describe('withRetry', () => {
  it('returns the result immediately on first success (no retry)', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { label: 'test-op', maxAttempts: 3, delayMs: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and eventually succeeds', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValueOnce('recovered');

    const result = await withRetry(fn, {
      label: 'flaky-op',
      maxAttempts: 5,
      delayMs: 1,
      backoffMultiplier: 1,
    });

    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws the last error after exhausting all attempts', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('always fails'));

    await expect(
      withRetry(fn, { label: 'doomed-op', maxAttempts: 3, delayMs: 1 })
    ).rejects.toThrow('always fails');

    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('stops retrying early when shouldRetry returns false', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('non-retryable'));
    const shouldRetry = jest.fn().mockReturnValue(false);

    await expect(
      withRetry(fn, { label: 'non-retry-op', maxAttempts: 5, delayMs: 1, shouldRetry })
    ).rejects.toThrow('non-retryable');

    expect(fn).toHaveBeenCalledTimes(1);
    expect(shouldRetry).toHaveBeenCalledTimes(1);
  });

  it('applies exponential backoff between attempts', async () => {
    const delays = [];
    const realSetTimeout = global.setTimeout;
    jest.spyOn(global, 'setTimeout').mockImplementation((cb, ms) => {
      delays.push(ms);
      return realSetTimeout(cb, 0);
    });

    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('e1'))
      .mockRejectedValueOnce(new Error('e2'))
      .mockResolvedValueOnce('done');

    await withRetry(fn, { label: 'backoff-op', maxAttempts: 5, delayMs: 100, backoffMultiplier: 2 });

    expect(delays).toEqual([100, 200]);
    global.setTimeout.mockRestore();
  });
});

describe('sleep', () => {
  it('resolves after roughly the given duration', async () => {
    const start = Date.now();
    await sleep(20);
    expect(Date.now() - start).toBeGreaterThanOrEqual(15);
  });
});
