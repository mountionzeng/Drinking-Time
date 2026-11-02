import { afterEach, describe, expect, it, vi } from 'vitest';
import { StoryboardPreflightTimeout, withStoryboardPreflightTimeout } from './storyboardPreflightTimeout';

afterEach(() => vi.useRealTimers());
describe('storyboard video preflight deadline', () => {
  it('returns the result and clears its timer when the check completes', async () => {
    vi.useFakeTimers();
    await expect(withStoryboardPreflightTimeout(Promise.resolve('ok'))).resolves.toBe('ok');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('stops a hung pre-submit check without allowing a late result to continue the flow', async () => {
    vi.useFakeTimers();
    let finish!: (value: string) => void;
    const analysis = new Promise<string>(resolve => { finish = resolve; });
    const submitVideo = vi.fn();
    const flow = withStoryboardPreflightTimeout(analysis).then(submitVideo);
    const rejected = expect(flow).rejects.toBeInstanceOf(StoryboardPreflightTimeout);
    await vi.advanceTimersByTimeAsync(30_000);
    await rejected;
    finish('late');
    await Promise.resolve();
    expect(submitVideo).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('propagates a normal failure and clears its timer', async () => {
    vi.useFakeTimers();
    await expect(withStoryboardPreflightTimeout(Promise.reject(new Error('offline')))).rejects.toThrow('offline');
    expect(vi.getTimerCount()).toBe(0);
  });
});
