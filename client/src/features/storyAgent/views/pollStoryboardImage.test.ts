import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { pollStoryboardImage } from "./pollStoryboardImage";
import { IMAGE_TASK_POLL_LIMIT_MS, IMAGE_TASK_POLL_MS } from "@/lib/imageTaskPolling";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const pending = { status: "error" as const, recoveryPending: true };

it("retries transient reads and pending replies, preserving the completed result", async () => {
  const done = { status: "ok" as const, candidates: [1, 2, 3, 4] };
  const query = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(pending).mockResolvedValueOnce(done);
  const result = pollStoryboardImage(query, new AbortController().signal);
  await vi.advanceTimersByTimeAsync(IMAGE_TASK_POLL_MS * 2);
  expect(await result).toBe(done);
  expect(query).toHaveBeenCalledTimes(3);
  expect(vi.getTimerCount()).toBe(0);
});

it("does not overlap a slow query or continue after leaving the story", async () => {
  const controller = new AbortController();
  let release!: (value: typeof pending) => void;
  const query = vi.fn(() => new Promise<typeof pending>(resolve => { release = resolve; }));
  const result = pollStoryboardImage(query, controller.signal);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(query).toHaveBeenCalledTimes(1);
  controller.abort();
  expect(await result).toEqual({ status: "cancelled" });
  release(pending);
  await vi.advanceTimersByTimeAsync(IMAGE_TASK_POLL_LIMIT_MS);
  expect(query).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it("cancels between polls and never queries an already aborted scope", async () => {
  const controller = new AbortController();
  const query = vi.fn().mockResolvedValue(pending);
  const first = pollStoryboardImage(query, controller.signal);
  await vi.advanceTimersByTimeAsync(0);
  controller.abort();
  expect(await first).toEqual({ status: "cancelled" });
  expect(await pollStoryboardImage(query, controller.signal)).toEqual({ status: "cancelled" });
  await vi.advanceTimersByTimeAsync(IMAGE_TASK_POLL_MS);
  expect(query).toHaveBeenCalledTimes(1);
});

it.each([false, undefined])("stops on a non-pending error (%s), including missing/unknown tasks", async recoveryPending => {
  const error = { status: "error" as const, recoveryPending, error: "无法恢复" };
  const query = vi.fn().mockResolvedValue(error);
  expect(await pollStoryboardImage(query, new AbortController().signal)).toBe(error);
  await vi.advanceTimersByTimeAsync(IMAGE_TASK_POLL_LIMIT_MS);
  expect(query).toHaveBeenCalledTimes(1);
});

it("bounds continued pending replies at ten minutes", async () => {
  const query = vi.fn().mockResolvedValue(pending);
  const result = pollStoryboardImage(query, new AbortController().signal);
  await vi.advanceTimersByTimeAsync(IMAGE_TASK_POLL_LIMIT_MS);
  expect(await result).toEqual({ status: "timeout" });
  expect(query).toHaveBeenCalledTimes(IMAGE_TASK_POLL_LIMIT_MS / IMAGE_TASK_POLL_MS);
  expect(vi.getTimerCount()).toBe(0);
});

it("bounds a hung query and ignores its late success", async () => {
  let release!: (value: { status: "ok" }) => void;
  const query = vi.fn(() => new Promise<{ status: "ok" }>(resolve => { release = resolve; }));
  const result = pollStoryboardImage(query, new AbortController().signal);
  await vi.advanceTimersByTimeAsync(IMAGE_TASK_POLL_LIMIT_MS);
  expect(await result).toEqual({ status: "timeout" });
  release({ status: "ok" });
  await vi.advanceTimersByTimeAsync(IMAGE_TASK_POLL_MS);
  expect(query).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
