import { describe, expect, it, vi } from "vitest";
import { createMemoryImageTaskStore } from "../repositories/imageGenerationTasks";
import {
  expireSubmittingTask, markAccepted, markRejected, markRequestSent, markSubmissionUnknown, pickTaskForModule,
  registerImageTask, settleTask, sweepImageTasks, type ImageTaskDeps,
} from "./imageGenerationTaskService";
import {
  canTransition, decideExpiry, decidePoll, dedupeAcceptedPrefix, legacyBookModuleTaskToRow, mayResubmit,
} from "../../shared/imageGenerationTask";
import type { ImageGenResult } from "./imageGen";

const T0 = new Date("2026-11-03T04:00:00Z");
function setup(resume: (n: number) => ImageGenResult = () => ({ status: "error", message: "图片任务已受理" })) {
  const store = createMemoryImageTaskStore();
  let clock = T0;
  let calls = 0;
  const settle = vi.fn(async () => {});
  const storeCandidates = vi.fn(async (_t, c: { imageUrl: string }[]) => c.map((x, i) => ({ imageId: i + 1, imageUrl: x.imageUrl })));
  const resumeFn = vi.fn(async () => resume(++calls));
  const deps: ImageTaskDeps = { store, settle, storeCandidates, resume: resumeFn, now: () => clock };
  return { store, deps, settle, storeCandidates, resumeFn, tick: (ms: number) => { clock = new Date(clock.getTime() + ms); } };
}
const base = { userId: 7, requestId: "req-1", scope: "book_module" as const, provider: "midjourney", storyId: 117, chapterId: 3, moduleId: "m1", billingOperationId: "op-1" };
const ok: ImageGenResult = { status: "ok", imageUrl: "/api/images/a.png", candidates: [{ imageUrl: "/api/images/a.png" }, { imageUrl: "/api/images/b.png" }] };

describe("pure rules", () => {
  it("allows only forward transitions", () => {
    expect(canTransition("submitting", "accepted")).toBe(true);
    expect(canTransition("accepted", "submitting")).toBe(false);
    expect(canTransition("succeeded", "failed")).toBe(false);
    expect(canTransition("submission_unknown", "submitting")).toBe(false);
  });
  it("never allows resubmission with a receipt or unknown outcome", () => {
    expect(mayResubmit({ status: "accepted", providerTaskId: "legnext:x" })).toBe(false);
    expect(mayResubmit({ status: "submission_unknown" })).toBe(false);
    expect(mayResubmit({ status: "failed", providerTaskId: "x" })).toBe(false);
    expect(mayResubmit({ status: "failed" })).toBe(true);
  });
  it("expiry releases only provably unsent tasks", () => {
    const old = new Date(T0.getTime() - 31 * 60_000);
    expect(decideExpiry({ status: "submitting", updatedAt: old, requestSent: false }, T0)).toEqual({ action: "release" });
    expect(decideExpiry({ status: "submitting", updatedAt: old, requestSent: true }, T0)).toEqual({ action: "mark_unknown" });
    expect(decideExpiry({ status: "accepted", providerTaskId: "x", updatedAt: old, requestSent: true }, T0)).toEqual({ action: "poll" });
    expect(decideExpiry({ status: "submitting", updatedAt: T0, requestSent: false }, T0)).toEqual({ action: "none" });
  });
  it("poll decision backs off and hands long-running receipts to reconciliation", () => {
    const task = { status: "accepted" as const, providerTaskId: "x", pollCount: 0, submittedAt: T0, createdAt: T0 };
    expect(decidePoll(task, { kind: "pending" }, T0)).toMatchObject({ action: "reschedule" });
    expect(decidePoll(task, { kind: "completed", candidateCount: 4 }, T0)).toEqual({ action: "succeed", settle: "charge" });
    expect(decidePoll(task, { kind: "failed" }, T0)).toEqual({ action: "fail", settle: "release" });
    expect(decidePoll(task, { kind: "pending" }, new Date(T0.getTime() + 31 * 60_000))).toEqual({ action: "manual" });
  });
  it("maps legacy story-body tasks conservatively and dedupes the repeated prefix", () => {
    const row = legacyBookModuleTaskToRow(117, { id: "a", requestId: "r", chapterId: 3, moduleId: "m1", sourceHash: "h", provider: "midjourney", status: "accepted", providerTaskId: "legnext:abc", error: "图片任务已受理，图片任务已受理，结果尚未返回", candidates: [] });
    expect(row).toMatchObject({ status: "accepted", providerTaskId: "legnext:abc", error: "图片任务已受理，结果尚未返回" });
    expect(legacyBookModuleTaskToRow(1, { id: "b", requestId: "r", chapterId: 1, moduleId: "m", sourceHash: "h", provider: "gpt-image", status: "preparing", candidates: [] }).status).toBe("submission_unknown");
    expect(dedupeAcceptedPrefix("图片任务已受理，图片任务已受理，x")).toBe("图片任务已受理，x");
  });
  it("read-compat prefers the table, falls back to legacy body", () => {
    const legacy = [{ id: "a", requestId: "r", chapterId: 3, moduleId: "m1", sourceHash: "h", provider: "midjourney" as const, status: "succeeded" as const, candidates: [{ imageId: 1, imageUrl: "u" }] }];
    expect(pickTaskForModule([], legacy, 117, { chapterId: 3, moduleId: "m1" })?.source).toBe("legacy");
    expect(pickTaskForModule([], legacy, 117, { chapterId: 3, moduleId: "zz" })).toBeNull();
  });
});

describe("service state machine", () => {
  it("register is idempotent per requestId", async () => {
    const { store } = setup();
    const a = await registerImageTask(store, base, T0);
    const b = await registerImageTask(store, base, T0);
    expect(a.replayed).toBe(false);
    expect(b.replayed).toBe(true);
    expect(b.row.id).toBe(a.row.id);
  });
  it("markRequestSent can only happen once", async () => {
    const { store } = setup();
    const { row } = await registerImageTask(store, base, T0);
    await markRequestSent(store, row.id, T0);
    await expect(markRequestSent(store, row.id, T0)).rejects.toThrow();
  });
  it("accepted → succeeded stores images and charges exactly once", async () => {
    const { store, deps, settle, storeCandidates } = setup(() => ok);
    const { row } = await registerImageTask(store, base, T0);
    await markRequestSent(store, row.id, T0);
    await markAccepted(store, row.id, "legnext:1", T0);
    expect(await sweepImageTasks(deps, "w1")).toBe(1);
    expect(await sweepImageTasks(deps, "w1")).toBe(0);
    const final = await store.get(row.id);
    expect(final).toMatchObject({ status: "succeeded", settlement: "charged" });
    expect(final?.candidates).toHaveLength(2);
    expect(storeCandidates).toHaveBeenCalledTimes(1);
    expect(settle).toHaveBeenCalledTimes(1);
    expect(settle).toHaveBeenCalledWith("op-1", { kind: "succeeded_at_quote" });
    await settleTask(deps, final!);
    expect(settle).toHaveBeenCalledTimes(1);
  });
  it("provider-confirmed failure releases the hold", async () => {
    const { store, deps, settle } = setup(() => ({ status: "error", message: "供应商确认本次图片生成失败" }));
    const { row } = await registerImageTask(store, base, T0);
    await markAccepted(store, row.id, "legnext:2", T0);
    await sweepImageTasks(deps, "w1");
    expect(await store.get(row.id)).toMatchObject({ status: "failed", settlement: "released" });
    expect(settle).toHaveBeenCalledWith("op-1", { kind: "not_charged_failure" });
  });
  it("pending results reschedule without settling", async () => {
    const { store, deps, settle, tick } = setup();
    const { row } = await registerImageTask(store, base, T0);
    await markAccepted(store, row.id, "legnext:3", T0);
    await sweepImageTasks(deps, "w1");
    expect(await sweepImageTasks(deps, "w1")).toBe(0); // not due yet
    tick(16_000);
    expect(await sweepImageTasks(deps, "w1")).toBe(1);
    expect((await store.get(row.id))?.pollCount).toBe(2);
    expect(settle).not.toHaveBeenCalled();
  });
  it("a receipt is never failed by markRejected", async () => {
    const { store, deps, settle } = setup();
    const { row } = await registerImageTask(store, base, T0);
    await markAccepted(store, row.id, "legnext:4", T0);
    await markRejected(deps, row.id, "x");
    expect((await store.get(row.id))?.status).toBe("accepted");
    expect(settle).not.toHaveBeenCalled();
  });
  it("lost response freezes the hold (submission_unknown) and is never swept for resubmission", async () => {
    const { store, deps, settle, resumeFn, tick } = setup();
    const { row } = await registerImageTask(store, base, T0);
    await markRequestSent(store, row.id, T0);
    await markSubmissionUnknown(deps, row.id, "lost");
    expect(settle).toHaveBeenCalledWith("op-1", { kind: "submission_unknown" });
    tick(60 * 60_000);
    expect(await sweepImageTasks(deps, "w1")).toBe(0);
    expect(resumeFn).not.toHaveBeenCalled();
  });
  it("stale submitting: unsent → release, sent → unknown", async () => {
    const { store, deps, settle, tick } = setup();
    const a = (await registerImageTask(store, base, T0)).row;
    const b = (await registerImageTask(store, { ...base, requestId: "req-2", billingOperationId: "op-2" }, T0)).row;
    await markRequestSent(store, b.id, T0);
    tick(31 * 60_000);
    await sweepImageTasks(deps, "w1");
    expect(await store.get(a.id)).toMatchObject({ status: "failed", settlement: "released" });
    expect((await store.get(b.id))?.status).toBe("submission_unknown");
    expect(settle).toHaveBeenCalledWith("op-1", { kind: "not_charged_failure" });
    expect(settle).toHaveBeenCalledWith("op-2", { kind: "submission_unknown" });
    void expireSubmittingTask;
  });
  it("concurrent workers: lease lets only one process a task", async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const { store, deps, settle, storeCandidates } = setup(() => ok);
    deps.resume = vi.fn(async () => { await gate; return ok; });
    const { row } = await registerImageTask(store, base, T0);
    await markAccepted(store, row.id, "legnext:5", T0);
    const p1 = sweepImageTasks(deps, "w1");
    const p2 = sweepImageTasks(deps, "w2");
    await new Promise(r => setTimeout(r, 0));
    release();
    const [a, b] = await Promise.all([p1, p2]);
    expect(a + b).toBe(1);
    expect(storeCandidates).toHaveBeenCalledTimes(1);
    expect(settle).toHaveBeenCalledTimes(1);
  });
  it("CAS rejects stale writers", async () => {
    const { store } = setup();
    const { row } = await registerImageTask(store, base, T0);
    expect(await store.update(row.id, { version: row.version, status: "submitting" }, { error: "x" }, T0)).not.toBeNull();
    expect(await store.update(row.id, { version: row.version, status: "submitting" }, { error: "y" }, T0)).toBeNull();
  });
});
