import { afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { acquire302Slot, MAX_RETRY_WAIT_MS } from "./inferenceAdmission";
import type { InferenceCandidate } from "./inferenceOrchestrator";

function route(model: string): InferenceCandidate {
  return { id: "302", label: "302", model, apiKey: randomUUID(),
    baseUrl: "https://fake.invalid", chatCompletionsUrl: "https://fake.invalid/v1/chat/completions" };
}

afterEach(() => vi.useRealTimers());

it("bounds a busy model, cancels a waiting caller independently and admits the next caller in order", async () => {
  const candidate = route("A");
  const a = await acquire302Slot(candidate), b = await acquire302Slot(candidate);
  if (!a.admitted || !b.admitted) throw Error("capacity setup");
  const controller = new AbortController();
  const cancelled = acquire302Slot(candidate, controller.signal);
  const queue = Array.from({length: 7}, () => acquire302Slot(candidate));
  expect(await acquire302Slot(candidate)).toMatchObject({ admitted: false });
  const other = await acquire302Slot({...candidate, model:"B"});
  expect(other.admitted).toBe(true);
  if (other.admitted) other.release();
  controller.abort();
  expect(await cancelled).toMatchObject({admitted:false});
  a.release();
  for (const waiting of queue) {
    const slot = await waiting;
    expect(slot.admitted).toBe(true);
    if (slot.admitted) slot.release();
  }
  b.release();
});

it("honors server cooldown across callers and limits how long a caller queues", async () => {
  vi.useFakeTimers();
  const a = route("shared-model");
  const slot = await acquire302Slot(a);
  if (!slot.admitted) throw Error("capacity setup");
  slot.release(90_000);
  expect(await acquire302Slot(a)).toMatchObject({admitted:false,retryAfterMs:90_000});
  const separate = await acquire302Slot({...a, apiKey:randomUUID()});
  expect(separate.admitted).toBe(true);
  if (separate.admitted) separate.release();
  await vi.advanceTimersByTimeAsync(90_000);
  const first = await acquire302Slot(a), second = await acquire302Slot(a);
  const waiting = acquire302Slot(a);
  await vi.advanceTimersByTimeAsync(MAX_RETRY_WAIT_MS);
  expect(await waiting).toMatchObject({admitted:false});
  if (first.admitted) first.release();
  if (second.admitted) second.release();
});
