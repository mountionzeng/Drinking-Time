import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  emptyPublishingDraftState,
  upsertPublishingPlatformDraft,
} from "../../shared/publishingDraft";
import {
  buildPublishingVideoPreview,
  canonicalizePublishingVideoParagraphs,
} from "../../shared/publishingVideoStoryboard";

let tempDir: string | null = null;

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
      })),
      now,
    }),
    modelLabel: "test-model",
  };
}

describe("publishing video preview persistence", () => {
  beforeEach(async () => {
    vi.resetModules();
    tempDir = await mkdtemp(path.join(os.tmpdir(), "dt-video-preview-"));
    process.env.DATABASE_URL = "";
    process.env.LOCAL_PERSIST_PATH = path.join(tempDir, "local-persist.json");
  });

  afterEach(async () => {
    delete process.env.LOCAL_PERSIST_PATH;
    delete process.env.DATABASE_URL;
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  });

  it("claims before generation, deduplicates retries, and never mutates formal shots", async () => {
    const db = await import("../db");
    const persistence = await import("./publishingVideoStoryboardPersistence");
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
    const duplicate = await persistence.generateAndPersistPublishingVideoPreview({
      storyId: id,
      userId: 31,
      operationToken: "preview-op-1",
      now: 201,
      generate,
    });
    expect(duplicate.status).toBe("pending");
    expect(generate).toHaveBeenCalledTimes(1);

    release();
    const completed = await first;
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

  it("recovers a completed receipt after process restart", async () => {
    let db = await import("../db");
    let persistence = await import("./publishingVideoStoryboardPersistence");
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
    expect((await db.getStoryById(id, 32))?.body).toMatchObject({ _revision: 2 });
  });

  it("keeps a later successful preview current after an earlier generation failure", async () => {
    const db = await import("../db");
    const persistence = await import("./publishingVideoStoryboardPersistence");
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

    const completed = await persistence.generateAndPersistPublishingVideoPreview({
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
  beforeEach(async () => {
    vi.resetModules();
    tempDir = await mkdtemp(path.join(os.tmpdir(), "dt-video-confirm-"));
    process.env.DATABASE_URL = "";
    process.env.LOCAL_PERSIST_PATH = path.join(tempDir, "local-persist.json");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    delete process.env.LOCAL_PERSIST_PATH;
    delete process.env.DATABASE_URL;
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  });

  async function createConfirmFixture(options?: {
    editedLegacyOpening?: boolean;
    withCover?: boolean;
  }) {
    const db = await import("../db");
    const persistence = await import("./publishingVideoStoryboardPersistence");
    const publishing = publishingState();
    const cover = options?.withCover === false
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
    const generated = await persistence.generateAndPersistPublishingVideoPreview({
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
      previewId: generated.preview!.previewId,
    };
  }

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
    expect(result.shots.filter(shot => shot.stableShotId === "manual-shot-keep"))
      .toHaveLength(1);
    expect(result.shots.filter(shot => shot.stableShotId === "publishing-cover-opening"))
      .toHaveLength(0);
    const formal = result.shots.filter(
      shot => shot.publishingVideo && typeof shot.publishingVideo === "object"
    );
    expect(formal).toHaveLength(4);
    expect(formal.every(shot =>
      typeof shot.scriptText === "string" &&
      typeof shot.promptDraft === "string" &&
      typeof shot.videoPrompt === "string" &&
      Array.isArray(shot.publishingVideo?.sourceParagraphIds)
    )).toBe(true);
    expect(result.publishing.activeVideoStoryboardVersionId).toBe(fixture.versionId);
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
    expect(body.shots.every((shot: Record<string, any>) =>
      shot.publishingVideo?.coverAssetId == null
    )).toBe(true);
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
    const first = await fixture.persistence.confirmPublishingVideoStoryboard(input);
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

  it("does not silently remove a materially edited legacy cover placeholder", async () => {
    const fixture = await createConfirmFixture({ editedLegacyOpening: true });
    await expect(
      fixture.persistence.confirmPublishingVideoStoryboard({
        storyId: fixture.id,
        userId: 41,
        versionId: fixture.versionId,
        previewId: fixture.previewId,
        operationToken: "confirm-edited-legacy",
      })
    ).rejects.toThrow("旧封面镜头已经被编辑");
    const saved = await fixture.db.getStoryById(fixture.id, 41);
    expect((saved?.body as Record<string, any>).shots).toHaveLength(2);
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
    const db = await import("../db");
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
