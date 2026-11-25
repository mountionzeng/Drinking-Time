import { createHash } from "node:crypto";
import type { InferenceCandidate } from "./inferenceOrchestrator";

export const MAX_RETRY_WAIT_MS = 5_000;
const MAX_ACTIVE = 2;
const MAX_WAITING = 8;

type Lane = { active: number; blockedUntil: number; waiting: Array<() => void> };
const lanes = new Map<string, Lane>();

/** Per process and credential/endpoint/model. No user text or keys are stored. */
export async function acquire302Slot(candidate: InferenceCandidate, signal?: AbortSignal) {
  const key = createHash("sha256").update(JSON.stringify([
    candidate.endpointUrl ?? candidate.chatCompletionsUrl, candidate.apiKey, candidate.model,
  ])).digest("hex");
  const now = Date.now();
  for (const [id, lane] of lanes) {
    if (!lane.active && !lane.waiting.length && lane.blockedUntil <= now) lanes.delete(id);
  }
  const lane = lanes.get(key) ?? { active: 0, blockedUntil: 0, waiting: [] };
  lanes.set(key, lane);
  const until = now + MAX_RETRY_WAIT_MS;
  function busy() {
    return { admitted: false as const, retryAfterMs: Math.max(0, lane.blockedUntil - Date.now()) };
  }
  if (lane.waiting.length >= MAX_WAITING || lane.blockedUntil >= until) return busy();
  return new Promise<ReturnType<typeof busy> | { admitted: true; release(cooldownMs?: number): void }>(resolve => {
    let timer: ReturnType<typeof setTimeout>;
    function remove() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", check);
      lane.waiting.splice(lane.waiting.indexOf(check), 1);
    }
    function check() {
      const remaining = until - Date.now();
      const cooldown = lane.blockedUntil - Date.now();
      if (signal?.aborted || remaining <= 0 || cooldown >= remaining) {
        remove();
        resolve(busy());
      } else if (lane.active < MAX_ACTIVE && lane.waiting[0] === check && cooldown <= 0) {
        remove();
        lane.active++;
        resolve({ admitted: true, release(cooldownMs = 0) {
          lane.active--;
          if (cooldownMs > 0) lane.blockedUntil = Math.max(lane.blockedUntil, Date.now() + cooldownMs);
          lane.waiting[0]?.();
        } });
      } else {
        clearTimeout(timer);
        timer = setTimeout(check, cooldown > 0 ? Math.min(cooldown, remaining) : remaining);
        return;
      }
      lane.waiting[0]?.();
    }
    lane.waiting.push(check);
    signal?.addEventListener("abort", check, { once: true });
    check();
  });
}
