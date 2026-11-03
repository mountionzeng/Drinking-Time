import { describe, expect, it, vi } from "vitest";
import { decideStaleRelease } from "../../shared/computeStaleRelease";
import { computeStaleReleaseEnabled, sweepStaleReservations, type StaleReleaseDeps } from "./computeStaleRelease";
import { createMemoryImageTaskStore } from "../repositories/imageGenerationTasks";
import { markRequestSent, markSubmissionUnknown, registerImageTask, sweepImageTasks, type ImageTaskDeps } from "./imageGenerationTaskService";

const NOW = new Date("2026-11-03T06:00:00Z");
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000);
const none = { storedOutput: false, outputUnstored: false, taskInFlight: false };

describe("decideStaleRelease", () => {
  const d = (o: Partial<Parameters<typeof decideStaleRelease>[0]>) => decideStaleRelease({
    status: "submission_unknown", operationType: "inference.text", createdAt: ago(11), now: NOW, holdActive: true, evidence: none, ...o,
  });
  it("thresholds: inference 10 min, media 30 min", () => {
    expect(d({ createdAt: ago(9) }).action).toBe("skip");
    expect(d({}).action).toBe("release");
    expect(d({ operationType: "media.voice", createdAt: ago(29) }).action).toBe("skip");
    expect(d({ operationType: "shiguang.image", createdAt: ago(31) }).action).toBe("release");
  });
  it("never refunds stored output", () => {
    expect(d({ evidence: { ...none, storedOutput: true, outputUnstored: true } }).action).toBe("settle");
  });
  it("unstored output goes to manual and keeps the hold", () => {
    expect(d({ evidence: { ...none, outputUnstored: true } }).action).toBe("manual");
  });
  it("leaves a running provider task alone until the 24h cap", () => {
    expect(d({ operationType: "media.video", createdAt: ago(60), evidence: { ...none, taskInFlight: true } }).action).toBe("skip");
    expect(d({ operationType: "media.video", createdAt: ago(25 * 60), evidence: { ...none, taskInFlight: true } }).action).toBe("manual");
  });
  it("skips terminal or hold-less rows", () => {
    expect(d({ status: "released" }).action).toBe("skip");
    expect(d({ holdActive: false }).action).toBe("skip");
  });
});

function fakeLedger(ops: { operationId: string; operationType: string; createdAt: Date; attempts?: unknown[]; asset?: boolean }[]) {
  const state = new Map(ops.map((o, i) => [o.operationId, { id: i + 1, userId: 7, storyId: 1, maxCostMinor: 100, status: "submission_unknown", ...o }]));
  const final = (id: string, status: string) => { state.get(id)!.status = status; };
  const deps: StaleReleaseDeps = {
    now: () => NOW,
    listOpen: async (before, afterId) => [...state.values()].filter(o => o.id > afterId && o.createdAt <= before && !["released", "settled", "exception"].includes(o.status)) as never,
    holdActive: async id => state.get(id)!.status === "submission_unknown",
    attempts: async id => (state.get(id)!.attempts ?? []) as never,
    audioAssetStored: async op => !!state.get(op.operationId)!.asset,
    settleAtQuote: vi.fn(async (id: string) => final(id, "settled")),
    settleVerified: vi.fn(async (id: string) => final(id, "settled")),
    release: vi.fn(async (id: string) => final(id, "released")),
    log: vi.fn(),
  };
  return { deps, state };
}

describe("sweepStaleReservations", () => {
  it("releases once, settles stored output, keeps unstored and fresh rows", async () => {
    const { deps, state } = fakeLedger([
      { operationId: "lost", operationType: "inference.text", createdAt: ago(20) },
      { operationId: "voice-ok", operationType: "media.voice", createdAt: ago(40), attempts: [{ status: "submitted", usage: { audioUrl: "/a.mp3" } }] },
      { operationId: "music-asset", operationType: "audio.scene-generation", createdAt: ago(40), asset: true },
      { operationId: "narr-unstored", operationType: "tts.narration", createdAt: ago(40), attempts: [{ status: "submitted", usage: { providerAudioUrl: "https://x" } }] },
      { operationId: "video-running", operationType: "media.video", createdAt: ago(40), attempts: [{ status: "submitted", providerTaskId: "t1", usage: { taskId: "t1", takeId: 3 } }] },
      { operationId: "fresh", operationType: "media.voice", createdAt: ago(15) },
    ]);
    await sweepStaleReservations(deps);
    await sweepStaleReservations(deps);
    expect(deps.release).toHaveBeenCalledTimes(1);
    expect(deps.release).toHaveBeenCalledWith("lost", expect.stringContaining("stale-release"));
    expect(deps.settleAtQuote).toHaveBeenCalledTimes(2);
    expect(state.get("narr-unstored")!.status).toBe("submission_unknown");
    expect(state.get("video-running")!.status).toBe("submission_unknown");
    expect(state.get("fresh")!.status).toBe("submission_unknown");
    expect((deps.log as ReturnType<typeof vi.fn>).mock.calls.filter(c => c[0] === "[stale-release] manual")).toHaveLength(1);
  });
  it("settles a succeeded inference attempt at its verified cost", async () => {
    const { deps } = fakeLedger([{ operationId: "inf-ok", operationType: "inference.text", createdAt: ago(20), attempts: [{ status: "succeeded", costMinor: 42 }] }]);
    await sweepStaleReservations(deps);
    expect(deps.settleVerified).toHaveBeenCalledWith("inf-ok", 42, expect.any(String));
    expect(deps.release).not.toHaveBeenCalled();
  });
  it("switch defaults off", () => {
    expect(computeStaleReleaseEnabled({})).toBe(false);
    expect(computeStaleReleaseEnabled({ COMPUTE_STALE_RELEASE_ENABLED: "1" })).toBe(true);
  });
});

describe("image unknown + prompt refund", () => {
  async function setup(staleRelease: boolean) {
    let clock = NOW;
    const store = createMemoryImageTaskStore([], (async () => []) as never);
    const settle = vi.fn(async () => {});
    const refundPrompt = vi.fn(async () => {});
    const deps: ImageTaskDeps = { store, settle, refundPrompt, resume: vi.fn() as never, now: () => clock, staleRelease };
    const { row } = await registerImageTask(store, { userId: 7, requestId: "r1", scope: "book_module", provider: "midjourney", storyId: 1, chapterId: 1, moduleId: "m", billingOperationId: "op-img", promptBillings: [{ operationId: "op-prompt", chargeMinor: 5 }] } as never);
    await markRequestSent(store, row.id);
    await markSubmissionUnknown(deps, row.id, "lost");
    settle.mockClear();
    clock = new Date(NOW.getTime() + 31 * 60_000);
    return { deps, store, settle, refundPrompt, id: row.id };
  }
  it("switch off: unknown stays unknown, nothing refunded", async () => {
    const s = await setup(false);
    await sweepImageTasks(s.deps, "w");
    expect((await s.store.get(s.id))!.status).toBe("submission_unknown");
    expect(s.refundPrompt).not.toHaveBeenCalled();
    expect(s.settle).not.toHaveBeenCalled();
  });
  it("switch on: fails once, refunds prompt once, releases once", async () => {
    const s = await setup(true);
    await sweepImageTasks(s.deps, "w");
    await sweepImageTasks(s.deps, "w");
    expect((await s.store.get(s.id))!.status).toBe("failed");
    expect(s.refundPrompt).toHaveBeenCalledTimes(1);
    expect(s.settle).toHaveBeenCalledTimes(1);
    expect(s.settle).toHaveBeenCalledWith("op-img", { kind: "not_charged_failure" });
  });
});
