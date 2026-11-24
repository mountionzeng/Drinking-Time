import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { mergeImageAttempts, renderJobResult, restoreRenderJobs, watchWarehouseRenders, type WarehouseRenderJob } from "./warehouseRenderActivity";

const job: WarehouseRenderJob = { id: "r1", storyId: 7, shotId: "shot-a", kind: "image", state: "rendering", startedAt: 1000 };

describe("warehouse render receipts", () => {
  it("restores a confirmed failure after refresh and replaces the old card throughout a retry", () => {
    const offer = {storyId:7,stableShotId:"shot-a",planMessageId:"plan",imageId:12,copy:1,failedId:"old",nextId:"new",unitCny:1.43};
    const failed = {storyId:7,shotId:"shot-a",requestId:"old",requestIds:["old"],status:"failed" as const,
      startedAt:1000,error:"余额不足",offer};
    const local = {...job,state:"failed" as const,requestId:"old"};
    expect(mergeImageAttempts([], [failed])).toMatchObject([{state:"failed",retry:offer,error:"余额不足"}]);
    expect(mergeImageAttempts([local], [failed])).toHaveLength(1);
    const rendering = {...job,id:"submitting",requestId:"new"};
    expect(mergeImageAttempts([local,rendering], [failed])).toMatchObject([{requestId:"old",retry:offer}]);
    const accepted = {...failed,requestId:"new",requestIds:["old","new"],status:"accepted" as const,offer:undefined,error:undefined};
    expect(mergeImageAttempts([local,rendering], [accepted])).toMatchObject([{state:"rendering",requestId:"new"}]);
    const other = {...local,storyId:8};
    expect(mergeImageAttempts([local,rendering,other], [{...accepted,status:"succeeded"}])).toEqual([other]);
  });

  it.each([
    ["storyAgent.generateForMobile", "image"],
    ["creationAgent.frameReview.generateCloud", "image"],
    ["timelineMedia.generateSceneAudio", "audio"],
    ["timelineMedia.generateNarrationCandidate", "audio"],
    ["storyAgent.generateStoryShotVoice", "audio"],
    ["creationAgent.generateShotVideo", "video"],
    ["warehouseVideoSequence.submit", "video"],
  ])("shows %s immediately, before the request resolves", async (path, kind) => {
    const client = new QueryClient();
    const notice = vi.fn();
    const stop = watchWarehouseRenders(client, notice);
    let finish!: (result: unknown) => void;
    const mutation = client.getMutationCache().build(client, {
      mutationKey: [path.split(".")],
      mutationFn: () => new Promise(resolve => { finish = resolve; }),
    });
    const waiting = mutation.execute({ storyId: 7, conversationShotId: "shot-a", prompt: "not persisted", quoteToken: "not persisted" });
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    expect(notice).toHaveBeenCalledWith(expect.objectContaining({ storyId: 7, shotId: "shot-a", kind, state: "rendering" }), true);
    expect(JSON.stringify(notice.mock.calls)).not.toMatch(/not persisted|quoteToken|prompt/);
    finish({ status: "ok", imageId: 25, imageUrl: "/25.png" });
    await waiting;
    expect(notice).toHaveBeenLastCalledWith(expect.objectContaining({ storyId: 7, shotId: "shot-a", state: "ready", assetId: 25 }), false);
    expect(notice.mock.calls[0][0].id).toBe(notice.mock.calls.at(-1)![0].id);
    stop(); client.clear();
  });

  it("does not turn quotes, chat, polling or adoption into rendering tasks", async () => {
    const client = new QueryClient();
    const notice = vi.fn();
    const stop = watchWarehouseRenders(client, notice);
    for (const path of ["warehouseVideoSequence.quote", "warehouseVideoSequence.status", "timelineMedia.quoteSceneAudio", "storyAgent.chat", "creationAgent.refreshShotVideoStatus", "creationAgent.adoptVideoTake"]) {
      await client.getMutationCache().build(client, { mutationKey: [path.split(".")], mutationFn: async () => ({ status: "ok" }) }).execute({ storyId: 7 });
    }
    expect(notice).not.toHaveBeenCalled();
    stop(); client.clear();
  });

  it("does not create another render card while recovering the same cloud task", async () => {
    const client = new QueryClient();
    const notice = vi.fn();
    const stop = watchWarehouseRenders(client, notice);
    await client.getMutationCache().build(client, {
      mutationKey: [["creationAgent", "frameReview", "generateCloud"]],
      mutationFn: async () => ({ status: "ok", imageId: 25 }),
    }).execute({ storyId: 7, requestId: "existing-cloud-task", recoverOnly: true });
    expect(notice).not.toHaveBeenCalled();
    stop(); client.clear();
  });

  it("keeps concurrent renders distinct and preserves original story/shot when they finish out of order", async () => {
    const client = new QueryClient();
    const notice = vi.fn();
    const stop = watchWarehouseRenders(client, notice);
    const finish: Array<(v: unknown) => void> = [];
    const pending = [7, 8].map(storyId => client.getMutationCache().build(client, {
      mutationKey: [["storyAgent", "generateForMobile"]],
      mutationFn: () => new Promise(resolve => finish.push(resolve)),
    }).execute({ storyId, conversationShotId: `shot-${storyId}` }));
    await vi.waitFor(() => expect(finish).toHaveLength(2));
    finish[1]({ status: "ok", imageId: 8 }); await pending[1];
    finish[0]({ status: "ok", imageId: 7 }); await pending[0];
    const starts = notice.mock.calls.filter(c => c[1]);
    expect(new Set(starts.map(c => c[0].id)).size).toBe(2);
    expect(notice.mock.calls.at(-1)![0]).toMatchObject({ storyId: 7, shotId: "shot-7", assetId: 7 });
    stop(); client.clear();
  });

  it("treats network errors as unknown and never retries or declares failure", async () => {
    const client = new QueryClient(); const notice = vi.fn();
    const stop = watchWarehouseRenders(client, notice);
    const run = vi.fn(async () => { throw new Error("504"); });
    const mutation = client.getMutationCache().build(client, { mutationKey: [["storyAgent", "generateForMobile"]], mutationFn: run });
    await expect(mutation.execute({ storyId: 7 })).rejects.toThrow("504");
    expect(notice).toHaveBeenLastCalledWith(expect.objectContaining({ state: "unknown" }), false);
    expect(run).toHaveBeenCalledTimes(1); stop(); client.clear();
  });

  it("ignores a previous account's late completion after resubscribing", async () => {
    const client = new QueryClient(); const oldNotice = vi.fn(); const newNotice = vi.fn();
    const stopOld = watchWarehouseRenders(client, oldNotice);
    let finish!: (result: unknown) => void;
    const waiting = client.getMutationCache().build(client, {
      mutationKey: [["storyAgent", "generateForMobile"]],
      mutationFn: () => new Promise(resolve => { finish = resolve; }),
    }).execute({ storyId: 7 });
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    stopOld();
    const stopNew = watchWarehouseRenders(client, newNotice);
    finish({ status: "ok", imageId: 25 }); await waiting;
    expect(oldNotice).toHaveBeenCalledTimes(1);
    expect(newNotice).not.toHaveBeenCalled();
    stopNew(); client.clear();
  });

  it("recognizes accepted work even when the legacy response says error", () => {
    expect(renderJobResult(job, { status: "error", pending: true, imageTaskId: "server-id" })).toMatchObject({ state: "rendering", imageTaskId: "server-id" });
    expect(renderJobResult(job, { status: "error", providerTaskId: "upstream" }).state).toBe("unknown");
    expect(renderJobResult(job, { status: "error", submissionUncertain: true }).state).toBe("unknown");
    expect(renderJobResult({ ...job, kind: "audio" }, { status: "error", error: "配音结果待确认，算力暂时预占" }).state).toBe("unknown");
    expect(renderJobResult(job, { status: "error" }).state).toBe("failed");
    expect(renderJobResult(job, { status: "error", error: "参考图无法读取" })).toMatchObject({shotId: "shot-a", state: "failed", error: "参考图无法读取"});
  });

  it("does not call an accepted video or async audio result complete", () => {
    expect(renderJobResult({ ...job, kind: "video" }, { status: "ok", take: { id: 42, status: "processing" } })).toMatchObject({ state: "rendering", takeId: 42 });
    expect(renderJobResult({ ...job, kind: "audio" }, { status: "pending", mediaTaskId: "music-task" })).toMatchObject({ state: "rendering", mediaTaskId: "music-task" });
  });

  it("replaces the same receipt with the saved preview and recognizes failure", () => {
    expect(renderJobResult(job, { status: "succeeded", candidates: [{ imageId: 21, imageUrl: "/21.png" }] })).toMatchObject({ id: "r1", state: "ready", assetId: 21, url: "/21.png" });
    expect(renderJobResult(job, { status: "failed" }).state).toBe("failed");
    expect(renderJobResult(job, { status: "something-new" }).state).toBe("unknown");
  });

  it("restores missing receipts as uncertain, discards corrupt and expired entries", () => {
    expect(restoreRenderJobs(JSON.stringify([job]), 2000)).toEqual([{ ...job, state: "unknown" }]);
    expect(restoreRenderJobs(JSON.stringify([{ ...job, state: "failed" }]), 2000)[0].state).toBe("failed");
    expect(restoreRenderJobs(JSON.stringify([job, { id: "bad" }]), 90_000_000)).toEqual([]);
    expect(restoreRenderJobs("broken")).toEqual([]);
  });
});

it("retains sequence request identity after a lost response and a refresh", async()=>{
 const client=new QueryClient(); const notice=vi.fn();const stop=watchWarehouseRenders(client,notice);
 const mutation=client.getMutationCache().build(client,{mutationKey:[["warehouseVideoSequence","submit"]],mutationFn:async()=>{throw new Error("network");}});
 await expect(mutation.execute({storyId:7,stableShotId:"shot-3",requestId:"receipt-1"})).rejects.toThrow();
 const saved=notice.mock.lastCall![0];expect(saved).toMatchObject({sequence:true,storyId:7,shotId:"shot-3",requestId:"receipt-1",state:"unknown"});
 expect(restoreRenderJobs(JSON.stringify([saved]))[0]).toMatchObject({sequence:true,requestId:"receipt-1"});
 expect(renderJobResult(saved,{take:{id:88,status:"unfollowable"}})).toMatchObject({state:"unknown",takeId:88});stop();client.clear();
});
