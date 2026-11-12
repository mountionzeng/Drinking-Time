import { beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_TIMELINE_TRANSFORM,
  type StoryMaterialState,
} from "../../shared/storyMaterial";
const mocks = vi.hoisted(() => ({
  material: vi.fn(),
  evidence: vi.fn(),
  inference: vi.fn(),
  export: vi.fn(),
  localText: vi.fn(),
}));
vi.mock("./storyMaterials", () => ({ getStoryMaterialState: mocks.material }));
vi.mock("./videoBookEvidence", () => ({
  readVideoBookEvidence: mocks.evidence,
}));
vi.mock("./videoBookLocalText", async original => ({
  ...(await original<typeof import("./videoBookLocalText")>()),
  readLocalVideoText: mocks.localText,
}));
vi.mock("./videoExport", () => ({
  exportStoryTimeline: mocks.export,
  resolveVideoExportAspectRatio: () => "9:16",
}));
vi.mock("../_core/textComputeProvider", () => ({
  resolveComputeCandidates: () => [
    {
      id: "302",
      model: "gemini-2.5-flash",
      label: "302",
      apiKey: "test",
      baseUrl: "https://example.invalid",
    },
  ],
}));
vi.mock("../../shared/textComputePricing", () => ({
  resolveTextPrice: () => ({ priced: true, yuanPer1kTokens: 0.01 }),
}));
vi.mock("../_core/inferenceOrchestrator", () => ({
  runInference: mocks.inference,
  inferenceFailureOutcome: () => ({ kind: "submission_unknown" }),
}));
import { createStory } from "../repositories/stories";
import {
  insertChapter,
  listChapters,
  saveChapterContent,
} from "../repositories/chapters";
import { updateStoryTimeline } from "../repositories/timelines";
import {
  editConversionDraft,
  adoptManuscriptConversion,
  getBookWorkflow,
} from "./bookWorkflow";
import {
  generateVideoBook,
  quoteVideoBook,
  getVideoBookSource,
  sampleVideoBookFrames,
  videoBookChapters,
  videoBookSourceFingerprint,
} from "./videoBook";
let material: StoryMaterialState;
const content = {
  chapters: [
    {
      title: "拾光",
      modules: [
        { format: "text", text: "用画面和声音记录生活。", parent: null },
      ],
    },
  ],
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.localText.mockResolvedValue({
    source: "local-ocr",
    paragraphs: [{ startFrame: 0, text: "字幕里的原话，不添加其他内容。" }],
  });
  mocks.evidence.mockResolvedValue({
    transcript: "用画面和声音记录生活。",
    images: ["data:image/jpeg;base64,AA=="],
    videoSha256: "abc",
  });
  mocks.inference.mockResolvedValue({
    model: "gemini-2.5-flash",
    result: { choices: [{ message: { content: JSON.stringify(content) } }] },
  });
  mocks.export.mockResolvedValue({
    status: "ok",
    videoUrl: "/api/videos/test.mp4",
    durationSec: 5,
  });
  mocks.material.mockImplementation(async () => structuredClone(material));
});
async function fixture() {
  const story = await createStory({
    userId: 716,
    title: "视频转书测试",
    body: { _revision: 1, shots: [] },
  });
  material = {
    storyId: story.id,
    timeline: {
      storyId: story.id,
      version: 0,
      items: [
        {
          stableShotId: "s1",
          position: 0,
          included: true,
          plannedDurationMs: 5000,
          transform: DEFAULT_TIMELINE_TRANSFORM,
          primaryVideoEdit: {
            takeId: 9,
            sourceStartSec: 0,
            sourceEndSec: 5,
            effects: {
              playbackRate: 1,
              reverse: false,
              volume: 1,
              muted: false,
            },
          },
        },
      ],
    },
    shots: [],
    unassignedImages: [],
    unassignedVideoTakes: [],
    reusableVideoTakes: [],
  };
  return {
    storyId: story.id,
    userId: 716,
    actor: { userId: 716, name: "测试作者" },
    id: randomUUID(),
    request: "按自己的想法写一段介绍",
  };
}
it("quotes without any media or model calls, supports implicit timeline positions", async () => {
  const owner = await fixture();
  const source = await getVideoBookSource(owner);
  const q = await quoteVideoBook(owner);
  expect(source).toMatchObject({ available: true, durationSec: 5 });
  expect(q.frameCount).toBe(1);
  expect(q.maxCostMinor).toBeGreaterThan(0);
  expect(Number(q.estimatedCompute)).toBe((q.maxCostMinor * 2) / 1_000_000);
  expect(mocks.evidence).not.toHaveBeenCalled();
  expect(mocks.inference).not.toHaveBeenCalled();
});
it("creates a preview once, preserves current chapters and timeline, and adopts a traceable version", async () => {
  const owner = await fixture();
  const before = structuredClone(material);
  const q = await quoteVideoBook(owner);
  const request = { ...owner, quoteFingerprint: q.quoteFingerprint };
  const draft = await generateVideoBook(request);
  expect(draft.status, draft.error).toBe("review");
  expect(await generateVideoBook(request)).toEqual(draft);
  expect(mocks.inference).toHaveBeenCalledOnce();
  expect(await listChapters(owner.storyId, owner.userId, "text")).toHaveLength(
    0
  );
  const saved = await adoptManuscriptConversion({
    ...owner,
    revision: draft.revision,
  });
  expect(saved).toMatchObject({
    kind: "text",
    number: 1,
    author: owner.actor,
    confirmedBy: owner.actor,
    source: { kind: "video", number: 1, timelineVersion: 0 },
  });
  expect(saved.source?.id).not.toBeUndefined();
  expect(
    (await listChapters(owner.storyId, owner.userId, "text"))[0].blocks.body
  ).toContain("记录生活");
  expect(material).toEqual(before);
  expect(
    await adoptManuscriptConversion({ ...owner, revision: draft.revision })
  ).toEqual(saved);
  expect(mocks.inference.mock.calls[0][0]).toMatchObject({
    replaySafe: false,
    explicitCandidates: [{ model: "gemini-2.5-flash" }],
  });
});
it("rejects stale requirements or video before starting paid work", async () => {
  const owner = await fixture();
  const q = await quoteVideoBook(owner);
  await expect(
    generateVideoBook({
      ...owner,
      request: "改成诗歌",
      quoteFingerprint: q.quoteFingerprint,
    })
  ).rejects.toThrow("报价已变化");
  material.timeline.items[0].plannedDurationMs = 7000;
  await expect(
    generateVideoBook({ ...owner, quoteFingerprint: q.quoteFingerprint })
  ).rejects.toThrow("报价已变化");
  expect(mocks.inference).not.toHaveBeenCalled();
});
it("does not send to a provider if video changes while reading evidence", async () => {
  const owner = await fixture();
  const q = await quoteVideoBook(owner);
  mocks.evidence.mockImplementation(async () => {
    material.timeline.items[0].plannedDurationMs = 7000;
    return { transcript: "text", images: [], videoSha256: "a" };
  });
  const draft = await generateVideoBook({
    ...owner,
    quoteFingerprint: q.quoteFingerprint,
  });
  expect(draft.status).toBe("failed");
  expect(mocks.inference).not.toHaveBeenCalled();
});
it("preserves a failed request and does not repeat it under the same id", async () => {
  const owner = await fixture();
  const q = await quoteVideoBook(owner);
  mocks.inference.mockRejectedValue(new Error("upstream timeout"));
  const request = { ...owner, quoteFingerprint: q.quoteFingerprint };
  const draft = await generateVideoBook(request);
  expect(draft.status).toBe("failed");
  expect(draft.submissionUncertain).toBe(true);
  expect(await generateVideoBook(request)).toEqual(draft);
  await expect(quoteVideoBook(owner)).rejects.toThrow("费用仍待核对");
  await expect(
    generateVideoBook({ ...request, id: randomUUID() })
  ).rejects.toThrow("费用仍待核对");
  expect(mocks.inference).toHaveBeenCalledOnce();
  expect(await listChapters(owner.storyId, owner.userId, "text")).toHaveLength(
    0
  );
});
it("target edits made after quote/generation survive adoption attempts", async () => {
  const owner = await fixture();
  const chapter = await insertChapter({
    ...owner,
    content: {
      title: "已有书稿",
      layout: null,
      blocks: {
        body: "原文",
        blockIds: [],
        containsAiText: false,
        settings: null,
        coverKey: null,
        bodyTextureKey: null,
        images: {},
        illustrations: [],
      },
    },
  });
  const q = await quoteVideoBook(owner);
  const draft = await generateVideoBook({
    ...owner,
    quoteFingerprint: q.quoteFingerprint,
  });
  await saveChapterContent({
    id: chapter.id,
    userId: owner.userId,
    expectedVersion: 1,
    content: { blocks: { ...chapter.blocks, body: "用户刚改的文字" } },
    reason: "autosave",
  });
  await expect(
    adoptManuscriptConversion({ ...owner, revision: draft.revision })
  ).rejects.toThrow("已更新");
  expect(
    (await listChapters(owner.storyId, owner.userId, "text"))[0].blocks.body
  ).toBe("用户刚改的文字");
});
it("timeline edits prevent stale adoption while retaining the review", async () => {
  const owner = await fixture();
  const q = await quoteVideoBook(owner);
  const draft = await generateVideoBook({
    ...owner,
    quoteFingerprint: q.quoteFingerprint,
  });
  await updateStoryTimeline({
    ...owner,
    expectedVersion: 0,
    items: material.timeline.items,
  });
  await expect(
    adoptManuscriptConversion({ ...owner, revision: draft.revision })
  ).rejects.toThrow("剪辑已有新修改");
  expect((await getBookWorkflow(owner)).state.conversions[0].status).toBe(
    "review"
  );
});
it("does not expose or generate another owner's story", async () => {
  const owner = await fixture();
  await expect(quoteVideoBook({ ...owner, userId: 717 })).rejects.toMatchObject(
    { code: "NOT_FOUND" }
  );
  expect(mocks.inference).not.toHaveBeenCalled();
});
it("requires readable video and bounded, nonempty generated content", async () => {
  const owner = await fixture();
  material.timeline.items = [];
  await expect(quoteVideoBook(owner)).rejects.toThrow("没有可读取");
  expect(() => videoBookChapters({ chapters: [] })).toThrow();
  expect(() =>
    videoBookChapters({
      chapters: [
        {
          title: "title",
          modules: [{ format: "heading1", text: "heading", parent: null }],
        },
      ],
    })
  ).toThrow("缺少正文");
  const frames = sampleVideoBookFrames(
    Array.from({ length: 100 }, (_, i) => ({
      timelineStartFrame: i * 30,
      durationFrames: 30,
    })),
    3000
  );
  expect(frames).toHaveLength(24);
  expect(frames[0]).toBe(0.5);
  expect(frames.at(-1)).toBe(99.5);
});

it("restores local text with zero compute even when the prior paid result is unknown", async () => {
  const owner = await fixture();
  const oldQuote = await quoteVideoBook(owner);
  mocks.inference.mockRejectedValueOnce(new Error("timeout"));
  const failed = await generateVideoBook({
    ...owner,
    quoteFingerprint: oldQuote.quoteFingerprint,
  });
  expect(failed.submissionUncertain).toBe(true);
  const blank = await insertChapter({
    ...owner,
    content: {
      title: "空白稿",
      layout: null,
      blocks: {
        body: "",
        blockIds: [],
        containsAiText: false,
        settings: null,
        coverKey: null,
        bodyTextureKey: null,
        images: {},
        illustrations: [],
      },
    },
  });
  const local = {
    ...owner,
    id: randomUUID(),
    method: "local-transcript" as const,
    request: "先按原片恢复文字，不改写",
  };
  const quote = await quoteVideoBook(local);
  expect(quote.estimatedCompute).toBe(0);
  expect(quote.maxCostMinor).toBe(0);
  const draft = await generateVideoBook({
    ...local,
    quoteFingerprint: quote.quoteFingerprint,
  });
  expect(draft.status, draft.error).toBe("review");
  expect(draft.videoTextMethod).toBe("local-transcript");
  expect(draft.chapters?.[0].blocks.body).toContain("字幕里的原话");
  expect(mocks.inference).toHaveBeenCalledTimes(1);
  const edited = await editConversionDraft({
    ...local,
    revision: draft.revision,
    texts: [["校对后的原片文字。"]],
  });
  const version = await adoptManuscriptConversion({
    ...local,
    revision: edited.revision,
  });
  expect(version.chapters[0].blocks.body).toBe("校对后的原片文字。");
  expect(version.number).toBe(1);
  expect(version.source).toMatchObject({ kind: "video", number: 1 });
  expect((await getBookWorkflow(owner)).state.versions).toHaveLength(1);
  expect((await listChapters(owner.storyId, owner.userId, "text"))[0].id).toBe(
    blank.id
  );
  await expect(quoteVideoBook({ ...local, method: "rewrite" })).rejects.toThrow(
    "费用仍待核对"
  );
});
it("cannot reuse a zero-cost quote to start paid rewriting", async () => {
  const owner = await fixture();
  const quote = await quoteVideoBook({ ...owner, method: "local-transcript" });
  await expect(
    generateVideoBook({
      ...owner,
      method: "rewrite",
      quoteFingerprint: quote.quoteFingerprint,
    })
  ).rejects.toThrow("报价已变化");
  expect(mocks.inference).not.toHaveBeenCalled();
});

it("reuses video sources after JSON persistence removes undefined values and serializes dates",async()=>{
 await fixture();
 const live = structuredClone(material);
 (live.timeline as any).updatedAt=new Date("2026-11-12T10:00:00Z");
 (live.timeline as any).optionalValue=undefined;
 const saved=JSON.parse(JSON.stringify(live));
 expect(videoBookSourceFingerprint(live,{})).toBe(videoBookSourceFingerprint(saved,{}));
});
