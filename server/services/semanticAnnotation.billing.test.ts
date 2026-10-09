import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Shared-DB admission is covered separately; retain the real ledger and wrapper.
vi.mock("./computeRequestAccess", async importActual => ({
  ...(await importActual<typeof import("./computeRequestAccess")>()),
  assertComputeRequestAccess: async () => {},
  guardComputeFetch: <F>(fetcher: F) => fetcher,
}));
import { ENV } from "../_core/env";
import { findBillingOperation, getUserByOpenId, resetMemoryStateForTesting, upsertUser } from "../db";
import { getAccountBalance, grantCredit } from "./computeLedger";
import { generateAnnotation, resetCircuitBreaker } from "./semanticAnnotation";

const saved = { ...ENV };
let userId: number;
const params = () => ({
  userId, snapshotId: 10, previousSnapshotId: null, previousAnnotations: [],
  diff: {
    cards: { deleted: [], added: [], modified: [] },
    script: { deleted: [], added: [], modified: [] },
    shots: { deleted: [], added: [], modified: [] },
  },
});

beforeEach(async () => {
  resetMemoryStateForTesting();
  resetCircuitBreaker();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("TEXT_PRICE_OPENAI_NEXT_PER_1K_YUAN", "1");
  vi.stubEnv("SEMANTIC_ANNOTATION_MAX_COST_YUAN", "0.05");
  ENV.openaiNextApiKey = "fake";
  ENV.openaiNextBaseUrl = "https://unused.invalid";
  ENV.openaiNextTextModel = "review-model";
  ENV.api302Key = "";
  await upsertUser({ openId: "annotation-billing", loginMethod: "email" });
  userId = (await getUserByOpenId("annotation-billing"))!.id;
  await grantCredit({ userId, amountMinor: 1_000_000, idempotencyKey: "credit", reason: "test" });
});

afterEach(() => {
  vi.useRealTimers();
  Object.assign(ENV, saved);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function response(usage?: { total_tokens: number }) {
  return new Response(JSON.stringify({
    choices: [{ message: { role: "assistant", content: '{"factualChanges":[],"inferredPreferences":[]}' } }],
    ...(usage ? { usage } : {}),
  }));
}

describe("semantic annotation billing", () => {
  it("missing usage charges the hold instead of zero", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => response());
    await generateAnnotation(params());
    expect(await findBillingOperation("semantic_annotation:10")).toMatchObject({
      status: "settled", actualCostMinor: 50_000,
    });
  });

  it("cost above the hold reaches the ledger exception path", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => response({ total_tokens: 200 }));
    await generateAnnotation(params());
    expect(await findBillingOperation("semantic_annotation:10")).toMatchObject({
      status: "exception", actualCostMinor: 50_000,
    });
    expect((await getAccountBalance(userId)).availableMinor).toBe(950_000);
  });

  it("a submitted request with a lost response holds funds and is never resubmitted", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("connection reset"));
    await generateAnnotation(params());
    expect(await findBillingOperation("semantic_annotation:10")).toMatchObject({
      status: "submission_unknown", actualCostMinor: null,
    });
    await generateAnnotation(params());
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await getAccountBalance(userId)).reservedMinor).toBe(50_000);
  });

  it("the annotation deadline cancels the transport and retains the hold", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    let signal: AbortSignal | undefined;
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      signal = init?.signal ?? undefined;
      entered();
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(signal?.reason), { once: true });
      });
    });
    const pending = generateAnnotation(params());
    await started;
    await vi.advanceTimersByTimeAsync(30_000);
    await pending;
    expect(signal?.aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await findBillingOperation("semantic_annotation:10")).toMatchObject({
      status: "submission_unknown", actualCostMinor: null,
    });
    expect((await getAccountBalance(userId)).reservedMinor).toBe(50_000);
  });
});
