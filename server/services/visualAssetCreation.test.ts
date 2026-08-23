import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { isVisualAssetVersionLockable } from "../../shared/visualAssets";
import { prepareStoryBody } from "./storySync";

const previousDatabaseUrl = process.env.DATABASE_URL;
const previousLocalPersistPath = process.env.LOCAL_PERSIST_PATH;
const tempDir = await mkdtemp(path.join(os.tmpdir(), "dt-visual-creation-"));
process.env.DATABASE_URL = "";
process.env.LOCAL_PERSIST_PATH = path.join(tempDir, "local-persist.json");

const db = await import("../db");
const persistence = await import("./visualAssetPersistence");
const creation = await import("./visualAssetCreation");

async function seedDraft(kind: "character" | "scene" | "style" = "character") {
  const referenceBytes = await sharp({
    create: {
      width: 1024,
      height: 1024,
      channels: 3,
      background: { r: 210, g: 180, b: 160 },
    },
  })
    .png()
    .toBuffer();
  const story = await db.createStory({
    userId: 71,
    title: "标准视图",
    body: { _revision: 1, shots: [] },
  });
  const image = await db.createGeneratedImage({
    projectId: null,
    storyId: story.id,
    userId: 71,
    shotNo: null,
    shotIdentity: null,
    imageUrl: `data:image/png;base64,${referenceBytes.toString("base64")}`,
    imageKey: null,
    prompt: "人物参考",
    generationType: "initial",
    isCurrent: false,
  });
  const created = await persistence.createVisualAssetDraft({
    storyId: story.id,
    userId: 71,
    expectedRevision: 1,
    operationToken: `create-${kind}`,
    kind,
    name: kind === "character" ? "红外套人物" : "测试资产",
    referenceImageIds: [image.id],
    now: 10,
  });
  const asset = created.aggregate.assets[0]!;
  return { story, image, created, asset, version: asset.versions[0]! };
}

// 本文件每个用例都要跑 sharp：参考板合成、1024px 模板渲染、标准板切片。
// 默认 5 秒超时在机器有负载时会假失败，与被测逻辑无关。
vi.setConfig({ testTimeout: 30_000 });

describe("visual asset creation", () => {
  beforeEach(() => {
    db.resetMemoryStateForTesting();
  });

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

  it("extracts only the selected asset type and persists explicit conflicts", async () => {
    const { story, asset, version } = await seedDraft("character");
    const vision = vi.fn(async () => ({
      modelLabel: "vision-test",
      text: JSON.stringify({
        fixedFacts: {
          face: "圆脸，左眼下小痣",
          hair: "齐耳黑色短发",
          outfit: "红色长外套和黑色长裤",
          accessories: ["银色细项链"],
        },
        allowedVariations: ["景别", "动作", "表情", "光线"],
        conflicts: [
          {
            field: "outfit",
            descriptions: ["红色外套", "酒红色外套"],
            sourceImageIds: [1, 2],
          },
        ],
      }),
    }));

    const result = await creation.analyzeVisualAssetVersion({
      storyId: story.id,
      userId: 71,
      expectedRevision: 2,
      operationToken: "analyze-character",
      assetId: asset.id,
      versionId: version.id,
      dependencies: {
        vision: vision as never,
        materialize: async value => value,
        now: () => 20,
      },
    });

    const analyzed = result.aggregate.assets[0]!.versions[0]!;
    expect(analyzed.fixedFacts).toMatchObject({
      kind: "character",
      hair: "齐耳黑色短发",
      outfit: "红色长外套和黑色长裤",
    });
    expect(analyzed.conflicts).toHaveLength(1);
    expect(analyzed.status).toBe("review");
    expect(vision.mock.calls[0]?.[0].system).toContain("只分析人物固定造型");
    expect(vision.mock.calls[0]?.[0].system).toContain(
      "动作、表情、视线和光线变化属于允许变化，不得列为冲突"
    );
    expect(vision.mock.calls[0]?.[0]).toMatchObject({
      attemptTimeoutMs: 70_000,
      timeoutMs: 145_000,
      maxTokens: 2000,
    });
    const visionInput = vision.mock.calls[0]?.[0];
    expect(visionInput.imageUrls).toHaveLength(1);
    expect(visionInput.imageUrls[0]).toMatch(/^data:image\/jpeg;base64,/);
    expect(visionInput.userText).toContain("第 1 格=图片 ID");
    const board = Buffer.from(visionInput.imageUrls[0]!.split(",")[1]!, "base64");
    await expect(sharp(board).metadata()).resolves.toMatchObject({
      width: 512,
      height: 512,
    });
  });

  it("persists completed analysis after an unrelated whole-Story save advances the revision", async () => {
    const { story, asset, version } = await seedDraft("character");

    const result = await creation.analyzeVisualAssetVersion({
      storyId: story.id,
      userId: 71,
      expectedRevision: 2,
      operationToken: "analyze-after-autosave",
      assetId: asset.id,
      versionId: version.id,
      dependencies: {
        vision: async () => {
          const latest = await db.getStoryById(story.id, 71);
          const nextBody = prepareStoryBody(
            { shots: [], editorMarker: "saved during vision analysis" },
            3,
            latest!.body
          );
          expect(
            await db.updateStoryBodyIfRevision({
              id: story.id,
              userId: 71,
              expectedRevision: 2,
              body: nextBody,
            })
          ).toBe(true);
          return {
            modelLabel: "vision-test",
            text: JSON.stringify({
              fixedFacts: {
                face: "圆脸",
                hair: "齐耳黑色短发",
                outfit: "红色长外套",
                accessories: [],
              },
              allowedVariations: ["景别", "光线"],
              conflicts: [],
            }),
          };
        },
        materialize: async value => value,
        now: () => 30,
      },
    });

    expect(result.revision).toBe(4);
    expect(result.aggregate.assets[0]!.versions[0]!.status).toBe("review");
    const latest = await db.getStoryById(story.id, 71);
    expect((latest!.body as Record<string, unknown>).editorMarker).toBe(
      "saved during vision analysis"
    );
  });

  it("blocks canonical-board purchase while reference conflicts remain unresolved", async () => {
    const { story, asset, version } = await seedDraft("character");
    await creation.analyzeVisualAssetVersion({
      storyId: story.id,
      userId: 71,
      expectedRevision: 2,
      operationToken: "analyze-conflict",
      assetId: asset.id,
      versionId: version.id,
      dependencies: {
        vision: async () => ({
          modelLabel: "vision-test",
          text: JSON.stringify({
            fixedFacts: {
              face: "圆脸",
              hair: "短发",
              outfit: "红外套",
              accessories: [],
            },
            conflicts: [
              {
                field: "hair",
                descriptions: ["短发", "长发"],
                sourceImageIds: [1, 2],
              },
            ],
          }),
        }),
        materialize: async value => value,
      },
    });

    await expect(
      creation.quoteVisualAssetCanonicalBoard({
        storyId: story.id,
        userId: 71,
        assetId: asset.id,
        versionId: version.id,
        dependencies: { materialize: async value => value },
      })
    ).rejects.toMatchObject({ name: "VisualAssetValidationError" });
  });

  it("quotes once, creates one coherent board, splits four views, and recovers by receipt", async () => {
    const { story, asset, version } = await seedDraft("character");
    const analyzed = await creation.analyzeVisualAssetVersion({
      storyId: story.id,
      userId: 71,
      expectedRevision: 2,
      operationToken: "analyze-clean",
      assetId: asset.id,
      versionId: version.id,
      dependencies: {
        vision: async () => ({
          modelLabel: "vision-test",
          text: JSON.stringify({
            fixedFacts: {
              face: "圆脸，左眼下小痣",
              hair: "齐耳黑色短发",
              outfit: "红色长外套和黑色长裤",
              accessories: ["银色细项链"],
            },
            allowedVariations: ["景别", "动作", "表情", "光线"],
            conflicts: [],
          }),
        }),
        materialize: async value => value,
        now: () => 20,
      },
    });
    expect(analyzed.revision).toBe(3);

    const boardBytes = await sharp({
      create: { width: 1024, height: 1024, channels: 3, background: "#b04a45" },
    })
      .png()
      .toBuffer();
    const boardDataUrl = `data:image/png;base64,${boardBytes.toString("base64")}`;
    let storedIndex = 0;
    const edit = vi.fn(async (_imageUrl: string, _prompt: string, options: any) => {
      await options.onProviderTaskAccepted?.("provider-task-1");
      return {
        status: "ok" as const,
        imageUrl: boardDataUrl,
        imageKey: "board.png",
        providerTaskId: "provider-task-1",
      };
    });
    const inspectStructure = vi.fn(async () => ({
      verdict: "pass" as const,
      modelLabel: "structure-test",
      reason: "三栏各一个完整全身人物，依次为正面、侧面、背面",
      checks: [],
      confidence: 0.97,
    }));
    const sharedDependencies = {
      materialize: async (value: string) => value,
      edit: edit as never,
      inspectStructure: inspectStructure as never,
      storeBytes: async (bytes: ArrayBuffer | Uint8Array) => ({
        status: "ok" as const,
        imageUrl: `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`,
        imageKey: `view-${storedIndex++}.png`,
      }),
      now: () => 30 + storedIndex,
    };
    const quote = await creation.quoteVisualAssetCanonicalBoard({
      storyId: story.id,
      userId: 71,
      assetId: asset.id,
      versionId: version.id,
      dependencies: sharedDependencies,
    });
    const generated = await creation.generateVisualAssetCanonicalBoard({
      storyId: story.id,
      userId: 71,
      assetId: asset.id,
      versionId: version.id,
      operationToken: "generate-board-1",
      confirmation: quote,
      dependencies: sharedDependencies,
    });

    expect(generated).toMatchObject({ status: "ok", viewImageIds: expect.any(Array) });
    if (generated.status !== "ok") throw new Error("generation failed");
    // 人物 = 4 次付费生成：正面/侧面/背面全身 + 正面头部特写。
    // 头部特写必须真生成——从全身图裁出来的脸只有几十像素，锁不住五官。
    expect(generated.viewImageIds).toHaveLength(4);
    expect(edit).toHaveBeenCalledTimes(4);
    expect(quote.candidateCount).toBe(4);
    const viewPrompts = edit.mock.calls.map(call => call[1] as string);
    expect(viewPrompts[0]).toContain("严格正面全身");
    expect(viewPrompts[1]).toContain("严格 90° 正侧面全身");
    expect(viewPrompts[2]).toContain("严格背面全身");
    expect(viewPrompts[3]).toContain("正面头部特写");
    // 每次只画一个视角：绝不能再要求模型自己排出多格标准板。
    for (const prompt of viewPrompts) {
      expect(prompt).toContain("本次只画这一个视角");
      expect(prompt).toContain("禁止自行拼成多格、三视图、对比图或分镜");
      // 参考图是半身肖像，edit 模式会连取景一起带过来。
      // 只写「全身」不够，必须把镜头距离、上下留白和禁止截断点都写死。
      expect(prompt).toContain("从头顶到鞋底必须完整出现在画面里");
      expect(prompt).toContain("不能在膝盖、大腿或腰部截断");
      expect(prompt).toContain("中性浅灰色影棚背景");
      expect(prompt).toContain("禁止坐姿");
    }
    // 背面视图最容易被模型画成回头看镜头，必须逐条堵死。
    expect(viewPrompts[2]).toContain("看不到脸、看不到任何五官");
    expect(viewPrompts[2]).toContain("禁止回头、禁止侧脸、禁止露出半张脸");
    const replay = await creation.generateVisualAssetCanonicalBoard({
      storyId: story.id,
      userId: 71,
      assetId: asset.id,
      versionId: version.id,
      operationToken: "generate-board-1",
      confirmation: quote,
      dependencies: sharedDependencies,
    });
    expect(replay).toMatchObject({ status: "ok", viewImageIds: generated.viewImageIds });
    expect(edit).toHaveBeenCalledTimes(4);

    const latest = await persistence.getStoryVisualAssets({ storyId: story.id, userId: 71 });
    const latestVersion = latest.aggregate.assets[0]!.versions[0]!;
    expect(latestVersion.views.map(view => view.role)).toEqual([
      "front",
      "profile",
      "back",
      "identity-detail",
    ]);
    expect(latestVersion.views.every(view => view.status === "pass")).toBe(true);
    expect(inspectStructure).toHaveBeenCalledTimes(1);
    expect(inspectStructure.mock.calls[0]?.[0]).toMatchObject({ kind: "character" });
    expect(latestVersion.status).toBe("review");
  });

  it("uses a real reference photo as the edit base and never a neutral placeholder", async () => {
    const { story, image, asset, version } = await seedDraft("character");
    await creation.analyzeVisualAssetVersion({
      storyId: story.id,
      userId: 71,
      expectedRevision: 2,
      operationToken: "analyze-layout",
      assetId: asset.id,
      versionId: version.id,
      dependencies: {
        vision: async () => ({
          modelLabel: "vision-test",
          text: JSON.stringify({
            fixedFacts: {
              face: "椭圆脸，高颧骨",
              hair: "黑色齐耳短发",
              outfit: "白色无袖长裙",
              accessories: [],
            },
            allowedVariations: ["景别", "光线"],
            conflicts: [],
          }),
        }),
        materialize: async value => value,
        now: () => 20,
      },
    });

    const boardBytes = await sharp({
      create: { width: 1024, height: 1024, channels: 3, background: "#b04a45" },
    })
      .png()
      .toBuffer();
    const edit = vi.fn(async (_imageUrl: string, _prompt: string, options: any) => {
      await options.onProviderTaskAccepted?.("provider-task-layout");
      return {
        status: "ok" as const,
        imageUrl: `data:image/png;base64,${boardBytes.toString("base64")}`,
        imageKey: "board.png",
        providerTaskId: "provider-task-layout",
      };
    });
    let storedIndex = 0;
    const dependencies = {
      materialize: async (value: string) => value,
      edit: edit as never,
      inspectStructure: (async () => ({
        verdict: "pass" as const,
        modelLabel: "structure-test",
        reason: "三栏各一个完整全身人物",
        checks: [],
        confidence: 0.95,
      })) as never,
      storeBytes: async (bytes: ArrayBuffer | Uint8Array) => ({
        status: "ok" as const,
        imageUrl: `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`,
        imageKey: `view-${storedIndex++}.png`,
      }),
      now: () => 40 + storedIndex,
    };
    const quote = await creation.quoteVisualAssetCanonicalBoard({
      storyId: story.id,
      userId: 71,
      assetId: asset.id,
      versionId: version.id,
      dependencies,
    });
    const generated = await creation.generateVisualAssetCanonicalBoard({
      storyId: story.id,
      userId: 71,
      assetId: asset.id,
      versionId: version.id,
      operationToken: "generate-board-layout",
      confirmation: quote,
      dependencies,
    });
    expect(generated.status).toBe("ok");

    const referenceImage = await db.getGeneratedImageById(image.id);
    // 2026-08-21 第二次付费的教训：edit 模式下底图同时支配构图和画风，
    // 喂中性灰色占位模板会让模型把灰色剪影当成目标画风、丢光身份。
    // 底图必须是真实参考图，构图改由服务端合板保证。
    for (const call of edit.mock.calls) {
      // 必须走 editImage（首参就是底图）。generateImage 只要带 referenceImageUrl
      // 就会在入口被 flux-kontext-pro 截走，而 Kontext 是保留式局部编辑模型，
      // 不肯改取景、朝向和背景——2026-08-21 四次付费都卡在这上面。
      expect(call[0]).toBe(referenceImage!.imageUrl);
      expect(call[2].referenceImageUrl).toBe(referenceImage!.imageUrl);
      // 必须显式要求重构式编辑：只有一张参考图时，editImage 默认会掉回 Kontext。
      expect(call[2].preferStructuralEdit).toBe(true);
    }

    const prompt = edit.mock.calls[0]?.[1] as string;
    expect(prompt).toContain("图 1 是人物身份参考");
    expect(prompt).toContain("禁止沿用它的构图、机位、景别、姿势和背景");
    expect(prompt).not.toContain("占位模板");

    // 标准板不再由模型排版，而是服务端把三张单视角横向合成的。
    const latest = await persistence.getStoryVisualAssets({ storyId: story.id, userId: 71 });
    const boardImageId = latest.aggregate.assets[0]!.versions[0]!.boardImageId!;
    const board = await db.getGeneratedImageById(boardImageId);
    const boardMeta = await sharp(
      Buffer.from(board!.imageUrl.split(",")[1]!, "base64")
    ).metadata();
    expect(boardMeta.width).toBe(boardMeta.height! * 4);
  });

  it("does not re-buy views that were already paid for when a later view fails", async () => {
    const { story, asset, version } = await seedDraft("character");
    await creation.analyzeVisualAssetVersion({
      storyId: story.id,
      userId: 71,
      expectedRevision: 2,
      operationToken: "analyze-partial",
      assetId: asset.id,
      versionId: version.id,
      dependencies: {
        vision: async () => ({
          modelLabel: "vision-test",
          text: JSON.stringify({
            fixedFacts: {
              face: "椭圆脸",
              hair: "黑色短发",
              outfit: "白色长裙",
              accessories: [],
            },
            allowedVariations: ["光线"],
            conflicts: [],
          }),
        }),
        materialize: async value => value,
        now: () => 20,
      },
    });

    const viewBytes = await sharp({
      create: { width: 512, height: 512, channels: 3, background: "#7a5c48" },
    })
      .png()
      .toBuffer();
    const viewDataUrl = `data:image/png;base64,${viewBytes.toString("base64")}`;
    let failBackView = true;
    const edit = vi.fn(async (_imageUrl: string, prompt: string) => {
      if (failBackView && prompt.includes("严格背面全身")) {
        // 明确失败、没有供应商任务号：不是「状态不明」，允许重试。
        return { status: "error" as const, message: "背面视角生成失败" };
      }
      return { status: "ok" as const, imageUrl: viewDataUrl, imageKey: "view.png" };
    });
    let storedIndex = 0;
    const dependencies = {
      materialize: async (value: string) => value,
      edit: edit as never,
      inspectStructure: (async () => ({
        verdict: "pass" as const,
        modelLabel: "structure-test",
        reason: "三栏各一个完整全身人物，依次为正面、侧面、背面",
        checks: [],
        confidence: 0.96,
      })) as never,
      storeBytes: async (bytes: ArrayBuffer | Uint8Array) => ({
        status: "ok" as const,
        imageUrl: `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`,
        imageKey: `stored-${storedIndex++}.png`,
      }),
      now: () => 60 + storedIndex,
    };
    const quote = await creation.quoteVisualAssetCanonicalBoard({
      storyId: story.id,
      userId: 71,
      assetId: asset.id,
      versionId: version.id,
      dependencies,
    });

    const firstAttempt = await creation.generateVisualAssetCanonicalBoard({
      storyId: story.id,
      userId: 71,
      assetId: asset.id,
      versionId: version.id,
      operationToken: "generate-partial",
      confirmation: quote,
      dependencies,
    });
    expect(firstAttempt.status).toBe("error");
    // 正面 + 侧面已经付过钱，背面失败，头部特写还没轮到。
    expect(edit).toHaveBeenCalledTimes(3);

    failBackView = false;
    edit.mockClear();
    const retry = await creation.generateVisualAssetCanonicalBoard({
      storyId: story.id,
      userId: 71,
      assetId: asset.id,
      versionId: version.id,
      operationToken: "generate-partial",
      confirmation: quote,
      dependencies,
    });

    expect(retry.status).toBe("ok");
    // 重试只补买没买到的视角（背面 + 还没轮到的头部特写），前两个复用已付费结果。
    expect(edit).toHaveBeenCalledTimes(2);
    expect(edit.mock.calls[0]?.[1]).toContain("严格背面全身");
    expect(edit.mock.calls[1]?.[1]).toContain("正面头部特写");
    if (retry.status !== "ok") throw new Error("retry failed");
    expect(retry.viewImageIds).toHaveLength(4);
  });

  it("never tells a scene asset to sit on a neutral studio background", async () => {
    const { story, asset, version } = await seedDraft("scene");
    await creation.analyzeVisualAssetVersion({
      storyId: story.id,
      userId: 71,
      expectedRevision: 2,
      operationToken: "analyze-scene-prompt",
      assetId: asset.id,
      versionId: version.id,
      dependencies: {
        vision: async () => ({
          modelLabel: "vision-test",
          text: JSON.stringify({
            fixedFacts: {
              geometry: ["狭长阁楼", "斜屋顶开天窗"],
              materials: ["原木地板", "白灰墙"],
              fixedProps: ["铁架床"],
            },
            allowedVariations: ["机位"],
            conflicts: [],
          }),
        }),
        materialize: async value => value,
        now: () => 20,
      },
    });

    const viewBytes = await sharp({
      create: { width: 512, height: 512, channels: 3, background: "#4a6b52" },
    })
      .png()
      .toBuffer();
    let storedIndex = 0;
    const edit = vi.fn(async () => ({
      status: "ok" as const,
      imageUrl: `data:image/png;base64,${viewBytes.toString("base64")}`,
      imageKey: "scene.png",
    }));
    const dependencies = {
      materialize: async (value: string) => value,
      edit: edit as never,
      inspectStructure: (async () => ({
        verdict: "pass" as const,
        modelLabel: "structure-test",
        reason: "四格同一空间",
        checks: [],
        confidence: 0.95,
      })) as never,
      storeBytes: async (bytes: ArrayBuffer | Uint8Array) => ({
        status: "ok" as const,
        imageUrl: `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`,
        imageKey: `scene-${storedIndex++}.png`,
      }),
      now: () => 160 + storedIndex,
    };
    const quote = await creation.quoteVisualAssetCanonicalBoard({
      storyId: story.id,
      userId: 71,
      assetId: asset.id,
      versionId: version.id,
      dependencies,
    });
    await creation.generateVisualAssetCanonicalBoard({
      storyId: story.id,
      userId: 71,
      assetId: asset.id,
      versionId: version.id,
      operationToken: "generate-scene-prompt",
      confirmation: quote,
      dependencies,
    });

    const prompts = edit.mock.calls.map(call => call[1] as string);
    expect(prompts).toHaveLength(4);
    for (const prompt of prompts) {
      // 场景本身就是背景：叫它抠成中性影棚会得到一个悬空物件。
      expect(prompt).not.toContain("纯净中性背景");
      expect(prompt).not.toContain("中性浅灰色影棚背景");
      expect(prompt).toContain("环境本身就是画面主体");
      // 2026-08-22 画廊首版：模型凭空加了黑色底座+白板，展台形状还逐格漂移。
      expect(prompt).toContain("不要自行发明新的固定结构");
      // 「宁可画成空房间」对杂陈空间是毒药，必须按固定事实的密度来画。
      expect(prompt).toContain("必须照着固定事实描述的密度和丰富度去画");
      expect(prompt).not.toContain("宁可画成空房间");
      expect(prompt).toContain("同一个形状、同一个尺寸");
      // 标准视图只锁空间，人物留给各镜头自己安排。
      expect(prompt).toContain("不要出现任何人物");
      // edit 底图是参考实景照，机位不写死就会原地不动。
      expect(prompt).toContain("相机必须真的移动到本视角要求的位置");
    }
    // reverse 是场景版的「背面」，最容易被画成主视角的另一张构图。
    expect(prompts[1]).toContain("必须画出主视角里位于镜头背后、看不到的那一面");
    expect(prompts[3]).toContain("视线与地面成 90°");
  });

  it("composes scene assets as a 2×2 board from four generated views", async () => {
    const { story, asset, version } = await seedDraft("scene");
    await creation.analyzeVisualAssetVersion({
      storyId: story.id,
      userId: 71,
      expectedRevision: 2,
      operationToken: "analyze-scene-board",
      assetId: asset.id,
      versionId: version.id,
      dependencies: {
        vision: async () => ({
          modelLabel: "vision-test",
          text: JSON.stringify({
            fixedFacts: {
              geometry: ["狭长阁楼", "斜屋顶开天窗"],
              materials: ["原木地板", "白灰墙"],
              fixedProps: ["铁架床"],
            },
            allowedVariations: ["机位"],
            conflicts: [],
          }),
        }),
        materialize: async value => value,
        now: () => 20,
      },
    });

    const viewBytes = await sharp({
      create: { width: 512, height: 512, channels: 3, background: "#4a6b52" },
    })
      .png()
      .toBuffer();
    let storedIndex = 0;
    const edit = vi.fn(async () => ({
      status: "ok" as const,
      imageUrl: `data:image/png;base64,${viewBytes.toString("base64")}`,
      imageKey: "scene-view.png",
    }));
    const dependencies = {
      materialize: async (value: string) => value,
      edit: edit as never,
      inspectStructure: (async () => ({
        verdict: "pass" as const,
        modelLabel: "structure-test",
        reason: "四格保持同一空间几何与固定陈设",
        checks: [],
        confidence: 0.95,
      })) as never,
      storeBytes: async (bytes: ArrayBuffer | Uint8Array) => ({
        status: "ok" as const,
        imageUrl: `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`,
        imageKey: `scene-${storedIndex++}.png`,
      }),
      now: () => 80 + storedIndex,
    };
    const quote = await creation.quoteVisualAssetCanonicalBoard({
      storyId: story.id,
      userId: 71,
      assetId: asset.id,
      versionId: version.id,
      dependencies,
    });
    expect(quote.candidateCount).toBe(4);

    const generated = await creation.generateVisualAssetCanonicalBoard({
      storyId: story.id,
      userId: 71,
      assetId: asset.id,
      versionId: version.id,
      operationToken: "generate-scene-board",
      confirmation: quote,
      dependencies,
    });
    expect(generated.status).toBe("ok");
    if (generated.status !== "ok") throw new Error("scene generation failed");
    // 场景四格都要真的生成，没有派生视图。
    expect(edit).toHaveBeenCalledTimes(4);
    expect(generated.viewImageIds).toHaveLength(4);

    const board = await db.getGeneratedImageById(generated.boardImageId);
    const meta = await sharp(
      Buffer.from(board!.imageUrl.split(",")[1]!, "base64")
    ).metadata();
    expect(meta.width).toBe(meta.height);
  });

  it("regenerates one view for one view's price and reuses the other paid views", async () => {
    const { story, asset, version } = await seedDraft("character");
    await creation.analyzeVisualAssetVersion({
      storyId: story.id,
      userId: 71,
      expectedRevision: 2,
      operationToken: "analyze-single-view",
      assetId: asset.id,
      versionId: version.id,
      dependencies: {
        vision: async () => ({
          modelLabel: "vision-test",
          text: JSON.stringify({
            fixedFacts: {
              face: "椭圆脸",
              hair: "黑色短发",
              outfit: "白色长裙",
              accessories: [],
            },
            allowedVariations: ["光线"],
            conflicts: [],
          }),
        }),
        materialize: async value => value,
        now: () => 20,
      },
    });

    const viewBytes = await sharp({
      create: { width: 512, height: 512, channels: 3, background: "#7a5c48" },
    })
      .png()
      .toBuffer();
    const edit = vi.fn(async () => ({
      status: "ok" as const,
      imageUrl: `data:image/png;base64,${viewBytes.toString("base64")}`,
      imageKey: "view.png",
    }));
    let storedIndex = 0;
    const dependencies = {
      materialize: async (value: string) => value,
      edit: edit as never,
      inspectStructure: (async () => ({
        verdict: "pass" as const,
        modelLabel: "structure-test",
        reason: "三栏各一个完整全身人物，依次为正面、侧面、背面",
        checks: [],
        confidence: 0.96,
      })) as never,
      storeBytes: async (bytes: ArrayBuffer | Uint8Array) => ({
        status: "ok" as const,
        imageUrl: `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`,
        imageKey: `stored-${storedIndex++}.png`,
      }),
      now: () => 100 + storedIndex,
    };

    const boardQuote = await creation.quoteVisualAssetCanonicalBoard({
      storyId: story.id,
      userId: 71,
      assetId: asset.id,
      versionId: version.id,
      dependencies,
    });
    const full = await creation.generateVisualAssetCanonicalBoard({
      storyId: story.id,
      userId: 71,
      assetId: asset.id,
      versionId: version.id,
      operationToken: "generate-before-single",
      confirmation: boardQuote,
      dependencies,
    });
    expect(full.status).toBe("ok");
    if (full.status !== "ok") throw new Error("full generation failed");
    expect(edit).toHaveBeenCalledTimes(4);

    const viewQuote = await creation.quoteVisualAssetView({
      storyId: story.id,
      userId: 71,
      assetId: asset.id,
      versionId: version.id,
      role: "back",
      dependencies,
    });
    // 单视角迭代只花一次的钱，不是整组的价。
    expect(viewQuote.candidateCount).toBe(1);
    expect(viewQuote.estimatedCny * 4).toBeCloseTo(boardQuote.estimatedCny, 5);
    // 定向修改意见进 prompt，也必须进报价签名——否则「不带意见」的确认能拿去买带意见的图。
    const withInstruction = await creation.quoteVisualAssetView({
      storyId: story.id,
      userId: 71,
      assetId: asset.id,
      versionId: version.id,
      role: "back",
      instruction: "双手自然垂在身侧",
      dependencies,
    });
    expect(withInstruction.inputHash).not.toBe(viewQuote.inputHash);

    edit.mockClear();
    const regenerated = await creation.regenerateVisualAssetView({
      storyId: story.id,
      userId: 71,
      assetId: asset.id,
      versionId: version.id,
      role: "back",
      operationToken: "regenerate-back-1",
      confirmation: viewQuote,
      dependencies,
    });

    expect(regenerated.status).toBe("ok");
    if (regenerated.status !== "ok") throw new Error("single view regeneration failed");
    // 只买了背面这一张，其余两张沿用已付费结果。
    expect(edit).toHaveBeenCalledTimes(1);
    expect(edit.mock.calls[0]?.[1]).toContain("严格背面全身");
    expect(regenerated.viewImageIds).toHaveLength(4);

    // 带意见重生成：意见要落进 prompt，且排在固定事实之后。
    edit.mockClear();
    const instructedQuote = await creation.quoteVisualAssetView({
      storyId: story.id,
      userId: 71,
      assetId: asset.id,
      versionId: version.id,
      role: "back",
      instruction: "双手自然垂在身侧",
      dependencies,
    });
    await creation.regenerateVisualAssetView({
      storyId: story.id,
      userId: 71,
      assetId: asset.id,
      versionId: version.id,
      role: "back",
      operationToken: "regenerate-back-instructed",
      confirmation: instructedQuote,
      instruction: "双手自然垂在身侧",
      dependencies,
    });
    expect(edit.mock.calls[0]?.[1]).toContain(
      "本次额外要求（不得违反上面的固定事实）：双手自然垂在身侧"
    );
    // 合板要用新的背面图，所以标准板本身是新的一张。
    expect(regenerated.boardImageId).not.toBe(full.boardImageId);
  });

  it("reuses the paid image when a single-view retry uses the same token", async () => {
    const { story, asset, version } = await seedDraft("character");
    await creation.analyzeVisualAssetVersion({
      storyId: story.id,
      userId: 71,
      expectedRevision: 2,
      operationToken: "analyze-retry-reuse",
      assetId: asset.id,
      versionId: version.id,
      dependencies: {
        vision: async () => ({
          modelLabel: "vision-test",
          text: JSON.stringify({
            fixedFacts: {
              face: "椭圆脸",
              hair: "黑色短发",
              outfit: "白色长裙",
              accessories: [],
            },
            allowedVariations: ["光线"],
            conflicts: [],
          }),
        }),
        materialize: async value => value,
        now: () => 20,
      },
    });

    const viewBytes = await sharp({
      create: { width: 512, height: 512, channels: 3, background: "#55606b" },
    })
      .png()
      .toBuffer();
    const edit = vi.fn(async () => ({
      status: "ok" as const,
      imageUrl: `data:image/png;base64,${viewBytes.toString("base64")}`,
      imageKey: "view.png",
    }));
    let storedIndex = 0;
    let failFinalize = true;
    const dependencies = {
      materialize: async (value: string) => value,
      edit: edit as never,
      // 第一次在合板之后、落库之前炸掉：钱已经花了，结果还没存进版本。
      inspectStructure: (async () => {
        if (failFinalize) throw new Error("质检链路中断");
        return {
          verdict: "pass" as const,
          modelLabel: "structure-test",
          reason: "三栏各一个完整全身人物，依次为正面、侧面、背面",
          checks: [],
          confidence: 0.96,
        };
      }) as never,
      storeBytes: async (bytes: ArrayBuffer | Uint8Array) => ({
        status: "ok" as const,
        imageUrl: `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`,
        imageKey: `stored-${storedIndex++}.png`,
      }),
      now: () => 140 + storedIndex,
    };

    const boardQuote = await creation.quoteVisualAssetCanonicalBoard({
      storyId: story.id,
      userId: 71,
      assetId: asset.id,
      versionId: version.id,
      dependencies,
    });
    failFinalize = false;
    await creation.generateVisualAssetCanonicalBoard({
      storyId: story.id,
      userId: 71,
      assetId: asset.id,
      versionId: version.id,
      operationToken: "generate-before-retry",
      confirmation: boardQuote,
      dependencies,
    });

    const viewQuote = await creation.quoteVisualAssetView({
      storyId: story.id,
      userId: 71,
      assetId: asset.id,
      versionId: version.id,
      role: "profile",
      dependencies,
    });

    failFinalize = true;
    edit.mockClear();
    const crashed = await creation.regenerateVisualAssetView({
      storyId: story.id,
      userId: 71,
      assetId: asset.id,
      versionId: version.id,
      role: "profile",
      operationToken: "regenerate-profile-retry",
      confirmation: viewQuote,
      dependencies,
    });
    expect(crashed.status).toBe("error");
    expect(edit).toHaveBeenCalledTimes(1);

    // 同一个 token 重试：图已经买到手了，绝不能再买一遍。
    failFinalize = false;
    edit.mockClear();
    const retried = await creation.regenerateVisualAssetView({
      storyId: story.id,
      userId: 71,
      assetId: asset.id,
      versionId: version.id,
      role: "profile",
      operationToken: "regenerate-profile-retry",
      confirmation: viewQuote,
      dependencies,
    });
    expect(retried.status).toBe("ok");
    expect(edit).not.toHaveBeenCalled();
  });

  it("refuses a view quote that was signed for a different role", async () => {
    const { story, asset, version } = await seedDraft("character");
    await creation.analyzeVisualAssetVersion({
      storyId: story.id,
      userId: 71,
      expectedRevision: 2,
      operationToken: "analyze-role-swap",
      assetId: asset.id,
      versionId: version.id,
      dependencies: {
        vision: async () => ({
          modelLabel: "vision-test",
          text: JSON.stringify({
            fixedFacts: {
              face: "椭圆脸",
              hair: "黑色短发",
              outfit: "白色长裙",
              accessories: [],
            },
            allowedVariations: ["光线"],
            conflicts: [],
          }),
        }),
        materialize: async value => value,
        now: () => 20,
      },
    });
    const edit = vi.fn(async () => ({
      status: "ok" as const,
      imageUrl: "data:image/png;base64,AAAA",
    }));
    const dependencies = {
      materialize: async (value: string) => value,
      edit: edit as never,
      now: () => 120,
    };
    const backQuote = await creation.quoteVisualAssetView({
      storyId: story.id,
      userId: 71,
      assetId: asset.id,
      versionId: version.id,
      role: "back",
      dependencies,
    });
    // 拿「背面」的确认去买「正面」必须被拒，否则报价签名形同虚设。
    const swapped = await creation.regenerateVisualAssetView({
      storyId: story.id,
      userId: 71,
      assetId: asset.id,
      versionId: version.id,
      role: "front",
      operationToken: "regenerate-role-swap",
      confirmation: backQuote,
      dependencies,
    });
    expect(swapped.status).toBe("confirmation_required");
    expect(edit).not.toHaveBeenCalled();
  });

  it("tells the scene analyst that people and framing are not scene facts", async () => {
    const { story, asset, version } = await seedDraft("scene");
    const vision = vi.fn(async () => ({
      modelLabel: "vision-test",
      text: JSON.stringify({
        fixedFacts: { geometry: ["阁楼"], materials: ["原木"], fixedProps: [] },
        allowedVariations: [],
        conflicts: [],
      }),
    }));
    await creation.analyzeVisualAssetVersion({
      storyId: story.id,
      userId: 71,
      expectedRevision: 2,
      operationToken: "analyze-scene-prompt",
      assetId: asset.id,
      versionId: version.id,
      dependencies: { vision: vision as never, materialize: async v => v, now: () => 20 },
    });
    const system = vision.mock.calls[0]?.[0].system as string;
    // 实测模型会把「短发女性，着露背长裙」写进场景 fixedProps，必须点名堵掉。
    expect(system).toContain("绝不属于场景固定事实");
    expect(system).toContain("fixedProps 只写这个空间里长期固定存在的物件");
    // 同一空间不同机位下同一件东西的位置会变，那不是冲突。
    expect(system).toContain("位置差异不是冲突");
  });

  it("refuses to pass views when the paid board is not a real three-view board", async () => {
    const { story, asset, version } = await seedDraft("character");
    await creation.analyzeVisualAssetVersion({
      storyId: story.id,
      userId: 71,
      expectedRevision: 2,
      operationToken: "analyze-single-portrait",
      assetId: asset.id,
      versionId: version.id,
      dependencies: {
        vision: async () => ({
          modelLabel: "vision-test",
          text: JSON.stringify({
            fixedFacts: {
              face: "椭圆脸",
              hair: "黑色齐耳短发",
              outfit: "白色长裙",
              accessories: [],
            },
            allowedVariations: ["光线"],
            conflicts: [],
          }),
        }),
        materialize: async value => value,
        now: () => 20,
      },
    });

    // 只有一个四分之三侧身人物的成品：机械切片后左右两栏几乎是空背景。
    const boardBytes = await sharp({
      create: { width: 1024, height: 1024, channels: 3, background: "#f2efe9" },
    })
      .composite([
        {
          input: await sharp({
            create: { width: 300, height: 620, channels: 3, background: "#7a5c48" },
          })
            .png()
            .toBuffer(),
          left: 362,
          top: 220,
        },
      ])
      .png()
      .toBuffer();
    let storedIndex = 0;
    const dependencies = {
      materialize: async (value: string) => value,
      edit: (async (_imageUrl: string, _prompt: string, options: any) => {
        await options.onProviderTaskAccepted?.("provider-task-bad");
        return {
          status: "ok" as const,
          imageUrl: `data:image/png;base64,${boardBytes.toString("base64")}`,
          imageKey: "bad-board.png",
          providerTaskId: "provider-task-bad",
        };
      }) as never,
      inspectStructure: (async () => ({
        verdict: "fail" as const,
        modelLabel: "structure-test",
        reason: "不是三视图：只有一个四分之三侧身人物，左右栏是空背景",
        checks: [],
        confidence: 0.93,
      })) as never,
      storeBytes: async (bytes: ArrayBuffer | Uint8Array) => ({
        status: "ok" as const,
        imageUrl: `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`,
        imageKey: `bad-view-${storedIndex++}.png`,
      }),
      now: () => 60 + storedIndex,
    };
    const quote = await creation.quoteVisualAssetCanonicalBoard({
      storyId: story.id,
      userId: 71,
      assetId: asset.id,
      versionId: version.id,
      dependencies,
    });
    const generated = await creation.generateVisualAssetCanonicalBoard({
      storyId: story.id,
      userId: 71,
      assetId: asset.id,
      versionId: version.id,
      operationToken: "generate-board-bad",
      confirmation: quote,
      dependencies,
    });

    // 付费结果仍然要入库给用户看，但绝不能被当成合格。
    expect(generated).toMatchObject({
      status: "ok",
      structure: { verdict: "fail" },
    });
    const latest = await persistence.getStoryVisualAssets({ storyId: story.id, userId: 71 });
    const latestVersion = latest.aggregate.assets[0]!.versions[0]!;
    expect(latestVersion.views).toHaveLength(4);
    expect(latestVersion.views.every(view => view.status === "fail")).toBe(true);
    expect(latestVersion.views[0]!.failureReason).toContain("不是三视图");
    expect(latestVersion.status).toBe("review");
    expect(
      isVisualAssetVersionLockable(asset.kind, latestVersion)
    ).toBe(false);
  });

  it("marks views unknown when the structure check cannot decide", async () => {
    const { story, asset, version } = await seedDraft("character");
    await creation.analyzeVisualAssetVersion({
      storyId: story.id,
      userId: 71,
      expectedRevision: 2,
      operationToken: "analyze-unknown",
      assetId: asset.id,
      versionId: version.id,
      dependencies: {
        vision: async () => ({
          modelLabel: "vision-test",
          text: JSON.stringify({
            fixedFacts: {
              face: "椭圆脸",
              hair: "短发",
              outfit: "长裙",
              accessories: [],
            },
            allowedVariations: [],
            conflicts: [],
          }),
        }),
        materialize: async value => value,
        now: () => 20,
      },
    });
    const boardBytes = await sharp({
      create: { width: 1024, height: 1024, channels: 3, background: "#cccccc" },
    })
      .png()
      .toBuffer();
    let storedIndex = 0;
    const dependencies = {
      materialize: async (value: string) => value,
      edit: (async (_imageUrl: string, _prompt: string, options: any) => {
        await options.onProviderTaskAccepted?.("provider-task-unknown");
        return {
          status: "ok" as const,
          imageUrl: `data:image/png;base64,${boardBytes.toString("base64")}`,
          imageKey: "unknown-board.png",
          providerTaskId: "provider-task-unknown",
        };
      }) as never,
      // 真实链路里视觉网关超时就是走到这里：绝不能退化成 pass。
      inspectStructure: (async () => ({
        verdict: "unknown" as const,
        modelLabel: "vision-error",
        reason: "标准板结构质检失败，无法确认版式：timeout",
        checks: [],
        confidence: 0,
      })) as never,
      storeBytes: async (bytes: ArrayBuffer | Uint8Array) => ({
        status: "ok" as const,
        imageUrl: `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`,
        imageKey: `unknown-view-${storedIndex++}.png`,
      }),
      now: () => 80 + storedIndex,
    };
    const quote = await creation.quoteVisualAssetCanonicalBoard({
      storyId: story.id,
      userId: 71,
      assetId: asset.id,
      versionId: version.id,
      dependencies,
    });
    await creation.generateVisualAssetCanonicalBoard({
      storyId: story.id,
      userId: 71,
      assetId: asset.id,
      versionId: version.id,
      operationToken: "generate-board-unknown",
      confirmation: quote,
      dependencies,
    });

    const latest = await persistence.getStoryVisualAssets({ storyId: story.id, userId: 71 });
    const latestVersion = latest.aggregate.assets[0]!.versions[0]!;
    expect(latestVersion.views.every(view => view.status === "unknown")).toBe(true);
    expect(isVisualAssetVersionLockable(asset.kind, latestVersion)).toBe(false);
  });
});
