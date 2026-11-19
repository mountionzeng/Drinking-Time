import { beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import type { VideoTake } from "../../drizzle/schema";
const m = vi.hoisted(() => ({
  takes: [] as any[],
  story: vi.fn(),
  assets: vi.fn(),
  read: vi.fn(),
  reserve: vi.fn(),
  settle: vi.fn(),
  record: vi.fn(),
  upload: vi.fn(),
  submit: vi.fn(),
  refresh: vi.fn(),
  probe: vi.fn(),
  dir: "",
  update: vi.fn(),
  reviewedPlan: vi.fn(),
  cues: vi.fn(),
}));
vi.mock("../repositories/stories", () => ({ getStoryById: m.story }));
vi.mock("./videoTimelineCues", async importOriginal=>({...await importOriginal<typeof import("./videoTimelineCues")>(),readVideoTimelineCues:m.cues}));
vi.mock("./frameReviewVideo", () => ({ prepareFrameReviewVideo: m.reviewedPlan }));
vi.mock("../repositories/videos", () => ({
  getVideoTakeById: async (id: number, userId: number) =>
    m.takes.find((t) => t.id === id && t.userId === userId) ?? null,
  findVideoTakeByIdempotencyKey: async (
    storyId: number,
    userId: number,
    key: string,
  ) =>
    m.takes.find(
      (t) =>
        t.storyId === storyId &&
        t.userId === userId &&
        t.idempotencyKey === key,
    ) ?? null,
  createVideoTakeIdempotently: async (data: any) => {
    const old = m.takes.find(
      (t) =>
        t.idempotencyKey === data.idempotencyKey && t.userId === data.userId,
    );
    if (old) return { take: old, created: false };
    const take = { ...data, id: m.takes.length + 1, createdAt: new Date() };
    m.takes.push(take);
    return { take, created: true };
  },
  updateVideoTake: m.update,
}));
vi.mock("./imageAssets", () => ({
  getStoryImageAssets: m.assets,
  materializeImageInput: m.read,
}));
vi.mock("./mediaComputeBilling", () => ({
  mediaBillingEnabled: () => true,
  mediaOperationId: (_k: string, _u: number, key: string) => key,
  reserveMedia: m.reserve,
  recordMediaResult: m.record,
  recoverVideoReceipt: async (take: VideoTake) => take,
}));
vi.mock("./computeLedger", () => ({ settleOperation: m.settle }));
vi.mock("./render/submitRender", () => ({
  submitRender: m.submit,
  renderRefusalReason: () => null,
}));
vi.mock("./videoTransition302", () => ({ uploadFileToVidu: m.upload }));
vi.mock("./startEndShotVideoWorkflow", () => ({
  refreshStartEndShotVideoTake: m.refresh,
}));
vi.mock("./videoMedia", () => ({ localVideoDir: () => m.dir }));
vi.mock("./videoConform", () => ({ probeVideoFileMetadata: m.probe }));
vi.mock("../_core/env", () => ({
  ENV: { api302BaseUrl: "https://example.invalid" },
}));
import {
  quoteWarehouseVideoSequence,
  submitWarehouseVideoSequence,
  refreshWarehouseVideoSequence,
  findWarehouseVideoSequence,
} from "./warehouseVideoSequence";
import {
  warehouseSequencePairs,
  warehouseVideoSequenceInput,
} from "../../shared/warehouseVideoSequence";
import { estimateViduQ2TransitionCny } from "../../shared/videoRenderCost";
const run = promisify(execFile);
const input = {
  storyId: 7,
  stableShotId: "shot-3",
  imageIds: [9, 3, 5],
  segmentSeconds: 1,
  prompt: "Preserve these images.",
};
const requestId = "60012f08-e62a-4f06-aa43-48f012477f2a";
const root = await fs.mkdtemp(
  path.join(os.tmpdir(), "warehouse-sequence-test-"),
);
const png = await sharp({
  create: { width: 64, height: 64, channels: 3, background: "green" },
})
  .png()
  .toBuffer();
beforeEach(() => {
  vi.clearAllMocks();
  m.cues.mockImplementation(async (_s,_u,_id,durations:number[])=>durations.map(()=>null));
  m.takes = [];
  m.dir = root;
  m.story.mockResolvedValue({
    id: 7,
    body: { shots: [{ stableShotId: "shot-3", shotNo: 3 }] },
  });
  m.assets.mockResolvedValue(
    [9, 3, 5, 6, 8].map((id) => ({
      id,
      imageUrl: `/images/${id}.png`,
      status: "accepted",
      availability: "available",
    })),
  );
  m.read.mockResolvedValue(`data:image/png;base64,${png.toString("base64")}`);
  m.reserve.mockReset().mockResolvedValue({ outcome: "reserved" });
  m.settle.mockResolvedValue({});
  m.record.mockReset().mockResolvedValue({});
  m.upload
    .mockReset()
    .mockImplementation(
      async () => `https://example.invalid/${m.upload.mock.calls.length}.png`,
    );
  m.submit
    .mockReset()
    .mockImplementation(async () => ({
      taskId: `task-${m.submit.mock.calls.length}`,
      submitUrl: "https://example.invalid/submit",
      submittedParameters: {},
    }));
  m.update
    .mockReset()
    .mockImplementation(async (id: number, userId: number, data: any) => {
      const i = m.takes.findIndex((t) => t.id === id && t.userId === userId);
      if (i < 0) return null;
      m.takes[i] = { ...m.takes[i], ...data };
      return m.takes[i];
    });
  m.refresh.mockImplementation(async (take: VideoTake) => ({
    status: "ok",
    take,
  }));
  m.probe.mockImplementation(async (file: string) => {
    const { stdout } = await run("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "stream=width,height:format=duration",
      "-of",
      "json",
      file,
    ]);
    const data = JSON.parse(stdout);
    return {
      width: data.streams[0].width,
      height: data.streams[0].height,
      durationSec: Number(data.format.duration),
    };
  });
});
afterAll(() => fs.rm(root, { recursive: true, force: true }));
async function submit() {
  const q = await quoteWarehouseVideoSequence(input, 1);
  return submitWarehouseVideoSequence(
    {
      ...input,
      requestId,
      fingerprint: q.fingerprint,
      confirmedCny: q.totalCny,
    },
    1,
  );
}
describe("ordered warehouse video", () => {
  it("quotes the reviewed seconds without submitting, then sends only each segment's own cues", async () => {
    const plan = { ...input, segmentSeconds: 3, secondCues: [["城市", "向前", "越过屋顶"], ["进入树林", "停在小屋"]] };
    const quote = await quoteWarehouseVideoSequence(plan, 1);
    expect(quote.totalSeconds).toBe(5);
    expect(m.submit).not.toHaveBeenCalled();
    const edited = { ...plan, secondCues: [["换一个开场", "向前", "越过屋顶"], plan.secondCues[1]] };
    await expect(submitWarehouseVideoSequence({ ...edited, requestId, fingerprint: quote.fingerprint, confirmedCny: quote.totalCny }, 1)).rejects.toThrow("重新确认");
    expect(m.reserve).not.toHaveBeenCalled();
    await submitWarehouseVideoSequence({ ...plan, requestId, fingerprint: quote.fingerprint, confirmedCny: quote.totalCny }, 1);
    expect(m.submit.mock.calls.map(call => call[1].spec.durationSec)).toEqual([3,2]);
    expect(m.submit.mock.calls[0][1].spec.prompt).toContain("2–3秒：越过屋顶");
    expect(m.submit.mock.calls[0][1].spec.prompt).not.toContain("停在小屋");
    expect(m.submit.mock.calls[1][1].spec.prompt).toContain("1–2秒：停在小屋");
    expect(m.takes[0].durationSec).toBe(5);
  });
  it("rechecks the current edit and sends only each segment's cues", async () => {
    const first={startFrame:30,endFrame:60,text:[{from:0,to:1,text:"长成音乐"}],audio:[]};
    const second={...first,startFrame:60,endFrame:90,text:[{from:0,to:1,text:"长成电影"}]};
    m.cues.mockResolvedValue([first,second]);
    const initial=await quoteWarehouseVideoSequence(input,1);
    m.cues.mockResolvedValue([first,{...second,text:[{from:0,to:1,text:"属于你"}]}]);
    await expect(submitWarehouseVideoSequence({...input,requestId,fingerprint:initial.fingerprint,confirmedCny:initial.totalCny},1)).rejects.toThrow("重新确认");
    expect(m.reserve).not.toHaveBeenCalled();expect(m.submit).not.toHaveBeenCalled();
    const current=await quoteWarehouseVideoSequence(input,1);
    await submitWarehouseVideoSequence({...input,requestId,fingerprint:current.fingerprint,confirmedCny:current.totalCny},1);
    expect(m.submit.mock.calls[0][1].spec.prompt).toContain("长成音乐");
    expect(m.submit.mock.calls[0][1].spec.prompt).not.toContain("属于你");
    expect(m.submit.mock.calls[1][1].spec.prompt).toContain("属于你");
  });
  it("refuses ambiguous transforms before purchase and binds the actual region to the first segment and quote", async () => {
    const plan={...input,prompt:"发送按钮变成纸飞机",segmentSeconds:1,secondCues:[["从按钮原位飞出"],["继续向前"]]};
    const objectOrigin={imageId:9,label:"右边粉色圆形发送键",rect:{x:.8,y:.55,w:.12,h:.12}};
    await expect(quoteWarehouseVideoSequence(plan,1)).rejects.toThrow("圈出");
    await expect(quoteWarehouseVideoSequence({...plan,objectOrigin:{...objectOrigin,imageId:3}},1)).rejects.toThrow("首帧已改变");
    const q=await quoteWarehouseVideoSequence({...plan,objectOrigin},1);
    await expect(submitWarehouseVideoSequence({...plan,objectOrigin:{...objectOrigin,rect:{...objectOrigin.rect,x:.7}},requestId,fingerprint:q.fingerprint,confirmedCny:q.totalCny},1)).rejects.toThrow("重新确认");
    expect(m.submit).not.toHaveBeenCalled();
    expect(m.reserve).not.toHaveBeenCalled();
    await submitWarehouseVideoSequence({...plan,objectOrigin,requestId,fingerprint:q.fingerprint,confirmedCny:q.totalCny},1);
    expect(m.submit.mock.calls[0][1].spec.prompt).toContain("右边粉色圆形发送键");
    expect(m.submit.mock.calls[0][1].spec.prompt).toContain("原位不留下副本");
    expect(m.submit.mock.calls[1][1].spec.prompt).toContain("延续首段变形后的同一主体");
  });
  it.each([
    [9, 3],
    [9, 3, 5],
    [9, 3, 5, 6, 8],
  ])("uses every adjacent frame in order %j", (...ids) => {
    expect(warehouseSequencePairs(ids)).toEqual(
      ids.slice(1).map((id, i) => [ids[i], id]),
    );
  });
  it("quotes all segments without an upload, reservation or model call", async () => {
    const q = await quoteWarehouseVideoSequence(input, 1);
    expect(q.images.map((i) => i.id)).toEqual([9, 3, 5]);
    expect(q.totalCny).toBe(
      2 *
        estimateViduQ2TransitionCny({
          durationSec: 1,
          resolution: "720p",
          uploadCount: 2,
        }).estimatedCny,
    );
    expect(q.totalSeconds).toBe(2);
    expect(m.upload).not.toHaveBeenCalled();
    expect(m.reserve).not.toHaveBeenCalled();
    expect(m.submit).not.toHaveBeenCalled();
  });
  it("rejects duplicates and missing, foreign or rectangular images before billing", async () => {
    expect(
      warehouseVideoSequenceInput.safeParse({ ...input, imageIds: [3, 3] })
        .success,
    ).toBe(false);
    m.story.mockResolvedValueOnce(null);
    await expect(quoteWarehouseVideoSequence(input, 1)).rejects.toThrow("无权");
    await expect(
      quoteWarehouseVideoSequence({ ...input, imageIds: [9, 999] }, 1),
    ).rejects.toThrow("不可用");
    m.assets.mockResolvedValueOnce([
      { id: 9, imageUrl: "a", status: "rejected" },
    ]);
    await expect(
      quoteWarehouseVideoSequence({ ...input, imageIds: [9, 3] }, 1),
    ).rejects.toThrow("不可用");
    const wide = await sharp({
      create: { width: 64, height: 32, channels: 3, background: "red" },
    })
      .png()
      .toBuffer();
    m.read.mockResolvedValue(
      `data:image/png;base64,${wide.toString("base64")}`,
    );
    await expect(quoteWarehouseVideoSequence(input, 1)).rejects.toThrow("方形");
    expect(m.submit).not.toHaveBeenCalled();
    expect(m.reserve).not.toHaveBeenCalled();
  });
  it("rejects changed price, order and pixels before billing", async () => {
    const q = await quoteWarehouseVideoSequence(input, 1);
    const args = {
      ...input,
      requestId,
      fingerprint: q.fingerprint,
      confirmedCny: q.totalCny,
    };
    await expect(
      submitWarehouseVideoSequence({ ...args, confirmedCny: 0 }, 1),
    ).rejects.toThrow("报价");
    await expect(
      submitWarehouseVideoSequence({ ...args, imageIds: [3, 9, 5] }, 1),
    ).rejects.toThrow("报价");
    const changed = await sharp(png).negate().png().toBuffer();
    m.read.mockResolvedValue(
      `data:image/png;base64,${changed.toString("base64")}`,
    );
    await expect(submitWarehouseVideoSequence(args, 1)).rejects.toThrow("报价");
    expect(m.upload).not.toHaveBeenCalled();
  });
  it("submits each ordered pair once and recovers the same receipt after a repeated confirmation", async () => {
    const q = await quoteWarehouseVideoSequence(input, 1);
    const args = {
      ...input,
      requestId,
      fingerprint: q.fingerprint,
      confirmedCny: q.totalCny,
    };
    const [a, b] = await Promise.all([
      submitWarehouseVideoSequence(args, 1),
      submitWarehouseVideoSequence(args, 1),
    ]);
    expect(a.id).toBe(b.id);
    expect(m.submit).toHaveBeenCalledTimes(2);
    expect(m.upload).toHaveBeenCalledTimes(4);
    expect(m.reserve).toHaveBeenCalledTimes(2);
    expect(
      m.takes
        .slice(1)
        .map((t) => [
          t.parameterSnapshot.firstFrameImageId,
          t.parameterSnapshot.lastFrameImageId,
        ]),
    ).toEqual([
      [9, 3],
      [3, 5],
    ]);
    expect(await findWarehouseVideoSequence(7, requestId, 1)).toMatchObject({
      id: a.id,
      status: "processing",
    });
    expect(await findWarehouseVideoSequence(7, requestId, 2)).toBeNull();
    await submitWarehouseVideoSequence(args, 1);
    expect(m.submit).toHaveBeenCalledTimes(2);
  });
  it("insufficient funds releases holds before any external calls", async () => {
    m.reserve
      .mockResolvedValueOnce({ outcome: "reserved" })
      .mockRejectedValueOnce(new Error("insufficient funds"));
    const take = await submit();
    expect(take.status).toBe("unfollowable");
    expect(m.upload).not.toHaveBeenCalled();
    expect(m.submit).not.toHaveBeenCalled();
    expect(
      m.settle.mock.calls.every(
        ([x]) => x.outcome.kind === "not_charged_failure",
      ),
    ).toBe(true);
  });
  it("keeps a partial success, marks unknown submissions, and never submits again on refresh", async () => {
    m.submit
      .mockResolvedValueOnce({
        taskId: "first",
        submitUrl: "https://example.invalid/submit",
      })
      .mockRejectedValueOnce(new Error("connection lost"));
    const take = await submit();
    expect(take.status).toBe("unfollowable");
    expect(m.takes[1].taskId).toBe("first");
    expect(m.takes[2].status).toBe("unfollowable");
    expect(m.settle).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: { kind: "submission_unknown" } }),
    );
    await refreshWarehouseVideoSequence(take, 1);
    await submit();
    expect(m.submit).toHaveBeenCalledTimes(2);
    expect(m.probe).not.toHaveBeenCalled();
  });
  it("persists a provider receipt even when its first database save fails", async () => {
    const update = m.update.getMockImplementation()!;
    let failed = false;
    m.update.mockImplementation(async (...args: any[]) => {
      if (args[2].taskId && !failed) {
        failed = true;
        throw new Error("disk busy");
      }
      return update(...args);
    });
    const take = await submit();
    expect(take.status).toBe("unfollowable");
    expect(m.takes[1]).toMatchObject({
      taskId: "task-1",
      status: "processing",
    });
    expect(m.record).toHaveBeenCalled();
    await submit();
    expect(m.submit).toHaveBeenCalledTimes(1);
  });
  it("assembles real clips into one ordered, silent candidate without changing a timeline", async () => {
    const take = await submit();
    for (const [i, child] of m.takes.slice(1).entries()) {
      const videoKey = `segment-${i}.mp4`;
      await run("ffmpeg", [
        "-y",
        "-f",
        "lavfi",
        "-i",
        `color=c=${i ? "blue" : "red"}:s=64x64:r=24:d=1`,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        path.join(root, videoKey),
      ]);
      Object.assign(child, {
        status: "available",
        videoKey,
        videoUrl: `/api/videos/${videoKey}`,
        durationSec: 1,
      });
    }
    const result = await refreshWarehouseVideoSequence(take, 1);
    expect(result.take).toMatchObject({
      status: "available",
      durationSec: 2,
      stableShotId: "shot-3",
      parameterSnapshot: { imageIds: [9, 3, 5], appliedToTimeline: false },
    });
    const output = path.join(root, result.take.videoKey!);
    for (const [time, channel] of [
      [0.4, 0],
      [1.4, 2],
    ]) {
      const { stdout } = await run(
        "ffmpeg",
        [
          "-v",
          "error",
          "-ss",
          String(time),
          "-i",
          output,
          "-frames:v",
          "1",
          "-vf",
          "scale=1:1",
          "-f",
          "rawvideo",
          "-pix_fmt",
          "rgb24",
          "pipe:1",
        ],
        { encoding: "buffer" },
      );
      expect(stdout[channel]).toBeGreaterThan(200);
    }
    expect(m.submit).toHaveBeenCalledTimes(2);
  });
  it("does not assemble a failed or incomplete sequence or another account's take", async () => {
    const take = await submit();
    m.takes[1].status = "failed";
    expect((await refreshWarehouseVideoSequence(take, 1)).take.status).toBe(
      "failed",
    );
    await expect(refreshWarehouseVideoSequence(take, 2)).rejects.toThrow(
      "无权",
    );
    expect(m.probe).not.toHaveBeenCalled();
  });
  it("retains successful segments if the local assembly file is unavailable", async () => {
    const take = await submit();
    for (const child of m.takes.slice(1))
      Object.assign(child, {
        status: "available",
        videoKey: "absent.mp4",
        durationSec: 1,
      });
    const result = await refreshWarehouseVideoSequence(take, 1);
    expect(result.take.status).toBe("failed");
    expect(result.take.parameterSnapshot).toMatchObject({
      assemblyFailed: true,
    });
    expect(m.takes[1].status).toBe("available");
  });
});

it("binds reviewed frames to the quote and refuses changed frames or duration before purchase", async () => {
  const review = { reviewId: "a7b27f0e-933e-4b6d-82d4-3b6d3def94c1", reviewRevision: 2, timelineVersion: 9 };
  const plan = { images: input.imageIds.map(id => ({ id })), segmentSeconds: 1, sourceTakeId: 10, sourceDurationSec: 2, review };
  m.reviewedPlan.mockResolvedValue(plan);
  const quote = await quoteWarehouseVideoSequence({ ...input, review }, 1);
  expect(quote.reviewedSource).toEqual({ takeId: 10, durationSec: 2, review });
  expect(m.reserve).not.toHaveBeenCalled();
  await expect(quoteWarehouseVideoSequence({ ...input, review, segmentSeconds: 2 }, 1)).rejects.toThrow("原时长");
  m.reviewedPlan.mockRejectedValue(new Error("review changed"));
  await expect(submitWarehouseVideoSequence({ ...input, review, requestId, fingerprint: quote.fingerprint, confirmedCny: quote.totalCny }, 1)).rejects.toThrow("review changed");
  expect(m.reserve).not.toHaveBeenCalled();
  expect(m.submit).not.toHaveBeenCalled();
});
