import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import * as runtime from "./repositories/runtime";
import { createStory } from "./repositories/stories";
import { artworkShareRouter } from "./routers/artworkShare";
import { storyContextShareRouter } from "./routers/storyContextShare";
import { storeImageBytes } from "./services/imageGen";
import { canonicalizePublishingDraftState } from "./services/publishingPersistence";
import {
  emptyPublishingDraftState,
  normalizePublishingDraftState,
  upsertPublishingPlatformDraft,
} from "../shared/publishingDraft";
import { collectShareBacks } from "../shared/shareBackInbox";
import type { SharedLayoutPackage } from "../shared/sharedLayout";

vi.mock("./services/promptLineageStore", () => ({
  loadStoryPromptAggregate: vi.fn(async () => null),
}));
vi.mock("./services/imageGen", () => ({
  localImageDir: "/unused",
  storeImageBytes: vi.fn(),
}));

const names: Record<number, string> = { 10: "小林", 20: "小周", 30: "路人" };
const ctx = (id: number) =>
  ({
    user: { id, name: names[id] },
    req: {},
    res: { setHeader: vi.fn() },
  }) as unknown as TrpcContext;
const story = (id: number) => storyContextShareRouter.createCaller(ctx(id));
const artwork = (id: number) => artworkShareRouter.createCaller(ctx(id));

async function picture(color: string) {
  const bytes = await sharp({
    create: { width: 40, height: 30, channels: 3, background: color },
  })
    .png()
    .toBuffer();
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

async function layout(title: string): Promise<SharedLayoutPackage> {
  return {
    settings: {
      title,
      style: "sage",
      fontId: "noto-serif-sc",
      texture: "paper",
      textureSeed: 3,
      includeCover: true,
      cover: 0,
      bodyTexture: null,
      illustrations: [],
    },
    modules: {
      version: 1,
      flowVersion: 1,
      pages: [
        {
          label: "封面",
          modules: [
            {
              id: "cover-image",
              kind: "image",
              imageUrl: "layout-image:0",
              rect: { x: 65, y: 110, width: 770, height: 578 },
              crop: { x: 0, y: 0, width: 1, height: 1 },
            },
          ],
        },
      ],
    },
    images: [await picture("#c96")],
  };
}

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  runtime.resetMemoryStateForTesting();
  vi.mocked(storeImageBytes)
    .mockReset()
    .mockImplementation(async (_bytes, _mime, options) => ({
      status: "ok",
      imageUrl: `/api/images/${options!.storageKey!.split("/").pop()}`,
      imageKey: options?.storageKey,
    }));
});

async function textShareBack() {
  const publishing = upsertPublishingPlatformDraft(emptyPublishingDraftState(), {
    platform: "xiaohongshu",
    content: { title: "海边的朋友", body: "甲和乙一起长大。", tags: [] },
  });
  const { id } = await createStory({
    userId: 10,
    title: "海边",
    body: { _revision: 1, publishing, messages: [], cards: [], shots: [] },
  });
  const permissions = { rewrite: true, fork: true };
  const preview = await story(10).preview({ storyId: id, permissions });
  const { path } = await story(10).create({
    storyId: id,
    permissions,
    fingerprint: preview.fingerprint,
  });
  const { storyId } = await story(20).accept({ token: path.slice(3) });
  const copy = runtime.memoryState.stories.find(row => row.id === storyId)!;
  const body = copy.body as Record<string, unknown>;
  body.publishing = canonicalizePublishingDraftState(
    upsertPublishingPlatformDraft(normalizePublishingDraftState(body.publishing), {
      platform: "xiaohongshu",
      content: { title: "海边的朋友", body: "乙改过的海边。", tags: [] },
      activate: true,
    })
  );
  await story(20).shareBack({ storyId, operationToken: randomUUID() });
  return { authorStoryId: id, copyId: storyId };
}

async function layoutShareBack() {
  const { id } = await createStory({ userId: 10, title: "秋天的茶", body: {} });
  const token = randomUUID();
  await artwork(10).create({
    storyId: id,
    token,
    title: "秋天的茶",
    pages: [await picture("#efe6cf")],
    permissions: { rewrite: true, fork: true },
    work: { title: "秋天的茶", body: "第一段。", tags: [], platform: "xiaohongshu" },
    layout: await layout("秋天的茶"),
  });
  const { storyId } = await artwork(20).accept({ token });
  await artwork(20).shareBackLayout({
    storyId,
    operationToken: randomUUID(),
    layout: await layout("小周改的秋天"),
  });
  return { authorStoryId: id };
}

describe("share-back reminder for the author", () => {
  it("lists text and layout share-backs only to the author, without private ids", async () => {
    const text = await textShareBack();
    const art = await layoutShareBack();
    const { notices } = await story(10).shareBackInbox();
    expect(notices).toHaveLength(2);
    expect(notices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          storyId: text.authorStoryId,
          storyTitle: "海边",
          kind: "text",
          authorName: "小周",
        }),
        expect.objectContaining({
          storyId: art.authorStoryId,
          storyTitle: "秋天的茶",
          kind: "layout",
          authorName: "小周",
        }),
      ])
    );
    const json = JSON.stringify(notices);
    expect(json).not.toMatch(/userId|requestHash|token|contributorUserId/);
    expect((await story(20).shareBackInbox()).notices).toEqual([]);
    expect((await story(30).shareBackInbox()).notices).toEqual([]);
  });

  it("drops a reminder once the author adopts or ignores it", async () => {
    const text = await textShareBack();
    const art = await layoutShareBack();
    const layoutNotice = (await story(10).shareBackInbox()).notices.find(
      notice => notice.kind === "layout"
    )!;
    await artwork(10).resolveLayoutCandidate({
      storyId: art.authorStoryId,
      candidateId: layoutNotice.id.split(":").slice(2).join(":"),
      status: "dismissed",
    });
    const remaining = (await story(10).shareBackInbox()).notices;
    expect(remaining.map(notice => notice.kind)).toEqual(["text"]);
    const author = runtime.memoryState.stories.find(
      row => row.id === text.authorStoryId
    )!;
    const version = (author.body as any).textDraftHistory.versions[0];
    version.adoption = {
      content: version.generated,
      adoptedAt: Date.now(),
      feedback: "",
      learningEnabled: false,
    };
    expect((await story(10).shareBackInbox()).notices).toEqual([]);
  });

  it("survives a damaged draft history and names untitled stories", () => {
    expect(
      collectShareBacks([
        { id: 1, title: " ", body: { textDraftHistory: { versions: "broken" } } },
        { id: 2, title: "", body: null },
      ])
    ).toEqual([]);
  });
});
