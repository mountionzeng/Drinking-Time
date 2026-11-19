import { afterEach, beforeEach, expect, it, vi } from "vitest";
import sharp from "sharp";
import {
  createGeneratedImage,
  createStory,
  getStoryVideoTakes,
  resetMemoryStateForTesting,
} from "../db";
import { ENV } from "../_core/env";
import { warehouseVideoSequenceRouter } from "../routers/warehouseVideoSequence";
import { buildViduSingleRequest } from "./render/adapters/viduSingle";
import { warehouseVideoSequenceInput } from "../../shared/warehouseVideoSequence";

const cue = vi.hoisted(() => ({ text: "长成电影" }));
vi.mock("./videoTimelineCues", async original => ({
  ...(await original<typeof import("./videoTimelineCues")>()),
  readVideoTimelineCues: async () => [
    {
      startFrame: 90,
      endFrame: 180,
      text: [{ from: 2.3, to: 3, text: cue.text }],
      audio: [],
    },
  ],
}));
const messageId = "84b80f07-296c-4411-b53d-1588cc00a115",
  requestId = "72441377-93af-472e-8975-bf4426965bde";
const caller = warehouseVideoSequenceRouter.createCaller({
  user: { id: 1 },
} as never);
const serverFetch = vi.fn();
const savedKey = ENV.api302Key;
beforeEach(() => {
  resetMemoryStateForTesting();
  ENV.api302Key = "test-key";
  cue.text = "长成电影";
  serverFetch
    .mockReset()
    .mockResolvedValue({
      ok: true,
      json: async () => ({ task_id: "mock-only" }),
    });
  vi.stubGlobal("fetch", serverFetch);
});
afterEach(() => {
  vi.unstubAllGlobals();
  ENV.api302Key = savedKey;
});
async function fixture() {
  const story = await createStory({
    userId: 1,
    title: "跨镜续拍",
    body: {
      shots: [
        { shotNo: 3, stableShotId: "forest" },
        { shotNo: 4, stableShotId: "cabin" },
      ],
      messages: [
        {
          id: "video-cues:" + messageId,
          text: "三秒入屋",
          selectionQuote: { stableShotId: "cabin" },
        },
      ],
    },
  });
  const png = await sharp({
    create: { width: 64, height: 64, channels: 3, background: "green" },
  })
    .png()
    .toBuffer();
  const sourceImage = "data:image/png;base64," + png.toString("base64");
  const image = await createGeneratedImage({
    userId: 1,
    storyId: story.id,
    projectId: null,
    shotIdentity: "forest",
    shotNo: "SH03",
    imageUrl: sourceImage,
    imageKey: null,
    generationType: "initial",
    isCurrent: true,
    prompt: "树梢",
  });
  return {
    sourceImage,
    input: {
      storyId: story.id,
      stableShotId: "cabin",
      imageId: image.id,
      referenceIds: [],
      messageId,
      prompt: "同一架纸飞机飞过树林进入小屋",
      seconds: ["飞过树梢", "朝门口飞", "穿过入口，飞机已在屋内"],
    },
  };
}
it("quotes a borrowed opening free and submits one scoped candidate with the exact per-second directions", async () => {
  const { sourceImage, input } = await fixture();
  const q = await caller.quoteOpening(input);
  expect(q.totalCny).toBe(0.41);
  expect(q.totalSeconds).toBe(3);
  expect(serverFetch).not.toHaveBeenCalled();
  await expect(
    caller.submitOpening({
      ...input,
      requestId,
      fingerprint: q.fingerprint,
    } as never)
  ).rejects.toThrow();
  const confirm = {
    ...input,
    requestId,
    fingerprint: q.fingerprint,
    costConfirmation: { accepted: true as const, estimatedCny: 0.41 },
  };
  for (const patch of [
    { seconds: ["飞过树梢", "另一个动作", "穿过入口"] },
    { costConfirmation: { accepted: true as const, estimatedCny: 2 } },
  ])
    await expect(
      caller.submitOpening({ ...confirm, ...patch })
    ).rejects.toThrow("重新报价");
  cue.text = "改过的字幕";
  await expect(caller.submitOpening(confirm)).rejects.toThrow("重新报价");
  cue.text = "长成电影";
  expect(serverFetch).not.toHaveBeenCalled();
  const [a, b] = await Promise.all([
    caller.submitOpening(confirm),
    caller.submitOpening(confirm),
  ]);
  expect(a.id).toBe(b.id);
  expect((await caller.submitOpening(confirm)).id).toBe(a.id);
  expect(serverFetch).toHaveBeenCalledTimes(1);
  const body = JSON.parse(serverFetch.mock.calls[0][1].body) as ReturnType<
    typeof buildViduSingleRequest
  >["body"];
  expect(body).toMatchObject({
    duration: 3,
    images: [sourceImage],
    audio: false,
    model: "viduq2-pro-fast",
  });
  expect(body.prompt).toContain("2–3秒：穿过入口，飞机已在屋内");
  expect(body.prompt).toContain("长成电影");
  expect(body.prompt).toContain("Add nothing else");
  expect(await getStoryVideoTakes(input.storyId, 1)).toHaveLength(1);
  expect(a.stableShotId).toBe("cabin");
});
it("sends the confirmed ten seconds as three continuous actions with the ending inside", async () => {
  const { input } = await fixture();
  const plan = {...input, seconds:[...Array<string>(3).fill("掠过树梢"), ...Array<string>(4).fill("下降对准入口"), ...Array<string>(3).fill("穿过门框，停在屋内")]};
  const quote = await caller.quoteOpening(plan);
  expect(quote).toMatchObject({totalSeconds:10,totalCny:0.88});
  expect(serverFetch).not.toHaveBeenCalled();
  await caller.submitOpening({...plan,requestId,fingerprint:quote.fingerprint,costConfirmation:{accepted:true,estimatedCny:quote.totalCny}});
  expect(serverFetch).toHaveBeenCalledTimes(1);
  const body = JSON.parse(serverFetch.mock.calls[0][1].body);
  expect(body.duration).toBe(10);
  expect(body.prompt).toContain("0–3秒：掠过树梢\n3–7秒：下降对准入口\n7–10秒：穿过门框，停在屋内");
  expect(body.prompt.match(/穿过门框/g)).toHaveLength(1);
});

it("keeps multi-frame, shot, asset and object-origin constraints", async () => {
  const { input } = await fixture();
  expect(
    warehouseVideoSequenceInput.safeParse({
      ...input,
      imageIds: [input.imageId],
      segmentSeconds: 3,
    }).success
  ).toBe(false);
  for (const patch of [
    { stableShotId: "forest" },
    { referenceIds: [999] },
    { imageId: 999 },
    { prompt: "发送键变成纸飞机" },
  ])
    await expect(caller.quoteOpening({ ...input, ...patch })).rejects.toThrow();
  expect(serverFetch).not.toHaveBeenCalled();
});
