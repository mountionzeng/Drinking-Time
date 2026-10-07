import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import {
  emptyPublishingDraftState,
  upsertPublishingPlatformDraft,
} from "../../shared/publishingDraft";
import {
  buildPublishingVideoPreview,
  canonicalizePublishingVideoParagraphs,
} from "../../shared/publishingVideoStoryboard";
import { buildPublishingArticleVideoPreview } from "../../shared/publishingArticleVideo";
import { imagePackParagraphs } from "../../shared/articleIllustrations";

function publishingState() {
  const empty = emptyPublishingDraftState(100);
  const withCore = {
    ...empty,
    core: {
      revision: 1,
      facts: ["事实"],
      thesis: "判断",
      emotion: "克制",
      voiceTraits: ["直接"],
      visualConcept: "纸质油画",
      updatedAt: 100,
    },
  };
  const state = upsertPublishingPlatformDraft(withCore, {
    platform: "xiaohongshu",
    content: {
      title: "标题",
      body: "第一段正文。\n\n第二段正文。\n\n第三段正文。\n\n第四段正文。",
      tags: ["结构化标签"],
    },
    activate: true,
    now: 101,
  });
  return {
    ...state,
    versions: state.versions?.map(version => ({
      ...version,
      core: structuredClone(state.core),
      drafts: structuredClone(state.drafts),
      activePlatform: state.activePlatform,
      selectedPlatforms: [...state.selectedPlatforms],
      versionRevision: state.revision,
    })),
  };
}

function generatedPreview(body: string, now = 200) {
  const paragraphs = canonicalizePublishingVideoParagraphs(body);
  return {
    preview: buildPublishingVideoPreview({
      paragraphs,
      rewrites: paragraphs.map((paragraph, index) => ({
        paragraphId: paragraph.paragraphId,
        scriptText: `转写后的第 ${index + 1} 段剧本。`,
        visualTreatment: `第 ${index + 1} 个画面动作。`,
        shots: [
          {
            soundRequirement: `第 ${index + 1} 段的纸张摩擦与环境底噪。`,
          },
        ],
      })),
      now,
    }),
    modelLabel: "test-model",
  };
}

function generatedSplitPreview(body: string, now = 200) {
  const paragraphs = canonicalizePublishingVideoParagraphs(body);
  return {
    preview: buildPublishingVideoPreview({
      paragraphs,
      rewrites: paragraphs.map((paragraph, index) => ({
        paragraphId: paragraph.paragraphId,
        scriptText: `转写后的第 ${index + 1} 段剧本。`,
        visualTreatment: `第 ${index + 1} 个画面动作。`,
        shots:
          index === 0
            ? [
                { action: "第一段的第一个镜头" },
                { action: "第一段的第二个镜头" },
              ]
            : [{ action: `第 ${index + 1} 段镜头` }],
      })),
      now,
    }),
    modelLabel: "test-model",
  };
}

const previousDatabaseUrl = process.env.DATABASE_URL;
const previousLocalPersistPath = process.env.LOCAL_PERSIST_PATH;
const tempDir = await mkdtemp(path.join(os.tmpdir(), "dt-video-storyboard-"));
process.env.DATABASE_URL = "";
process.env.LOCAL_PERSIST_PATH = path.join(tempDir, "local-persist.json");

let db = await import("../db");
let persistence = await import("./publishingVideoStoryboardPersistence");

afterAll(async () => {
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
  if (previousLocalPersistPath === undefined) {
    delete process.env.LOCAL_PERSIST_PATH;
  } else {
    process.env.LOCAL_PERSIST_PATH = previousLocalPersistPath;
  }
  await rm(tempDir, { recursive: true, force: true });
});

describe("publishing video preview persistence", () => {
  it("persists a supplemental shot with an illustration generation reference, not a ready video frame", async () => {
    const publishing = publishingState();
    const body = publishing.drafts.xiaohongshu!.content.body;
    const story = await db.createStory({ userId: 31, title: "supplement", body: { _revision: 1, shots: [], publishing } });
    const image = await db.createGeneratedImage({ userId: 31, storyId: story.id, projectId: null, shotNo: "PUBLISHING-COVER", imageUrl: "data:image/png;base64,QQ==", imageKey: null, prompt: "修伞铺全景", generationType: "initial", isCurrent: false });
    const generate = vi.fn<NonNullable<Parameters<typeof persistence.generateAndPersistPublishingVideoPreview>[0]["generate"]>>(async input => ({
      preview: buildPublishingArticleVideoPreview({ rows: input.articleRows!, requirements: new Map(), supplements: [{
        anchorRowId: input.articleRows![0].id, sourceRowId: input.articleRows![0].id, position: "after",
        reason: "全景看不清关键动作", subject: "阿宁的手", action: "钉好松动木条", imageRequirement: "手部近景，保留人物与画风", videoRequirement: "固定镜头完成钉木条动作", soundRequirement: "敲击声",
      }], now: 400 }), modelLabel: "test",
    }));
    const input = { storyId: story.id, userId: 31, articleLayout: { body, illustrations: [{ assetId: image.id, after: null }] }, generate };
    const result = await persistence.generateAndConfirmPublishingVideoStoryboard(input);
    expect(result.status).toBe("confirmed");
    if (result.status !== "confirmed") throw new Error("not confirmed");
    expect(result.shots).toHaveLength(2);
    expect(result.shots[1]).toMatchObject({ dialogue: "", shotType: "补充镜头", publishingVideo: { continuityImageId: image.id } });
    const { getStoryMaterialState } = await import("./storyMaterials");
    const material = await getStoryMaterialState(story.id, 31);
    expect(material?.shots[0].currentImage?.id).toBe(image.id);
    expect(material?.shots[1]).toMatchObject({ currentImage: null, imageVersions: [], relatedImages: [], imageGenerationReference: { id: image.id } });
    const reopened = await persistence.generateAndConfirmPublishingVideoStoryboard(input);
    expect(reopened.reused).toBe(true);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("carries selected illustrations into real material projection and reopens without regenerating or overwriting edits", async () => {
    const publishing = publishingState();
    const body = publishing.drafts.xiaohongshu!.content.body;
    const story = await db.createStory({ userId: 31, title: "article image reuse", body: { _revision: 1, shots: [], publishing } });
    const images = await Promise.all([1, 2].map(index => db.createGeneratedImage({
      userId: 31, storyId: story.id, projectId: null, shotNo: `PUBLISHING-COVER-${index}`,
      imageUrl: `data:image/png;base64,${index === 1 ? "QQ==" : "Qg=="}`, imageKey: null,
      prompt: `原插图 ${index} 的画面`, generationType: "initial", isCurrent: false,
    })));
    const articleLayout = { body, illustrations: [
      { assetId: images[0].id, after: null },
      { assetId: images[1].id, after: imagePackParagraphs(body)[1].anchor },
    ] };
    const generate = vi.fn<NonNullable<Parameters<typeof persistence.generateAndPersistPublishingVideoPreview>[0]["generate"]>>(async input => ({
      preview: buildPublishingArticleVideoPreview({ rows: input.articleRows!, requirements: new Map(), now: 200 }), modelLabel: "test",
    }));
    const first = await persistence.generateAndConfirmPublishingVideoStoryboard({
      storyId: story.id, userId: 31, articleLayout, narrativeSpec: "video10", operationToken: "article-first", generate,
    });
    expect(first.status).toBe("confirmed");
    if (first.status !== "confirmed") throw new Error("not confirmed");
    expect(first.shots.map(shot => shot.scriptText).join("\n\n")).toBe(body);
    expect(first.shots.map(shot => (shot.publishingVideo as any).referenceImageId)).toEqual(images.map(image => image.id));
    expect(generate.mock.calls[0][0].articleRows?.map(row => row.referencePrompt)).toEqual(images.map(image => image.prompt));
    const { getStoryMaterialState } = await import("./storyMaterials");
    const materials = await getStoryMaterialState(story.id, 31);
    expect(materials?.shots.map(shot => shot.currentImage?.id)).toEqual(images.map(image => image.id));
    expect(materials?.shots.map(shot => shot.currentImage?.imageUrl)).toEqual(images.map(image => image.imageUrl));
    expect((await db.getGeneratedImageById(images[0].id))?.shotNo).toBe("PUBLISHING-COVER-1");

    const saved = await db.getStoryById(story.id, 31);
    const editedBody = structuredClone(saved!.body) as any;
    editedBody.shots[0].scriptText = "我修改的原文";
    editedBody.shots[0].videoPrompt = "我修改的镜头运动";
    editedBody._revision = first.storyRevision + 1;
    expect(await db.updateStoryBodyIfRevision({ id: story.id, userId: 31, expectedRevision: first.storyRevision, body: editedBody })).toBe(true);
    const reopened = await persistence.generateAndConfirmPublishingVideoStoryboard({
      storyId: story.id, userId: 31, articleLayout, narrativeSpec: "video10", operationToken: "article-reopen", generate,
    });
    expect(reopened.reused).toBe(true);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(reopened.status === "confirmed" && reopened.shots[0].scriptText).toBe("我修改的原文");
    expect(reopened.status === "confirmed" && reopened.shots[0].videoPrompt).toBe("我修改的镜头运动");
    const changedLayout = { ...articleLayout, illustrations: [articleLayout.illustrations[0], { assetId: images[1].id, after: imagePackParagraphs(body)[2].anchor }] };
    const refreshed = await persistence.generateAndConfirmPublishingVideoStoryboard({ storyId: story.id, userId: 31, articleLayout: changedLayout, narrativeSpec: "video10", operationToken: "article-new-layout", generate });
    expect(refreshed.status === "confirmed" && refreshed.shots[0].scriptText).toBe("我修改的原文");
    expect(refreshed.status === "confirmed" && refreshed.shots[0].videoPrompt).toBe("我修改的镜头运动");
  });

  it("rejects another story's illustration and stale article text before compute or formal writes", async () => {
    const publishing = publishingState();
    const body = publishing.drafts.xiaohongshu!.content.body;
    const story = await db.createStory({ userId: 31, title: "owned article", body: { _revision: 1, shots: [], publishing } });
    const other = await db.createStory({ userId: 32, title: "other", body: {} });
    const image = await db.createGeneratedImage({ userId: 32, storyId: other.id, projectId: null, shotNo: "SH01", imageUrl: "data:image/png;base64,QQ==", imageKey: null, prompt: "private", generationType: "initial", isCurrent: false });
    const generate = vi.fn(async () => generatedPreview(body));
    await expect(persistence.generateAndConfirmPublishingVideoStoryboard({ storyId: story.id, userId: 31, articleLayout: { body, illustrations: [{ assetId: image.id, after: null }] }, generate })).rejects.toThrow("选中的插图不可用");
    await expect(persistence.generateAndConfirmPublishingVideoStoryboard({ storyId: story.id, userId: 31, articleLayout: { body: "未保存的修改", illustrations: [] }, generate })).rejects.toThrow("文字稿已经变化");
    expect(generate).not.toHaveBeenCalled();
    expect((await db.getStoryById(story.id, 31))?.body).toMatchObject({ _revision: 1, shots: [] });
  });

  it("rejects a static album version before invoking video generation", async () => {
    const publishing = publishingState();
    const withAlbum = {
      ...publishing,
      versions: publishing.versions?.map(version => ({
        ...version,
        album: {
          version: 1, revision: 0, status: "draft",
          source: { platform: "xiaohongshu", draftRevision: 1, contentHash: "album", createdAt: 100 },
          pages: [{
            pageId: "album-v1-01", ordinal: 1, revision: 0, textRevision: 0,
            backgroundRevision: 0, typographyRevision: 0, sourceParagraphIds: [],
            sourceTextHash: "album", sourceStale: false, text: "画册正文",
            adoptedBackgroundAssetId: null, backgroundRounds: [], backgroundGeneration: null,
            typography: null, createdAt: 100, updatedAt: 100,
          }],
          operationReceipts: {}, createdAt: 100, updatedAt: 100,
        },
      })),
    };
    const { id } = await db.createStory({
      userId: 30,
      title: "album must not enter video",
      body: { _revision: 1, shots: [], publishing: withAlbum },
    });
    const generate = vi.fn(async () => generatedPreview("画册正文"));

    await expect(persistence.generateAndPersistPublishingVideoPreview({
      storyId: id, userId: 30, operationToken: "album-video-attempt", generate,
    })).rejects.toThrow("静态画册版本不能进入视频故事版流程");
    expect(generate).not.toHaveBeenCalled();
  });

  it("claims before generation, deduplicates retries, and never mutates formal shots", async () => {
    const publishing = publishingState();
    const bodyText = publishing.drafts.xiaohongshu!.content.body;
    const formalShots = [
      {
        stableShotId: "manual-shot-1",
        shotNo: 1,
        subject: "原镜头",
        action: "保持不动",
      },
    ];
    const { id } = await db.createStory({
      userId: 31,
      title: "preview",
      body: { _revision: 1, shots: formalShots, publishing },
    });

    let release!: () => void;
    const blocked = new Promise<void>(resolve => {
      release = resolve;
    });
    let started!: () => void;
    const didStart = new Promise<void>(resolve => {
      started = resolve;
    });
    const generate = vi.fn(async () => {
      started();
      await blocked;
      return generatedPreview(bodyText);
    });

    const first = persistence.generateAndPersistPublishingVideoPreview({
      storyId: id,
      userId: 31,
      operationToken: "preview-op-1",
      now: 200,
      generate,
    });
    await didStart;
    let completed: Awaited<typeof first> | undefined;
    try {
      const duplicate =
        await persistence.generateAndPersistPublishingVideoPreview({
          storyId: id,
          userId: 31,
          operationToken: "preview-op-1",
          now: 201,
          generate,
        });
      expect(duplicate.status).toBe("pending");
      expect(generate).toHaveBeenCalledTimes(1);
    } finally {
      release();
      completed = await first;
    }
    if (!completed) throw new Error("preview generation did not complete");
    expect(completed.status).toBe("ready");
    expect(completed.preview?.status).toBe("preview");
    expect(completed.preview?.shots).toHaveLength(4);

    const retry = await persistence.generateAndPersistPublishingVideoPreview({
      storyId: id,
      userId: 31,
      operationToken: "preview-op-1",
      now: 202,
      generate,
    });
    expect(retry).toMatchObject({ status: "ready", reused: true });
    expect(generate).toHaveBeenCalledTimes(1);
    const saved = await db.getStoryById(id, 31);
    expect((saved?.body as Record<string, unknown>).shots).toEqual(formalShots);
  });

  it("deduplicates identical in-flight previews even when callers use different operation tokens", async () => {
    const publishing = publishingState();
    const bodyText = publishing.drafts.xiaohongshu!.content.body;
    const { id } = await db.createStory({
      userId: 34,
      title: "cross-token preview dedupe",
      body: { _revision: 1, shots: [], publishing },
    });
    let release!: () => void;
    const blocked = new Promise<void>(resolve => {
      release = resolve;
    });
    let started!: () => void;
    const didStart = new Promise<void>(resolve => {
      started = resolve;
    });
    const firstGenerate = vi.fn(async () => {
      started();
      await blocked;
      return generatedPreview(bodyText);
    });
    const secondGenerate = vi.fn(async () => generatedPreview(bodyText));

    const first = persistence.generateAndPersistPublishingVideoPreview({
      storyId: id,
      userId: 34,
      operationToken: "preview-token-a",
      now: 200,
      generate: firstGenerate,
    });
    await didStart;
    try {
      const duplicate =
        await persistence.generateAndPersistPublishingVideoPreview({
          storyId: id,
          userId: 34,
          operationToken: "preview-token-b",
          now: 201,
          generate: secondGenerate,
        });

      expect(duplicate.status).toBe("pending");
      expect(secondGenerate).not.toHaveBeenCalled();
    } finally {
      release();
      await first;
    }
    expect(firstGenerate).toHaveBeenCalledTimes(1);
  });

  it("recovers a completed receipt after process restart", async () => {
    const publishing = publishingState();
    const bodyText = publishing.drafts.xiaohongshu!.content.body;
    const { id } = await db.createStory({
      userId: 32,
      title: "restart",
      body: { _revision: 0, shots: [], publishing },
    });
    const generate = vi.fn(async () => generatedPreview(bodyText));
    await persistence.generateAndPersistPublishingVideoPreview({
      storyId: id,
      userId: 32,
      operationToken: "restart-op",
      now: 300,
      generate,
    });

    vi.resetModules();
    db = await import("../db");
    persistence = await import("./publishingVideoStoryboardPersistence");
    const afterRestartGenerate = vi.fn(async () => generatedPreview(bodyText));
    const replay = await persistence.generateAndPersistPublishingVideoPreview({
      storyId: id,
      userId: 32,
      operationToken: "restart-op",
      now: 301,
      generate: afterRestartGenerate,
    });
    expect(replay).toMatchObject({ status: "ready", reused: true });
    expect(afterRestartGenerate).not.toHaveBeenCalled();
    expect((await db.getStoryById(id, 32))?.body).toMatchObject({
      _revision: 2,
    });
  });

  it("keeps a later successful preview current after an earlier generation failure", async () => {
    const publishing = publishingState();
    const bodyText = publishing.drafts.xiaohongshu!.content.body;
    const { id } = await db.createStory({
      userId: 33,
      title: "retry after failure",
      body: { _revision: 1, shots: [], publishing },
    });

    await expect(
      persistence.generateAndPersistPublishingVideoPreview({
        storyId: id,
        userId: 33,
        operationToken: "failed-preview",
        now: 200,
        generate: vi.fn(async () => {
          throw new Error("model output invalid");
        }),
      })
    ).rejects.toThrow("model output invalid");

    const completed =
      await persistence.generateAndPersistPublishingVideoPreview({
        storyId: id,
        userId: 33,
        operationToken: "successful-preview",
        now: 201,
        generate: vi.fn(async () => generatedPreview(bodyText)),
      });

    expect(completed.preview?.status).toBe("preview");
  });
});

describe("publishing video storyboard confirmation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function createConfirmFixture(options?: {
    editedLegacyOpening?: boolean;
    withCover?: boolean;
  }) {
    const publishing = publishingState();
    const cover =
      options?.withCover === false
        ? null
        : { assetId: 7301, sourceCoreRevision: 1, createdAt: 150 };
    const versionId = publishing.activeVersionId!;
    const version = publishing.versions!.find(
      candidate => candidate.versionId === versionId
    )!;
    const publishingWithCover = {
      ...publishing,
      cover,
      versions: publishing.versions!.map(candidate => ({
        ...candidate,
        cover,
      })),
    };
    const legacyOpening = {
      stableShotId: "publishing-cover-opening",
      shotIdentity: "publishing-cover-opening",
      shotNo: 1,
      subject: options?.editedLegacyOpening ? "用户改过的封面" : "文字稿封面",
      action: "作为开场画面，建立这篇文字稿的视觉语气。",
      beat: "开场",
      shotType: "开场镜头",
      note: "从文字稿封面继承，可继续编辑或直接生成视频。",
    };
    const manualShot = {
      stableShotId: "manual-shot-keep",
      shotIdentity: "manual-shot-keep",
      shotNo: 2,
      subject: "手工镜头",
      action: "保留用户动作",
      dialogue: "手工台词",
      promptDraft: "手工提示词",
    };
    const { id } = await db.createStory({
      userId: 41,
      title: "confirm",
      body: {
        _revision: 1,
        shots: [legacyOpening, manualShot],
        publishing: publishingWithCover,
      },
    });
    const bodyText = version.drafts.xiaohongshu!.content.body;
    const generated =
      await persistence.generateAndPersistPublishingVideoPreview({
        storyId: id,
        userId: 41,
        versionId,
        operationToken: "preview-confirm",
        now: 200,
        generate: vi.fn(async () => generatedPreview(bodyText)),
      });
    return {
      db,
      persistence,
      id,
      versionId,
      bodyText,
      previewId: generated.preview!.previewId,
    };
  }

  it("generates and writes the storyboard through one end-to-end operation", async () => {
    const fixture = await createConfirmFixture({ editedLegacyOpening: true });
    const result =
      await fixture.persistence.generateAndConfirmPublishingVideoStoryboard({
        storyId: fixture.id,
        userId: 41,
        versionId: fixture.versionId,
        operationToken: "build-directly",
        now: 300,
        generate: vi.fn(async () => generatedPreview(fixture.bodyText, 250)),
      });

    expect(result.status).toBe("confirmed");
    if (result.status !== "confirmed") throw new Error("expected confirmation");
    expect(result.shots[0]).toMatchObject({
      stableShotId: "publishing-cover-opening",
      subject: "用户改过的封面",
    });
    expect(result.shots.slice(2)).toHaveLength(4);
    expect(result.shots.slice(2).every(shot => shot.publishingVideo)).toBe(
      true
    );
  });

  it("promotes every rewritten shot atomically, keeps manual shots, and stores the cover at Story scope", async () => {
    const fixture = await createConfirmFixture();
    const result = await fixture.persistence.confirmPublishingVideoStoryboard({
      storyId: fixture.id,
      userId: 41,
      versionId: fixture.versionId,
      previewId: fixture.previewId,
      operationToken: "confirm-1",
      now: 300,
    });

    expect(result.reused).toBe(false);
    expect(result.shots).toHaveLength(5);
    expect(
      result.shots.filter(shot => shot.stableShotId === "manual-shot-keep")
    ).toHaveLength(1);
    expect(
      result.shots.filter(
        shot => shot.stableShotId === "publishing-cover-opening"
      )
    ).toHaveLength(0);
    const formal = result.shots.filter(
      shot => shot.publishingVideo && typeof shot.publishingVideo === "object"
    );
    expect(formal).toHaveLength(4);
    expect(
      formal.every(
        shot =>
          typeof shot.scriptText === "string" &&
          typeof shot.dialogue === "string" &&
          shot.dialogue.length > 0 &&
          typeof shot.sound === "string" &&
          shot.sound.includes("环境底噪") &&
          typeof shot.promptDraft === "string" &&
          typeof shot.videoPrompt === "string" &&
          Array.isArray(shot.publishingVideo?.sourceParagraphIds)
      )
    ).toBe(true);
    expect(result.publishing.activeVideoStoryboardVersionId).toBe(
      fixture.versionId
    );
    expect(result.publishing.activeVideoStoryboardGroupId).toMatch(
      /^publishing-group-/
    );

    const saved = await fixture.db.getStoryById(fixture.id, 41);
    const body = saved?.body as Record<string, any>;
    expect(body.artDirection.references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "publishing-cover",
          role: "story-style",
          scope: "story",
          assetId: 7301,
        }),
      ])
    );
    expect(body.shots).toEqual(result.shots);
    expect(body.storyboardFieldVersions.tracks).toMatchObject({
      scriptText: { currentRevision: 2 },
      promptDraft: { currentRevision: 2 },
      videoPrompt: { currentRevision: 2 },
      dialogue: { currentRevision: 2 },
    });
    expect(
      body.shots.every(
        (shot: Record<string, any>) =>
          shot.publishingVideo?.coverAssetId == null
      )
    ).toBe(true);
  });

  it("keeps narration only on the first shot when one paragraph is split", async () => {
    const fixture = await createConfirmFixture();
    const generated =
      await fixture.persistence.generateAndPersistPublishingVideoPreview({
        storyId: fixture.id,
        userId: 41,
        versionId: fixture.versionId,
        operationToken: "split-preview",
        now: 301,
        generate: vi.fn(async () =>
          generatedSplitPreview(fixture.bodyText, 250)
        ),
      });
    const result = await fixture.persistence.confirmPublishingVideoStoryboard({
      storyId: fixture.id,
      userId: 41,
      versionId: fixture.versionId,
      previewId: generated.preview!.previewId,
      operationToken: "confirm-split-preview",
      now: 302,
    });
    const firstParagraphShots = result.shots.filter(shot =>
      shot.publishingVideo?.sourceParagraphIds.includes(
        canonicalizePublishingVideoParagraphs(fixture.bodyText)[0]!.paragraphId
      )
    );

    expect(firstParagraphShots).toHaveLength(2);
    expect(firstParagraphShots.map(shot => shot.dialogue)).toEqual([
      "第一段正文。",
      "",
    ]);
  });

  it("returns the completed confirmation receipt without duplicating formal shots", async () => {
    const fixture = await createConfirmFixture({ withCover: false });
    const input = {
      storyId: fixture.id,
      userId: 41,
      versionId: fixture.versionId,
      previewId: fixture.previewId,
      operationToken: "confirm-retry",
      now: 300,
    } as const;
    const first =
      await fixture.persistence.confirmPublishingVideoStoryboard(input);
    const second = await fixture.persistence.confirmPublishingVideoStoryboard({
      ...input,
      now: 301,
    });
    expect(second.reused).toBe(true);
    expect(second.shots).toEqual(first.shots);
    expect(second.shots).toHaveLength(5);
    const saved = await fixture.db.getStoryById(fixture.id, 41);
    expect((saved?.body as Record<string, any>).shots).toHaveLength(5);
  });

  it("keeps user-enriched shot data and stable media identity when regenerating the storyboard", async () => {
    const fixture = await createConfirmFixture({ withCover: false });
    const first = await fixture.persistence.confirmPublishingVideoStoryboard({
      storyId: fixture.id,
      userId: 41,
      versionId: fixture.versionId,
      previewId: fixture.previewId,
      operationToken: "confirm-before-user-enrichment",
      now: 300,
    });
    const firstGenerated = first.shots.find(shot =>
      Boolean(shot.publishingVideo)
    )!;
    const stableShotId = firstGenerated.stableShotId as string;
    const saved = await fixture.db.getStoryById(fixture.id, 41);
    const editedBody = structuredClone(saved?.body as Record<string, any>);
    editedBody.shots = editedBody.shots.map((shot: Record<string, any>) =>
      shot.stableShotId === stableShotId
        ? {
            ...shot,
            subject: "用户重新确定的主体",
            promptRun: {
              finalPrompt: "用户已经确认并实际出图的提示词",
              generatedAt: 350,
              imageId: 9301,
              imageUrl: "https://example.com/confirmed-frame.webp",
              source: "prompt-table-rerender",
              usedDimensions: ["subject", "style"],
            },
            voiceAudioUrl: "https://example.com/narration.mp3",
          }
        : shot
    );
    editedBody._revision = first.storyRevision + 1;
    editedBody._storyboardRevision =
      (typeof editedBody._storyboardRevision === "number"
        ? editedBody._storyboardRevision
        : 0) + 1;
    expect(
      await fixture.db.updateStoryBodyIfRevision({
        id: fixture.id,
        userId: 41,
        expectedRevision: first.storyRevision,
        body: editedBody,
      })
    ).toBe(true);

    const regenerated =
      await fixture.persistence.generateAndPersistPublishingVideoPreview({
        storyId: fixture.id,
        userId: 41,
        versionId: fixture.versionId,
        operationToken: "preview-after-user-enrichment",
        now: 400,
        generate: vi.fn(async () => generatedPreview(fixture.bodyText, 400)),
      });
    const reconfirmed =
      await fixture.persistence.confirmPublishingVideoStoryboard({
        storyId: fixture.id,
        userId: 41,
        versionId: fixture.versionId,
        previewId: regenerated.preview!.previewId,
        operationToken: "confirm-after-user-enrichment",
        now: 401,
      });

    expect(
      reconfirmed.shots.filter(shot => shot.stableShotId === stableShotId)
    ).toHaveLength(1);
    expect(
      reconfirmed.shots.find(shot => shot.stableShotId === stableShotId)
    ).toMatchObject({
      subject: "用户重新确定的主体",
      voiceAudioUrl: "https://example.com/narration.mp3",
      promptRun: {
        imageId: 9301,
        imageUrl: "https://example.com/confirmed-frame.webp",
      },
    });
  });

  it("keeps a materially edited legacy cover before writing the generated storyboard", async () => {
    const fixture = await createConfirmFixture({ editedLegacyOpening: true });
    const result = await fixture.persistence.confirmPublishingVideoStoryboard({
      storyId: fixture.id,
      userId: 41,
      versionId: fixture.versionId,
      previewId: fixture.previewId,
      operationToken: "confirm-edited-legacy",
    });

    expect(result.shots).toHaveLength(6);
    expect(result.shots[0]).toMatchObject({
      stableShotId: "publishing-cover-opening",
      subject: "用户改过的封面",
    });
    expect(result.shots[1]).toMatchObject({
      stableShotId: "manual-shot-keep",
      subject: "手工镜头",
    });
    expect(
      result.shots
        .slice(2)
        .every(shot =>
          Boolean(
            shot.publishingVideo && typeof shot.publishingVideo === "object"
          )
        )
    ).toBe(true);
    const saved = await fixture.db.getStoryById(fixture.id, 41);
    expect((saved?.body as Record<string, any>).shots).toEqual(result.shots);
  });

  it("blocks confirmation when the bound draft changes after preview", async () => {
    const fixture = await createConfirmFixture();
    const saved = await fixture.db.getStoryById(fixture.id, 41);
    const body = structuredClone(saved?.body as Record<string, any>);
    body.publishing.versions[0].drafts.xiaohongshu.content.body =
      "后来改过的正文";
    body._revision = 4;
    expect(
      await fixture.db.updateStoryBodyIfRevision({
        id: fixture.id,
        userId: 41,
        expectedRevision: 3,
        body,
      })
    ).toBe(true);

    await expect(
      fixture.persistence.confirmPublishingVideoStoryboard({
        storyId: fixture.id,
        userId: 41,
        versionId: fixture.versionId,
        previewId: fixture.previewId,
        operationToken: "confirm-stale-draft",
      })
    ).rejects.toThrow("文字稿已经变化");
    const latest = await fixture.db.getStoryById(fixture.id, 41);
    expect((latest?.body as Record<string, any>).shots).toHaveLength(2);
  });

  it("leaves the prior Story unchanged when the confirmation CAS never wins", async () => {
    const fixture = await createConfirmFixture();
    vi.spyOn(db, "updateStoryBodyIfRevision").mockResolvedValue(false);
    await expect(
      fixture.persistence.confirmPublishingVideoStoryboard({
        storyId: fixture.id,
        userId: 41,
        versionId: fixture.versionId,
        previewId: fixture.previewId,
        operationToken: "confirm-cas-conflict",
      })
    ).rejects.toThrow("确认期间故事持续被修改");
    const saved = await fixture.db.getStoryById(fixture.id, 41);
    const body = saved?.body as Record<string, any>;
    expect(body.shots).toHaveLength(2);
    expect(body.artDirection).toBeUndefined();
    expect(body.publishing.activeVideoStoryboardGroupId).toBeNull();
  });

  it("rejects confirmation from another Story owner", async () => {
    const fixture = await createConfirmFixture();
    await expect(
      fixture.persistence.confirmPublishingVideoStoryboard({
        storyId: fixture.id,
        userId: 999,
        versionId: fixture.versionId,
        previewId: fixture.previewId,
        operationToken: "confirm-other-owner",
      })
    ).rejects.toThrow("故事不存在");
  });
});
