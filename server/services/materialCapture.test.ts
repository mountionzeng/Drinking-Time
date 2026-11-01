import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { normalizePublishingDraftState } from "../../shared/publishingDraft";
const model = vi.hoisted(() => vi.fn());
const asr = vi.hoisted(() => ({submit:vi.fn(),query:vi.fn()}));
vi.mock("./materialCaptureTranscription",() => ({submitCaptureTranscription:asr.submit,queryCaptureTranscription:asr.query}));
const vision = vi.hoisted(() => vi.fn());
vi.mock("./agentRuntime",() => ({runJsonAgent:model}));
vi.mock("./visionChannel",() => ({invokeVisionJson:vision}));
process.env.DATABASE_URL = "";
const db = await import("../db");
const service = await import("./materialCapture");
const processService = await import("./materialCaptureProcessing");
const repo = await import("../repositories/materialCaptures");
const runtime = await import("../repositories/runtime");
const input = () => ({id:randomUUID(),origin:"chat" as const,text:"虚构素材：港口有一只纸船。",files:[]});
beforeEach(() => { db.resetMemoryStateForTesting(); model.mockReset(); vision.mockReset(); model.mockResolvedValue({parsed:{title:"纸船",body:"港口有一只纸船。"},modelLabel:"test"}); });

describe("material capture persistence and recovery",() => {
  it("commits one story under concurrent replay, readable through normal history and from disk",async () => {
    const request = input();
    await Promise.all([service.receiveCapture(21,request),service.receiveCapture(21,request)]);
    await Promise.all([processService.processCapture(21,request.id),processService.processCapture(21,request.id)]);
    const receipt = await repo.readCapture(21,request.id);
    expect(receipt.status).toBe("saved");
    expect(model).toHaveBeenCalledTimes(1);
    const story = await db.getStoryById(receipt.storyId!,21);
    const body = story!.body as Record<string,unknown>;
    expect(normalizePublishingDraftState(body.publishing).drafts.xiaohongshu?.content.body).toBe("港口有一只纸船。");
    expect(body.textDraftHistory).toMatchObject({versions:[{status:"ready",generated:{body:"港口有一只纸船。"}}]});
    const persisted = JSON.parse(await readFile(process.env.LOCAL_PERSIST_PATH!,"utf8"));
    expect(persisted.materialCaptures).toHaveLength(1);
    expect(persisted.stories).toHaveLength(1);
    expect(persisted.materialCaptures[0].storyId).toBe(persisted.stories[0].id);
    await processService.processCapture(21,request.id);
    expect(model).toHaveBeenCalledTimes(1);
  });
  it("rejects changed requests and other owners before processing or reading originals",async () => {
    const request = input(); await service.receiveCapture(21,request);
    await expect(service.receiveCapture(21,{...request,text:"被更改"})).rejects.toMatchObject({code:"CONFLICT"});
    await expect(repo.readCapture(22,request.id)).rejects.toMatchObject({code:"NOT_FOUND"});
    await expect(processService.processCapture(22,request.id)).rejects.toMatchObject({code:"NOT_FOUND"});
    expect(model).not.toHaveBeenCalled();
  });
  it("retains original image bytes separately from AI evidence",async () => {
    const bytes = await sharp({create:{width:8,height:8,channels:3,background:"#ee6644"}}).png().toBuffer();
    const request = {...input(),files:[{id:randomUUID(),name:"sample.png",mime:"image/png" as const,base64:bytes.toString("base64")}]};
    vision.mockResolvedValue({text:"一块橙色方块。",modelLabel:"test-vision"});
    await service.receiveCapture(21,request); await processService.processCapture(21,request.id);
    expect((await service.readCaptureOriginal(21,request.id,request.files[0].id)).bytes).toEqual(bytes);
    await expect(service.readCaptureOriginal(22,request.id,request.files[0].id)).rejects.toMatchObject({code:"NOT_FOUND"});
    expect((await repo.readCapture(21,request.id)).progress.evidence).toEqual(expect.arrayContaining([expect.objectContaining({kind:"image-description",text:"一块橙色方块。"})]));
    expect(vision.mock.calls[0][0].replaySafe).toBe(false);
  });
  it("rejects fake image containers without recording success",async () => {
    const request = {...input(),files:[{id:randomUUID(),name:"fake.png",mime:"image/png" as const,base64:Buffer.from("not a picture").toString("base64")}]};
    await expect(service.receiveCapture(21,request)).rejects.toThrow();
    expect(await repo.listCaptures(21)).toHaveLength(0);
  });
  it("requires a durable absolute private-media directory in production",async () => {
    const bytes = await sharp({create:{width:2,height:2,channels:3,background:"blue"}}).png().toBuffer();
    const request={...input(),files:[{id:randomUUID(),name:"source.png",mime:"image/png" as const,base64:bytes.toString("base64")}]};
    vi.stubEnv("NODE_ENV","production");vi.stubEnv("MATERIAL_CAPTURE_DIR","");
    try {await expect(service.receiveCapture(21,request)).rejects.toMatchObject({code:"PRECONDITION_FAILED"});}
    finally {vi.unstubAllEnvs();}
  });
  it("never automatically repeats an uncertain provider call, but can save original text",async () => {
    const request = input(); model.mockRejectedValueOnce(new Error("provider connection lost"));
    await service.receiveCapture(21,request);
    expect((await processService.processCapture(21,request.id)).status).toBe("uncertain");
    await processService.processCapture(21,request.id);
    expect(model).toHaveBeenCalledTimes(1);
    const saved = await processService.saveCaptureWithoutAI(21,request.id);
    expect(saved.status).toBe("saved");
    expect(saved.progress.draft!.body).toContain(request.text);
    expect(saved.progress.manual).toBe(true);
    expect(model).toHaveBeenCalledTimes(1);
  });
  it("recovers result-saving failures without another inference and rolls back local partial mutations",async () => {
    const request = input(); await service.receiveCapture(21,request);
    await repo.mutateCapture(21,request.id,row => {row.status="ready";row.progress.draft={title:"待保存",body:"已整理"};});
    const spy = vi.spyOn(runtime,"persistMemoryState").mockRejectedValueOnce(new Error("disk unavailable"));
    await expect(repo.commitCaptureStory(21,request.id,processService.captureStoryBody)).rejects.toThrow("disk unavailable");
    spy.mockRestore();
    expect(runtime.memoryState.stories).toHaveLength(0);
    expect((await repo.readCapture(21,request.id)).status).toBe("ready");
    const result = await processService.processCapture(21,request.id);
    expect(result.status).toBe("saved");
    expect(model).not.toHaveBeenCalled();
  });
  it("paginates older captures without skipping equal timestamps or accepting another owner cursor",async () => {
    const date=new Date("2026-10-30T00:00:00Z");
    for(let i=0;i<35;i++)await repo.insertCapture({id:`12345678-1234-4234-8234-${i.toString(16).padStart(12,"0")}`,userId:21,inputHash:"fixture",status:"received",manifest:{origin:"chat",text:"fixture",files:[]},progress:{evidence:[]},storyId:null,createdAt:date,updatedAt:date});
    const first=await repo.listCaptures(21),second=await repo.listCaptures(21,first[29].id);
    expect(first).toHaveLength(30);expect(second).toHaveLength(5);expect(new Set([...first,...second].map(row=>row.id)).size).toBe(35);
    await expect(repo.listCaptures(22,first[29].id)).rejects.toMatchObject({code:"NOT_FOUND"});
  });
  it("a late generation cannot overwrite a separately saved original",async () => {
    const request=input();await service.receiveCapture(21,request);
    let finish!:(value:unknown)=>void,started!:()=>void;
    const entered=new Promise<void>(resolve=>{started=resolve;});
    model.mockImplementationOnce(()=>{started();return new Promise(resolve=>{finish=resolve;});});
    const running=processService.processCapture(21,request.id);await entered;
    await repo.mutateCapture(21,request.id,row=>{row.status="uncertain";});
    const saved=await processService.saveCaptureWithoutAI(21,request.id);
    finish({parsed:{title:"迟到结果",body:"不能覆盖"}});await running;
    const final=await repo.readCapture(21,request.id);
    expect(final.storyId).toBe(saved.storyId);expect(final.progress.draft!.body).toBe(request.text);expect(model).toHaveBeenCalledTimes(1);
  });
  it("enforces token revocation and expiry without exposing history",async () => {
    const token = await service.createCaptureToken(21);
    expect(await service.authenticateCaptureToken(token.token)).toBe(21);
    expect(await service.authenticateCaptureToken("bad")).toBeNull();
    await repo.revokeCaptureTokens(21);
    expect(await service.authenticateCaptureToken(token.token)).toBeNull();
    const another = await service.createCaptureToken(21);
    vi.useFakeTimers(); vi.setSystemTime(new Date(+another.expiresAt+1));
    expect(await service.authenticateCaptureToken(another.token)).toBeNull(); vi.useRealTimers();
  });
});


describe("durable capture audio recovery", () => {
  it("queries an ambiguous submission without replaying it, and keeps earlier evidence", async () => {
    const bytes = await sharp({create:{width:8,height:8,channels:3,background:"red"}}).png().toBuffer();
    const sourceId = randomUUID();
    const request = {...input(),files:[{id:sourceId,name:"fixture.png",mime:"image/png" as const,base64:bytes.toString("base64")}]};
    await service.receiveCapture(21,request);
    // Transport is mocked: use a private fixture to exercise persistence and ownership.
    await repo.mutateCapture(21,request.id,row => { row.manifest.files[0].mime = "audio/mpeg"; });
    asr.submit.mockReset().mockRejectedValue(new Error("response lost"));
    asr.query.mockReset().mockRejectedValueOnce(new Error("temporarily unavailable")).mockResolvedValue("纸船漂向灯塔。");
    const first = await processService.processCapture(21,request.id);
    expect(first.status).toBe("received");
    expect(first.progress.transcriptionTasks?.[sourceId].id).toBeTruthy();
    expect(model).not.toHaveBeenCalled();
    const next = await processService.processCapture(21,request.id);
    expect(next.status).toBe("saved");
    expect(asr.submit).toHaveBeenCalledTimes(1);
    expect(asr.query.mock.calls[0][0]).toBe(asr.query.mock.calls[1][0]);
    expect(next.progress.evidence.filter(e=>e.kind==="transcript")).toHaveLength(1);
    await processService.processCapture(21,request.id);
    expect(asr.submit).toHaveBeenCalledTimes(1);
    expect(model).toHaveBeenCalledTimes(1);
  });
});
