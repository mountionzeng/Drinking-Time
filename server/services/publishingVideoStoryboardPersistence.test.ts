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

  it("deduplicates identical in-flight previews even when callers use different operation tokens", async () => {
    const db = await import("../db");
    const persistence = await import("./publishingVideoStoryboardPersistence");
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
    release();
    await first;
    expect(firstGenerate).toHaveBeenCalledTimes(1);
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
    expect((await db.getStoryById(id, 32))?.body).toMatchObject({
      _revision: 2,
    });
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
