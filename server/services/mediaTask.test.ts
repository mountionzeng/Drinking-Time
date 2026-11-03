import { describe, expect, it, vi } from "vitest";
import { createMemoryImageTaskStore, resetImageTaskMemoryStoreForTesting } from "../repositories/imageGenerationTasks";
import { markAccepted, markRequestSent, registerImageTask, sweepImageTasks, type ImageTaskDeps } from "./imageGenerationTaskService";
import { AUTO_RELEASE_MESSAGE, finishSyncMediaTask, handleStaleSyncMediaTask, handleVideoTask, mediaTaskView, type SyncHandlerDeps } from "./mediaTaskHandlers";
import { mediaTaskAsyncSubmitEnabled, runSyncMediaInBackground } from "./mediaTaskSwitch";
import { logMediaUnknown, mediaUnknownRecord, startMediaDiagnostics, trackMediaResponse } from "./mediaUnknownLog";
import { decideVideoRefreshFailure } from "./videoJobs";
import { decideStaleSyncMedia, parseVideoTaskRef, videoTaskRef } from "../../shared/mediaTask";
import { awaitMediaTask, pendingMediaTaskId } from "../../client/src/lib/mediaTaskPolling";

const T0 = new Date("2026-11-03T05:00:00Z");
const MIN = 60_000;

async function syncRow(store = createMemoryImageTaskStore(), kind: "music" | "narration" = "music") {
  const { row } = await registerImageTask(store, { userId: 7, storyId: 1, requestId: `${kind}:op-1`, scope: "mobile", provider: "302-audio", mediaKind: kind, targetRef: "op-1" }, T0);
  const sent = await markRequestSent(store, row.id, T0);
  return { store, row: sent };
}
function syncDeps(store: ReturnType<typeof createMemoryImageTaskStore>, ev: Partial<{ assetId: number | null; providerOutputRecorded: boolean; ledgerStatus: string | null }>, at = new Date(T0.getTime() + 31 * MIN)) {
  const deps: SyncHandlerDeps = {
    store, now: () => at,
    evidence: vi.fn(async () => ({ assetId: null, providerOutputRecorded: false, ledgerStatus: "reserved", ...ev })),
    chargeAtQuote: vi.fn(async () => {}), release: vi.fn(async () => {}), freeze: vi.fn(async () => {}),
  };
  return deps;
}

describe("switches", () => {
  it("MEDIA_TASK_ASYNC_SUBMIT is off by default and needs the worker", () => {
    expect(mediaTaskAsyncSubmitEnabled({})).toBe(false);
    expect(mediaTaskAsyncSubmitEnabled({ MEDIA_TASK_ASYNC_SUBMIT: "1" })).toBe(false);
    expect(mediaTaskAsyncSubmitEnabled({ MEDIA_TASK_ASYNC_SUBMIT: "1", IMAGE_TASK_WORKER_ENABLED: "1" })).toBe(true);
  });
});

describe("pure rules", () => {
  it("refunds only without proof of output; never refunds stored output", () => {
    expect(decideStaleSyncMedia({ assetStored: true, providerOutputRecorded: true, ledgerFinal: false })).toEqual({ action: "succeed", charge: true });
    expect(decideStaleSyncMedia({ assetStored: true, providerOutputRecorded: false, ledgerFinal: true })).toEqual({ action: "succeed", charge: false });
    expect(decideStaleSyncMedia({ assetStored: false, providerOutputRecorded: true, ledgerFinal: false })).toEqual({ action: "manual" });
    expect(decideStaleSyncMedia({ assetStored: false, providerOutputRecorded: false, ledgerFinal: false })).toEqual({ action: "release" });
    expect(decideStaleSyncMedia({ assetStored: false, providerOutputRecorded: false, ledgerFinal: true })).toEqual({ action: "close" });
  });
  it("video query timeout = still generating, provider failure = release, else unknown", () => {
    expect(decideVideoRefreshFailure({ status: "timeout" }, 5 * MIN)).toBe("keep_processing");
    expect(decideVideoRefreshFailure({ status: "failed", queryFailed: true }, 5 * MIN)).toBe("keep_processing");
    expect(decideVideoRefreshFailure({ status: "timeout" }, 31 * MIN)).toBe("unknown");
    expect(decideVideoRefreshFailure({ status: "failed", providerConfirmed: true }, 1 * MIN)).toBe("failed");
    expect(decideVideoRefreshFailure({ status: "failed" }, 1 * MIN)).toBe("unknown");
  });
  it("video task ref round-trips", () => {
    expect(parseVideoTaskRef(videoTaskRef(42))).toBe(42);
    expect(parseVideoTaskRef("op-1")).toBeNull();
  });
});

describe("stale sync media sweep", () => {
  it("releases once after 30 min without proof, and is idempotent", async () => {
    const { store, row } = await syncRow();
    const deps = syncDeps(store, {});
    const done = await handleStaleSyncMediaTask(deps, row);
    expect(done).toMatchObject({ status: "failed", settlement: "released", error: AUTO_RELEASE_MESSAGE });
    await handleStaleSyncMediaTask(deps, (await store.get(row.id))!);
    expect(deps.release).toHaveBeenCalledTimes(1);
    expect(deps.chargeAtQuote).not.toHaveBeenCalled();
  });
  it("does nothing before 30 min", async () => {
    const { store, row } = await syncRow();
    const deps = syncDeps(store, {}, new Date(T0.getTime() + 29 * MIN));
    expect((await handleStaleSyncMediaTask(deps, row))?.status).toBe("submitting");
    expect(deps.release).not.toHaveBeenCalled();
  });
  it("stored asset is charged, never refunded", async () => {
    const { store, row } = await syncRow();
    const deps = syncDeps(store, { assetId: 9 });
    expect(await handleStaleSyncMediaTask(deps, row)).toMatchObject({ status: "succeeded", settlement: "charged" });
    expect(deps.chargeAtQuote).toHaveBeenCalledTimes(1);
    expect(deps.release).not.toHaveBeenCalled();
  });
  it("stored asset with settled ledger is not charged again", async () => {
    const { store, row } = await syncRow();
    const deps = syncDeps(store, { assetId: 9, ledgerStatus: "settled" });
    await handleStaleSyncMediaTask(deps, row);
    expect(deps.chargeAtQuote).not.toHaveBeenCalled();
  });
  it("provider output recorded but not stored keeps the hold", async () => {
    const { store, row } = await syncRow();
    const deps = syncDeps(store, { providerOutputRecorded: true });
    expect(await handleStaleSyncMediaTask(deps, row)).toMatchObject({ status: "submission_unknown", settlement: "manual" });
    expect(deps.freeze).toHaveBeenCalledTimes(1);
    expect(deps.release).not.toHaveBeenCalled();
  });
});

describe("finishSyncMediaTask", () => {
  it("ready → succeeded, error → failed, unknown stays submitting", async () => {
    const a = await syncRow();
    expect(await finishSyncMediaTask(a.store, a.row.id, { status: "ready", assetId: 1 }, T0)).toMatchObject({ status: "succeeded" });
    const b = await syncRow(undefined, "narration");
    expect(await finishSyncMediaTask(b.store, b.row.id, { status: "error", message: "x" }, T0)).toMatchObject({ status: "failed", error: "x" });
    const c = await syncRow();
    expect(await finishSyncMediaTask(c.store, c.row.id, { status: "submission-unknown", message: "?" }, T0)).toMatchObject({ status: "submitting" });
  });
  it("does not overwrite a row the sweep already resolved", async () => {
    const { store, row } = await syncRow();
    await handleStaleSyncMediaTask(syncDeps(store, {}), row);
    expect(await finishSyncMediaTask(store, row.id, { status: "ready" }, T0)).toMatchObject({ status: "failed", settlement: "released" });
  });
  it("view exposes pending then the stored result", async () => {
    const { store, row } = await syncRow();
    expect(mediaTaskView(row).state).toBe("pending");
    const done = await finishSyncMediaTask(store, row.id, { status: "ready", assetId: 3 }, T0);
    expect(mediaTaskView(done!)).toMatchObject({ state: "done", result: { status: "ready", assetId: 3 } });
  });
});

describe("video task handler", () => {
  async function videoRow() {
    const store = createMemoryImageTaskStore();
    const { row } = await registerImageTask(store, { userId: 7, storyId: 1, requestId: videoTaskRef(5), scope: "mobile", provider: "video", mediaKind: "video", targetRef: videoTaskRef(5) }, T0);
    await markRequestSent(store, row.id, T0);
    return { store, row: (await markAccepted(store, row.id, "video:t-1", T0))! };
  }
  it("keeps polling while generating; no unknown on time", async () => {
    const { store, row } = await videoRow();
    const refreshTake = vi.fn(async () => ({ status: "ok" as const, take: { status: "processing" } }));
    const next = await handleVideoTask({ store, refreshTake, now: () => new Date(T0.getTime() + 40 * MIN) }, row);
    expect(next).toMatchObject({ status: "accepted", pollCount: 1 });
  });
  it("finishes when the take is terminal", async () => {
    const { store, row } = await videoRow();
    const ok = await handleVideoTask({ store, refreshTake: async () => ({ status: "ok", take: { status: "available" } }), now: () => T0 }, row);
    expect(ok?.status).toBe("succeeded");
  });
  it("query error is treated as still generating", async () => {
    const { store, row } = await videoRow();
    const next = await handleVideoTask({ store, refreshTake: async () => { throw new Error("net"); }, now: () => T0 }, row);
    expect(next?.status).toBe("accepted");
  });
});

describe("sweep routes media rows to their handlers", () => {
  it("calls the media handler, not the image path", async () => {
    const { store } = await syncRow();
    const music = vi.fn(async () => {});
    const deps: ImageTaskDeps = { store, settle: vi.fn(), refundPrompt: vi.fn(), resume: vi.fn(), now: () => new Date(T0.getTime() + 31 * MIN), media: { music } } as never;
    expect(await sweepImageTasks(deps, "w1")).toBe(1);
    expect(music).toHaveBeenCalledTimes(1);
    expect(deps.settle).not.toHaveBeenCalled();
  });
});

describe("background run", () => {
  it("returns pending at once, then replays the finished result without rerunning", async () => {
    resetImageTaskMemoryStoreForTesting();
    let resolve!: (v: { status: "ready"; assetId: number }) => void;
    const run = vi.fn(() => new Promise<{ status: "ready"; assetId: number }>(r => { resolve = r; }));
    const first = await runSyncMediaInBackground({ userId: 7, storyId: 1, kind: "music", operationId: "op-bg", run });
    expect(first).toMatchObject({ status: "pending" });
    resolve({ status: "ready", assetId: 4 });
    await new Promise(r => setTimeout(r, 10));
    const again = await runSyncMediaInBackground({ userId: 7, storyId: 1, kind: "music", operationId: "op-bg", run });
    expect(again).toMatchObject({ status: "ready", assetId: 4 });
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("unknown diagnostics", () => {
  it("records http status, content type and elapsed", async () => {
    const diag = startMediaDiagnostics("music", 1000);
    const f = trackMediaResponse(async () => new Response("<html>", { status: 502, headers: { "content-type": "text/html" } }), diag);
    await f();
    expect(mediaUnknownRecord(diag, "bad body", 4000)).toEqual({ kind: "music", httpStatus: 502, contentType: "text/html", elapsedMs: 3000, reason: "bad body" });
    const log = vi.fn();
    logMediaUnknown(startMediaDiagnostics("tts"), "timeout", log);
    expect(log.mock.calls[0][1]).toMatchObject({ httpStatus: null, reason: "timeout" });
  });
});

describe("client polling", () => {
  const instant = { sleep: async () => {}, intervalMs: 1 };
  it("passes non-pending results through", async () => {
    const r = { status: "ready" as const };
    expect(await awaitMediaTask(r, vi.fn())).toBe(r);
    expect(pendingMediaTaskId({ status: "pending" })).toBeNull();
  });
  it("polls until done and survives fetch errors", async () => {
    let n = 0;
    const fetch = vi.fn(async () => {
      n++;
      if (n === 1) throw new Error("net");
      if (n === 2) return { state: "pending" as const, mediaTaskId: "t", message: "…" };
      return { state: "done" as const, mediaTaskId: "t", result: { status: "ready" } };
    });
    expect(await awaitMediaTask({ status: "pending", mediaTaskId: "t" }, fetch, instant)).toEqual({ status: "ready" });
  });
  it("maps recovered/missing to a visible message", async () => {
    const rec = await awaitMediaTask({ status: "pending", mediaTaskId: "t" }, async () => ({ state: "done", mediaTaskId: "t", result: { status: "recovered" } }), instant);
    expect(rec).toMatchObject({ status: "error" });
    const miss = await awaitMediaTask({ status: "pending", mediaTaskId: "t" }, async () => ({ state: "missing", mediaTaskId: "t" }), instant);
    expect(miss).toMatchObject({ status: "error" });
  });
});
