import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import type { TrpcContext } from "./_core/context";

const storyAgentMocks = vi.hoisted(() => ({
  replyFromStoryAgent: vi.fn(async () => ({
    reply: "我在，继续说。",
    card: {
      content: "一个关于夜晚和等待的故事种子",
      emotion: "quiet",
      title: "夜晚等待",
    },
    read: null,
    configured: true,
    modelLabel: "mock-model",
  })),
  synthesizeShotList: vi.fn(async () => ({
    characters: [{ name: "林", role: "主角", oneLiner: "在夜里等待的人" }],
    arc: "等待 -> 犹疑 -> 出发",
    logline: "一个人在夜里等到终于出发。",
    theme: "迟疑后的行动",
    variants: [],
    boringCheck: null,
    shots: [
      {
        shotNo: 1,
        beat: "开端",
        subject: "林",
        action: "站在路灯下",
        dialogue: "",
        shotType: "wide",
        cameraAngle: "eye-level",
        cameraMove: "static",
        location: "街角",
        timeLight: "night",
        mood: "quiet",
        sound: "wind",
        styleRef: "soft grain",
      },
    ],
  })),
  summarizeHistory: vi.fn(async () => "旧对话摘要"),
}));

vi.mock("./archive/storyAgent", () => storyAgentMocks);

const storageMocks = vi.hoisted(() => ({
  storagePut: vi.fn(async () => ({ key: "uploads/test.jpg", url: "https://storage.example/test.jpg" })),
}));

vi.mock("./storage", () => storageMocks);

const imageGenMocks = vi.hoisted(() => ({
  generateImage: vi.fn(async () => ({
    status: "ok" as const,
    imageUrl: "https://storage.example/generated/default.png",
    imageKey: "generated/default.png",
  })),
  editImage: vi.fn(async () => ({
    status: "ok" as const,
    imageUrl: "https://storage.example/generated/default-edit.png",
    imageKey: "generated/default-edit.png",
  })),
  inpaintImage: vi.fn(async () => ({
    status: "ok" as const,
    imageUrl: "https://storage.example/generated/default-inpaint.png",
    imageKey: "generated/default-inpaint.png",
  })),
}));

vi.mock("./services/imageGen", () => imageGenMocks);

type AppRouter = typeof import("./routers").appRouter;

let appRouter: AppRouter;

function createAuthContext(userId = 42): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `user-${userId}`,
      email: `user-${userId}@example.com`,
      name: `User ${userId}`,
      loginMethod: "manus",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

describe("storyAgent tRPC router", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = "";
    process.env.LOCAL_PERSIST_PATH = path.join(
      os.tmpdir(),
      `drinking-time-story-router-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}.json`,
    );
    ({ appRouter } = await import("./routers"));
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("wraps chat with the archive Story Agent response shape", async () => {
    const caller = appRouter.createCaller(createAuthContext());

    const result = await caller.storyAgent.chat({
      message: "今天晚上有点安静",
      history: [{ role: "user", content: "我想讲一个夜晚" }],
      existingCardCount: 1,
      projectId: 7,
    });

    expect(result).toMatchObject({
      reply: "我在，继续说。",
      configured: true,
      modelLabel: "mock-model",
      card: {
        content: "一个关于夜晚和等待的故事种子",
      },
    });
    expect(storyAgentMocks.replyFromStoryAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "今天晚上有点安静",
        existingCardCount: 1,
        projectId: 7,
      }),
    );
  });

  it("wraps classification and summary procedures", async () => {
    const caller = appRouter.createCaller(createAuthContext());

    const classified = await caller.storyAgent.classify({
      cards: [{ content: "路灯下等待", emotion: "quiet" }],
      characterHint: "林",
    });
    const summary = await caller.storyAgent.summarize({
      priorSummary: "此前在夜里",
      turnsToAbsorb: [{ role: "assistant", content: "你提到路灯。" }],
    });

    expect(classified).toMatchObject({
      logline: "一个人在夜里等到终于出发。",
      shots: [expect.objectContaining({ shotNo: 1, subject: "林" })],
    });
    expect(summary).toBe("旧对话摘要");
    expect(storyAgentMocks.synthesizeShotList).toHaveBeenCalledWith(
      expect.objectContaining({ characterHint: "林" }),
    );
    expect(storyAgentMocks.summarizeHistory).toHaveBeenCalledWith(
      expect.objectContaining({ priorSummary: "此前在夜里" }),
    );
  });

  it("falls back to inline data URL when photo storage upload fails", async () => {
    storageMocks.storagePut.mockRejectedValueOnce(new Error("storage down"));
    const caller = appRouter.createCaller(createAuthContext());

    const result = await caller.storyAgent.uploadPhoto({
      base64: "aGVsbG8=",
      mimeType: "image/jpeg",
    });

    expect(result).toEqual({
      status: "ok",
      url: "data:image/jpeg;base64,aGVsbG8=",
      fallback: "inline",
    });
  });

  it("uses inline data URL for chat image input even when storage upload succeeds", async () => {
    storageMocks.storagePut.mockResolvedValueOnce({
      key: "uploads/test.jpg",
      url: "https://storage.example/test.jpg",
    });
    const caller = appRouter.createCaller(createAuthContext());

    const result = await caller.storyAgent.uploadPhoto({
      base64: "aGVsbG8=",
      mimeType: "image/jpeg",
    });

    expect(result).toEqual({
      status: "ok",
      url: "data:image/jpeg;base64,aGVsbG8=",
      storedUrl: "https://storage.example/test.jpg",
    });
  });

  it("creates, lists, loads, updates, and deletes stories for the current user", async () => {
    const caller = appRouter.createCaller(createAuthContext(99));

    const created = await caller.storyAgent.storyUpsert({
      title: "夜行",
      logline: "一个人终于出门。",
      theme: "行动",
      arc: "等待 -> 出发",
      projectId: 12,
      body: {
        cards: [{ id: "card-1", content: "路灯" }],
        shots: [{ shotNo: 1, subject: "林" }],
      },
    });

    expect(created).toMatchObject({
      id: expect.any(Number),
      userId: 99,
      projectId: 12,
      title: "夜行",
      logline: "一个人终于出门。",
    });

    const listed = await caller.storyAgent.storyList();
    expect(listed.stories).toEqual([
      expect.objectContaining({
        id: created?.id,
        title: "夜行",
        cardCount: 1,
        shotCount: 1,
      }),
    ]);

    const loaded = await caller.storyAgent.storyGet({ id: created!.id });
    expect(loaded).toMatchObject({
      id: created?.id,
      title: "夜行",
    });

    const updated = await caller.storyAgent.storyUpsert({
      id: created!.id,
      title: "夜行修订",
      summary: "修订后的摘要",
      body: {
        cards: [],
        shots: [],
      },
    });
    expect(updated).toMatchObject({
      id: created?.id,
      title: "夜行修订",
      summary: "修订后的摘要",
    });

    await expect(caller.storyAgent.storyDelete({ id: created!.id })).resolves.toEqual({
      ok: true,
    });
    await expect(caller.storyAgent.storyGet({ id: created!.id })).resolves.toBeNull();
  });

  it("手机端保存会把 messages 与 cards 写进 story body，且更新时不抹掉原标题", async () => {
    const caller = appRouter.createCaller(createAuthContext(188));

    const created = await caller.storyAgent.storyUpsert({
      title: "手机故事",
      body: {
        cards: [
          {
            id: "card-mobile-1",
            title: "晚风",
            content: "晚风里的一句停顿",
            emotion: "quiet",
            sensoryDetails: [],
            createdAt: 100,
          },
        ],
        characters: [],
        shots: [],
        messages: [
          {
            id: "u-1",
            role: "user",
            content: "我今天在路边站了一会儿",
            timestamp: 123,
          },
          {
            id: "a-1",
            role: "assistant",
            content: "我听见这个停顿了。",
            timestamp: 124,
            suggestImage: true,
            imagePrompt: "夜色路边，微风，安静停顿",
          },
        ],
      },
    });

    const loaded = await caller.storyAgent.storyGet({ id: created!.id });
    const body = loaded?.body as Record<string, unknown>;

    expect(loaded?.title).toBe("手机故事");
    expect(body.cards).toEqual([
      expect.objectContaining({ id: "card-mobile-1", content: "晚风里的一句停顿" }),
    ]);
    expect(body.messages).toEqual([
      expect.objectContaining({
        role: "user",
        content: "我今天在路边站了一会儿",
        timestamp: 123,
      }),
      expect.objectContaining({
        role: "assistant",
        content: "我听见这个停顿了。",
        timestamp: 124,
      }),
    ]);

    const updated = await caller.storyAgent.storyUpsert({
      id: created!.id,
      body: {
        cards: [],
        characters: [],
        shots: [],
        messages: [
          {
            role: "user",
            content: "新手机清缓存后也能接上",
            timestamp: 125,
          },
        ],
      },
    });

    expect(updated?.title).toBe("手机故事");
    const updatedBody = updated?.body as Record<string, unknown>;
    expect(updatedBody.messages).toEqual([
      expect.objectContaining({
        role: "user",
        content: "新手机清缓存后也能接上",
        timestamp: 125,
      }),
    ]);
  });

  it("旧设备保存时合并新增进度，不覆盖另一端已经写入的消息和卡片", async () => {
    const caller = appRouter.createCaller(createAuthContext(189));

    const created = await caller.storyAgent.storyUpsert({
      title: "跨端故事",
      body: {
        cards: [{ id: "card-1", content: "共同的开场", createdAt: 100 }],
        characters: [],
        shots: [],
        messages: [
          {
            id: "message-1",
            role: "user",
            content: "共同的开场",
            timestamp: 100,
          },
        ],
      },
    });
    const baseRevision = created!.revision;

    const mobileSaved = await caller.storyAgent.storyUpsert({
      id: created!.id,
      baseRevision,
      body: {
        cards: [
          { id: "card-1", content: "共同的开场", createdAt: 100 },
          { id: "card-mobile", content: "手机补充的片段", createdAt: 200 },
        ],
        characters: [],
        shots: [],
        messages: [
          {
            id: "message-1",
            role: "user",
            content: "共同的开场",
            timestamp: 100,
          },
          {
            id: "message-mobile",
            role: "assistant",
            content: "手机端继续说了一句",
            timestamp: 200,
          },
        ],
      },
    });

    const desktopSaved = await caller.storyAgent.storyUpsert({
      id: created!.id,
      baseRevision,
      body: {
        cards: [
          { id: "card-1", content: "共同的开场", createdAt: 100 },
          { id: "card-desktop", content: "电脑补充的片段", createdAt: 300 },
        ],
        characters: [],
        shots: [],
        messages: [
          {
            id: "message-1",
            role: "user",
            content: "共同的开场",
            timestamp: 100,
          },
          {
            id: "message-desktop",
            role: "assistant",
            content: "电脑端继续说了一句",
            timestamp: 300,
          },
        ],
      },
    });

    expect(mobileSaved?.syncConflict).toBe(false);
    expect(desktopSaved?.syncConflict).toBe(true);
    expect(desktopSaved?.revision).toBeGreaterThan(mobileSaved!.revision);

    const body = desktopSaved?.body as Record<string, unknown>;
    expect(body.cards).toEqual([
      expect.objectContaining({ id: "card-1" }),
      expect.objectContaining({ id: "card-mobile" }),
      expect.objectContaining({ id: "card-desktop" }),
    ]);
    expect(body.messages).toEqual([
      expect.objectContaining({ id: "message-1" }),
      expect.objectContaining({ id: "message-mobile" }),
      expect.objectContaining({ id: "message-desktop" }),
    ]);
  });

  it("手机端文生图成功后带 projectId 落库", async () => {
    imageGenMocks.generateImage.mockResolvedValueOnce({
      status: "ok",
      imageUrl: "https://storage.example/generated/mobile-text.png",
      imageKey: "generated/mobile-text.png",
    });
    const caller = appRouter.createCaller(createAuthContext(301));

    const story = await caller.storyAgent.storyUpsert({
      title: "手机文生图故事",
      projectId: 7301,
      body: { cards: [], characters: [], shots: [] },
    });

    const result = await caller.storyAgent.generateForMobile({
      storyId: story!.id,
      shotNo: 1,
      prompt: "雨夜路灯下的一个停顿",
    });

    // 出图经美术网关，prompt 会被追加美术流派 DNA，这里只断言用户原 prompt 被包含；
    // 手机端走 draft 档（--quality 0.25 + turbo，省一半渲染时间）
    expect(imageGenMocks.generateImage).toHaveBeenCalledWith(
      expect.stringContaining("雨夜路灯下的一个停顿"),
      // U4: generateForMobile 给出图传 { characterRef } options；本故事无主角参照 → undefined
      expect.objectContaining({ characterRef: undefined }),
    );
    expect(result).toMatchObject({
      status: "ok",
      imageUrl: "https://storage.example/generated/mobile-text.png",
    });
    const projectImages = await caller.creationAgent.getProjectImages({ projectId: 7301 });
    expect(projectImages).toEqual([
      expect.objectContaining({
        projectId: 7301,
        storyId: story!.id,
        userId: 301,
        shotNo: "SH01",
        imageUrl: "https://storage.example/generated/mobile-text.png",
        generationType: "initial",
        isCurrent: true,
      }),
    ]);
  });

  it("手机生成并右划收下后，Creation 读取为标准镜号主图", async () => {
    imageGenMocks.generateImage.mockResolvedValueOnce({
      status: "ok",
      imageUrl: "https://storage.example/generated/selected-mobile.png",
      imageKey: "generated/selected-mobile.png",
    });
    const caller = appRouter.createCaller(createAuthContext(311));
    const project = await caller.project.create({ name: "跨端图片继承" });
    // 故事为唯一单位后：先有故事，再 classify 把镜头写到该故事名下（带 storyId）
    const story = await caller.storyAgent.storyUpsert({
      title: "跨端故事",
      projectId: project.id,
      body: { cards: [], characters: [], shots: [] },
    });
    await caller.storyAgent.classify({
      projectId: project.id,
      storyId: story!.id,
      cards: [{ content: "雨夜里停在窗边的人" }],
    });

    const generated = await caller.storyAgent.generateForMobile({
      storyId: story!.id,
      shotNo: 1,
      prompt: "雨夜窗边的安静停顿",
    });
    expect(generated.status).toBe("ok");

    const pendingAssets = await caller.creationAgent.getProjectAssets({
      storyId: story!.id,
    });
    expect(pendingAssets).toEqual([
      expect.objectContaining({
        id: generated.imageId,
        rawShotNo: "SH01",
        canonicalShotNo: "SH01",
        assignment: "shot",
        status: "pending",
        isPrimary: false,
      }),
    ]);

    await caller.storyAgent.recordSignal({
      storyId: story!.id,
      imageId: generated.imageId,
      action: "swipe_right",
    });
    const selectedAssets = await caller.creationAgent.getProjectAssets({
      storyId: story!.id,
    });
    expect(selectedAssets[0]).toMatchObject({
      status: "selected",
      isPrimary: true,
      selectionSource: "explicit",
    });
  });

  it("手机端图生图成功后带 projectId 落库", async () => {
    imageGenMocks.editImage.mockResolvedValueOnce({
      status: "ok",
      imageUrl: "https://storage.example/generated/mobile-edit.png",
      imageKey: "generated/mobile-edit.png",
    });
    const caller = appRouter.createCaller(createAuthContext(302));

    const story = await caller.storyAgent.storyUpsert({
      title: "手机图生图故事",
      projectId: 7302,
      body: { cards: [], characters: [], shots: [] },
    });

    const result = await caller.storyAgent.generateForMobile({
      storyId: story!.id,
      shotNo: 1,
      prompt: "保留人物，把背景换成微雨夜色",
      originalImageUrl: "data:image/jpeg;base64,aW1hZ2U=",
    });

    // 经美术网关，prompt 被追加风格 DNA → 只断言含原 prompt（基底图不变）；手机端 draft 档
    expect(imageGenMocks.editImage).toHaveBeenCalledWith(
      "data:image/jpeg;base64,aW1hZ2U=",
      expect.stringContaining("保留人物，把背景换成微雨夜色"),
      // U4: 图生图慢轨也带 { characterRef } options；本故事无主角参照 → undefined
      expect.objectContaining({ characterRef: undefined }),
    );
    expect(result).toMatchObject({
      status: "ok",
      imageUrl: "https://storage.example/generated/mobile-edit.png",
    });
    const projectImages = await caller.creationAgent.getProjectImages({ projectId: 7302 });
    expect(projectImages[0]).toMatchObject({
      projectId: 7302,
      storyId: story!.id,
      userId: 302,
      shotNo: "SH01",
      imageUrl: "https://storage.example/generated/mobile-edit.png",
      generationType: "initial",
      isCurrent: true,
    });
  });

  it("故事有主角参照(role:character, 公网URL) → 图生图带 characterRef 跨镜头锁人物", async () => {
    imageGenMocks.editImage.mockResolvedValueOnce({
      status: "ok",
      imageUrl: "https://storage.example/generated/hero-shot.png",
      imageKey: "generated/hero-shot.png",
    });
    const caller = appRouter.createCaller(createAuthContext(308));
    const heroUrl = "https://file.302.ai/hero.png";

    const story = await caller.storyAgent.storyUpsert({
      title: "主角一致故事",
      projectId: 7308,
      body: {
        cards: [],
        characters: [],
        shots: [],
        artDirection: {
          phase: "locked",
          references: [
            {
              id: "r1",
              label: "主角",
              source: "visual-anchor",
              purpose: "fact",
              selected: true,
              role: "character",
              imageUrl: heroUrl,
            },
          ],
        },
      },
    });

    await caller.storyAgent.generateForMobile({
      storyId: story!.id,
      shotNo: 1,
      prompt: "主角在公园散步",
    });

    // 主角参照既作图生图垫图基底（第1参数），又经 --cref 锁人物长相（characterRef）
    expect(imageGenMocks.editImage).toHaveBeenCalledWith(
      heroUrl,
      expect.stringContaining("主角在公园散步"),
      expect.objectContaining({ characterRef: heroUrl }),
    );
  });

  it("手机端 mobileInpaint 成功后带 projectId 落库", async () => {
    imageGenMocks.editImage.mockResolvedValueOnce({
      status: "ok",
      imageUrl: "https://storage.example/generated/mobile-inpaint.png",
      imageKey: "generated/mobile-inpaint.png",
    });
    const caller = appRouter.createCaller(createAuthContext(303));

    const story = await caller.storyAgent.storyUpsert({
      title: "手机修图故事",
      projectId: 7303,
      body: { cards: [], characters: [], shots: [] },
    });

    const result = await caller.storyAgent.mobileInpaint({
      storyId: story!.id,
      shotNo: 1,
      prompt: "把路牌文字去掉",
      originalImageUrl: "data:image/png;base64,aW1hZ2U=",
    });

    // 经美术网关，prompt 被追加风格 DNA → 只断言含原 prompt（基底图不变）
    expect(imageGenMocks.editImage).toHaveBeenCalledWith(
      "data:image/png;base64,aW1hZ2U=",
      expect.stringContaining("把路牌文字去掉"),
    );
    expect(result.status).toBe("ok");
    const projectImages = await caller.creationAgent.getProjectImages({ projectId: 7303 });
    expect(projectImages[0]).toMatchObject({
      projectId: 7303,
      storyId: story!.id,
      userId: 303,
      shotNo: "SH01",
      imageUrl: "https://storage.example/generated/mobile-inpaint.png",
      generationType: "inpaint",
      isCurrent: true,
    });
  });

  it("手机端出图失败时返回中文错误且不抛出", async () => {
    imageGenMocks.generateImage.mockResolvedValueOnce({
      status: "error",
      message: "302 GPT-image 暂时不可用（HTTP 502）。",
    });
    const caller = appRouter.createCaller(createAuthContext(304));

    const story = await caller.storyAgent.storyUpsert({
      title: "失败也不断线",
      projectId: 7304,
      body: { cards: [], characters: [], shots: [] },
    });

    const result = await caller.storyAgent.generateForMobile({
      storyId: story!.id,
      shotNo: 1,
      prompt: "这次上游失败",
    });

    expect(result.status).toBe("error");
    expect(result.error).toContain("302 GPT-image 暂时不可用");
    const projectImages = await caller.creationAgent.getProjectImages({ projectId: 7304 });
    expect(projectImages).toEqual([]);
  });
});
