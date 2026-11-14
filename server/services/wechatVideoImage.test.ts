import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ owns: vi.fn(), read: vi.fn() }));
vi.mock("../repositories/wechatBookImport", () => ({
  ownsWechatImportImage: mocks.owns,
}));
vi.mock("../chapterMediaStore", async importOriginal => ({
  ...(await importOriginal<typeof import("../chapterMediaStore")>()),
  readChapterMedia: mocks.read,
}));
const dir = await mkdtemp(path.join(os.tmpdir(), "wechat-video-image-"));
const previous = {
  db: process.env.DATABASE_URL,
  path: process.env.LOCAL_PERSIST_PATH,
};
process.env.DATABASE_URL = "";
process.env.LOCAL_PERSIST_PATH = path.join(dir, "db.json");
const { createStory } = await import("../repositories/stories");
const { getStoryGeneratedImages } = await import("../repositories/images");
const { indexWechatStoryboardImages, readOwnedWechatImage } = await import(
  "./wechatVideoImage"
);
const { materializeImageInput } = await import("./imageAssets");
const bytes = Buffer.from("fictional-private-image");
const digest = createHash("sha256").update(bytes).digest("hex");
const url = `/api/wechat-import/media/${digest}.png`;
function chapter(storyId: number, userId: number) {
  return {
    storyId,
    userId,
    blocks: {
      body: `画面\n![图片](${url})`,
      images: {},
      blockIds: [],
      containsAiText: false,
      settings: null,
      coverKey: null,
      bodyTextureKey: null,
      illustrations: [],
    },
  } as any;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.owns.mockResolvedValue(true);
  mocks.read.mockResolvedValue(bytes);
});
afterAll(async () => {
  if (previous.db === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previous.db;
  if (previous.path === undefined) delete process.env.LOCAL_PERSIST_PATH;
  else process.env.LOCAL_PERSIST_PATH = previous.path;
  await rm(dir, { recursive: true, force: true });
});
it("indexes an owned imported image once, retains its private URL and supports authorized rendering", async () => {
  const story = await createStory({ userId: 31, title: "虚构", body: {} });
  const input = {
    storyId: story.id,
    userId: 31,
    chapters: [chapter(story.id, 31)],
  };
  await Promise.all([
    indexWechatStoryboardImages(input),
    indexWechatStoryboardImages(input),
  ]);
  const images = await getStoryGeneratedImages(story.id, 31);
  expect(images).toHaveLength(1);
  expect(images[0]).toMatchObject({
    imageUrl: url,
    userId: 31,
    storyId: story.id,
    isCurrent: false,
  });
  expect(await materializeImageInput(url, 31)).toBe(
    `data:image/png;base64,${bytes.toString("base64")}`
  );
  expect(mocks.owns).toHaveBeenCalledWith(31, `chapters/31/${digest}.png`);
});
it("rejects an unowned, missing or altered image without indexing it", async () => {
  const story = await createStory({ userId: 32, title: "虚构", body: {} });
  const input = {
    storyId: story.id,
    userId: 32,
    chapters: [chapter(story.id, 32)],
  };
  for (const mode of ["unowned", "missing", "altered"]) {
    mocks.owns.mockResolvedValue(mode !== "unowned");
    mocks.read.mockResolvedValue(
      mode === "missing"
        ? null
        : mode === "altered"
          ? Buffer.from("altered")
          : bytes
    );
    await expect(indexWechatStoryboardImages(input)).rejects.toThrow();
    expect(await getStoryGeneratedImages(story.id, 32)).toHaveLength(0);
  }
});
it("offers an owned private reference only through an expiring signed provider link", async () => {
  const { ENV } = await import("../_core/env");
  const { wechatProviderReference } = await import("./wechatVideoImage");
  const previous = { origin: ENV.appOrigin, secret: ENV.cookieSecret };
  ENV.appOrigin = "https://example.test";
  ENV.cookieSecret = "fictional-signing-secret";
  try {
    const signed = new URL(await wechatProviderReference(url, 31));
    expect(signed.origin).toBe("https://example.test");
    expect(signed.pathname).toBe("/api/chapter-media");
    expect(signed.searchParams.get("key")).toBe(`chapters/31/${digest}.png`);
    expect(Number(signed.searchParams.get("e"))).toBeGreaterThan(Date.now());
    expect(signed.searchParams.get("token")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    mocks.owns.mockResolvedValue(false);
    await expect(wechatProviderReference(url, 32)).rejects.toThrow();
    expect(
      await wechatProviderReference("https://example.test/ordinary.png", 31)
    ).toBe("https://example.test/ordinary.png");
  } finally {
    ENV.appOrigin = previous.origin;
    ENV.cookieSecret = previous.secret;
  }
});

it("never reads a private image without an authorized account", async () => {
  await expect(materializeImageInput(url)).rejects.toThrow();
  mocks.owns.mockResolvedValue(false);
  expect(await readOwnedWechatImage(url, 99)).toBeNull();
  expect(mocks.read).not.toHaveBeenCalled();
});

it("imports a storyboard containing an owned WeChat image into the video table without generating media", async () => {
  const { emptyPublishingDraftState, upsertPublishingPlatformDraft } =
    await import("../../shared/publishingDraft");
  const { insertChapter, listChapters } = await import(
    "../repositories/chapters"
  );
  const { blockBody, writingStyleOf, newWritingBlock } = await import(
    "../../client/src/features/publishingAlbum/chapterBlockTree"
  );
  const { getBookWorkflow } = await import("./bookWorkflow");
  const { importBookStoryboard } = await import("./bookVideoCreation");
  let publishing = upsertPublishingPlatformDraft(
    emptyPublishingDraftState(100),
    {
      platform: "xiaohongshu",
      content: { title: "虚构", body: "纸船靠岸", tags: [] },
      activate: true,
      now: 101,
    }
  );
  publishing = {
    ...publishing,
    versions: publishing.versions?.map(v => ({
      ...v,
      drafts: structuredClone(publishing.drafts),
      activePlatform: publishing.activePlatform,
      selectedPlatforms: [...publishing.selectedPlatforms],
      versionRevision: publishing.revision,
    })),
  };
  const story = await createStory({
    userId: 33,
    title: "虚构",
    body: { _revision: 1, shots: [], publishing },
  });
  const blocks = [
    { ...newWritingBlock("水边"), id: "scene", format: "scene" as const },
    {
      ...newWritingBlock("纸船近景", "scene"),
      id: "shot",
      format: "shot" as const,
    },
    newWritingBlock(`![图片](${url})`, "shot"),
  ];
  const chapter = await insertChapter({
    storyId: story.id,
    userId: 33,
    content: {
      title: "分镜",
      layout: null,
      blocks: {
        body: blockBody(blocks),
        writingStyle: writingStyleOf(blocks),
        manuscriptKind: "storyboard",
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
  const before = await listChapters(story.id, 33, "all");
  const owner = {
    storyId: story.id,
    userId: 33,
    actor: { userId: 33, name: "测试" },
  };
  const fingerprint = (await getBookWorkflow(owner)).drafts.storyboard
    .fingerprint;
  const request = {
    ...owner,
    chapterId: chapter.id,
    expectedFingerprint: fingerprint,
    versionId: publishing.activeVersionId!,
    id: crypto.randomUUID(),
    request: "",
  };
  const result = await importBookStoryboard(request);
  expect(result.shots).toHaveLength(1);
  const images = await getStoryGeneratedImages(story.id, 33);
  expect(images).toHaveLength(1);
  const { getStoryMaterialState } = await import("./storyMaterials");
  const material = await getStoryMaterialState(story.id, 33);
  expect(
    material?.shots[0].imageGenerationReferences?.map(image => image.id)
  ).toEqual([images[0].id]);
  expect(await listChapters(story.id, 33, "all")).toEqual(before);
  expect((await importBookStoryboard(request)).shots).toEqual(result.shots);
  expect(await getStoryGeneratedImages(story.id, 33)).toHaveLength(1);
}, 30000);
