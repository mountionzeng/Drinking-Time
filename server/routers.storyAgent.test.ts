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

const creationAgentMocks = vi.hoisted(() => ({
  runJsonAgent: vi.fn(),
}));

vi.mock("./services/agentRuntime", () => ({
  runJsonAgent: creationAgentMocks.runJsonAgent,
}));

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
  generateDraftImage: vi.fn(async () => ({
    status: "ok" as const,
    imageUrl: "https://storage.example/generated/default-draft.png",
    imageKey: "generated/default-draft.png",
  })),
  toPublicImageUrl: vi.fn(async (url?: string) => url),
}));

vi.mock("./services/imageGen", () => imageGenMocks);

const imagePromptDirectorMocks = vi.hoisted(() => ({
  directImagePrompt: vi.fn(async (input: { fallbackPrompt: string }) => ({
    prompt: input.fallbackPrompt,
    source: "deterministic-fallback" as const,
    model: "test-image-director",
    analysis: null,
  })),
}));

vi.mock("./services/imagePromptDirector", () => imagePromptDirectorMocks);

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
    imagePromptDirectorMocks.directImagePrompt.mockImplementation(
      async input => ({
        prompt: input.fallbackPrompt,
        source: "deterministic-fallback",
        model: "test-image-director",
        analysis: null,
      }),
    );
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
      cards: [{ title: "等待能力", content: "路灯下等待", emotion: "quiet" }],
      characterHint: "林",
      confirmedIntent: {
        purpose: "linkedin_job_search",
        audience: "recruiters",
        platform: "linkedin",
        tone: "克制",
        desiredEffect: "证明值得联系",
        targetRole: "产品经理",
        channel: "linkedin",
      },
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
      expect.objectContaining({
        characterHint: "林",
        confirmedIntent: expect.objectContaining({
          purpose: "linkedin_job_search",
          targetRole: "产品经理",
        }),
        cards: [expect.objectContaining({ title: "等待能力" })],
      }),
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

  it("setCharacterAnchor 写入 role:character 锚点，重复写会替换而非堆叠", async () => {
    const caller = appRouter.createCaller(createAuthContext(390));
    const firstUrl = "https://file.302.ai/first-hero.png";
    const secondUrl = "https://file.302.ai/second-hero.png";

    const story = await caller.storyAgent.storyUpsert({
      title: "服务端锚点故事",
      projectId: 7390,
      body: {
        cards: [],
        characters: [],
        shots: [],
        artDirection: {
          phase: "locked",
          references: [
            {
              id: "style-1",
              label: "画风",
              source: "visual-anchor",
              purpose: "aesthetic",
              selected: true,
              imageUrl: "https://file.302.ai/style.png",
            },
          ],
        },
      },
    });

    const first = await caller.storyAgent.setCharacterAnchor({
      storyId: story!.id,
      imageUrl: firstUrl,
    });
    expect(first).toMatchObject({ status: "ok", publicUrl: firstUrl });

    const second = await caller.storyAgent.setCharacterAnchor({
      storyId: story!.id,
      imageUrl: secondUrl,
    });
    expect(second).toMatchObject({ status: "ok", publicUrl: secondUrl });

    const loaded = await caller.storyAgent.storyGet({ id: story!.id });
    const body = loaded?.body as Record<string, unknown>;
    const direction = body.artDirection as { references?: Array<Record<string, unknown>> };
    const characterRefs = (direction.references ?? []).filter(
      reference => reference.role === "character",
    );
    expect(characterRefs).toEqual([
      expect.objectContaining({ imageUrl: secondUrl, selected: true }),
    ]);
    expect(direction.references).toEqual([
      expect.objectContaining({ id: "style-1" }),
      expect.objectContaining({ role: "character", imageUrl: secondUrl }),
    ]);
  });

  it("setCharacterAnchor 会把本地图转成公网 URL 后再存", async () => {
    imageGenMocks.toPublicImageUrl.mockResolvedValueOnce("https://file.302.ai/public-local.png");
    const caller = appRouter.createCaller(createAuthContext(391));

    const story = await caller.storyAgent.storyUpsert({
      title: "本地锚点故事",
      projectId: 7391,
      body: { cards: [], characters: [], shots: [] },
    });

    const result = await caller.storyAgent.setCharacterAnchor({
      storyId: story!.id,
      imageUrl: "/api/images/local-hero.png",
    });

    expect(imageGenMocks.toPublicImageUrl).toHaveBeenCalledWith("/api/images/local-hero.png");
    expect(result).toMatchObject({
      status: "ok",
      publicUrl: "https://file.302.ai/public-local.png",
    });

    const loaded = await caller.storyAgent.storyGet({ id: story!.id });
    const body = loaded?.body as Record<string, unknown>;
    const direction = body.artDirection as { references?: Array<Record<string, unknown>> };
    expect(direction.references).toEqual([
      expect.objectContaining({
        role: "character",
        imageUrl: "https://file.302.ai/public-local.png",
      }),
    ]);
  });

  it("setCharacterAnchor 不能写入其他用户的 story", async () => {
    const owner = appRouter.createCaller(createAuthContext(392));
    const other = appRouter.createCaller(createAuthContext(393));
    const story = await owner.storyAgent.storyUpsert({
      title: "不能越权",
      projectId: 7392,
      body: { cards: [], characters: [], shots: [] },
    });

    const result = await other.storyAgent.setCharacterAnchor({
      storyId: story!.id,
      imageUrl: "https://file.302.ai/other.png",
    });

    expect(result).toMatchObject({ status: "error" });
    const loaded = await owner.storyAgent.storyGet({ id: story!.id });
    const body = loaded?.body as Record<string, unknown>;
    expect(body.artDirection).toBeUndefined();
  });

  it("setCharacterAnchor 后 generateForMobile 能经 U3 helper 注入人物锚点", async () => {
    imagePromptDirectorMocks.directImagePrompt.mockResolvedValueOnce({
      prompt: "A directed cinematic frame of the protagonist walking into rain.",
      source: "302-vision",
      model: "gpt-5.4-nano-2026-03-17",
      analysis: null,
    });
    imageGenMocks.editImage.mockResolvedValueOnce({
      status: "ok",
      imageUrl: "https://storage.example/generated/u6-anchor.png",
      imageKey: "generated/u6-anchor.png",
    });
    const caller = appRouter.createCaller(createAuthContext(394));
    const anchorUrl = "https://file.302.ai/u6-anchor.png";

    const story = await caller.storyAgent.storyUpsert({
      title: "锚点注入故事",
      projectId: 7394,
      body: { cards: [], characters: [], shots: [] },
    });
    await caller.storyAgent.setCharacterAnchor({
      storyId: story!.id,
      imageUrl: anchorUrl,
    });

    await caller.storyAgent.generateForMobile({
      storyId: story!.id,
      shotNo: 1,
      prompt: "主角走进雨夜",
    });

    expect(imagePromptDirectorMocks.directImagePrompt).toHaveBeenCalledOnce();
    expect(imagePromptDirectorMocks.directImagePrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        imageInput: anchorUrl,
        referencePurpose: "character",
      }),
    );
    expect(imageGenMocks.editImage).toHaveBeenCalledWith(
      anchorUrl,
      expect.stringContaining("A directed cinematic frame"),
      expect.objectContaining({
        characterRef: anchorUrl,
        characterWeight: 100,
        styleRef: anchorUrl,
      }),
    );
  });

  it("creationAgent.chat 的 setCharacterAnchor toolCall 会经 U6 持久化人物锚点", async () => {
    imageGenMocks.generateImage.mockResolvedValueOnce({
      status: "ok",
      imageUrl: "https://storage.example/generated/agent-anchor.png",
      imageKey: "generated/agent-anchor.png",
    });
    const caller = appRouter.createCaller(createAuthContext(395));

    const story = await caller.storyAgent.storyUpsert({
      title: "对话设锚点故事",
      projectId: 7395,
      body: { cards: [], characters: [], shots: [] },
    });
    const generated = await caller.storyAgent.generateForMobile({
      storyId: story!.id,
      shotNo: 1,
      prompt: "主角站在窗边",
    });
    expect(generated.status).toBe("ok");
    if (generated.status !== "ok") {
      throw new Error("expected image generation to succeed");
    }
    creationAgentMocks.runJsonAgent.mockResolvedValueOnce({
      parsed: {
        reply: "好，我把这张设成主角锚点。",
        toolCalls: [{ tool: "setCharacterAnchor", imageId: generated.imageId }],
        focusShotNo: "SH01",
      },
      modelLabel: "mock-model",
    });

    const result = await caller.creationAgent.chat({
      projectId: 7395,
      storyId: story!.id,
      message: `把 #${generated.imageId} 设成主角`,
      currentFocusShotNo: "SH01",
    });

    expect(result).toMatchObject({
      characterAnchorChanged: true,
      reply: expect.stringContaining("已把这张图设为人物锚点"),
    });
    const loaded = await caller.storyAgent.storyGet({ id: story!.id });
    const body = loaded?.body as Record<string, unknown>;
    const direction = body.artDirection as { references?: Array<Record<string, unknown>> };
    expect(direction.references).toEqual([
      expect.objectContaining({
        role: "character",
        imageUrl: "https://storage.example/generated/agent-anchor.png",
      }),
    ]);
  });

  it("creationAgent.chat 可把照片重绘成风格化人物图后设为锚点", async () => {
    imageGenMocks.editImage.mockResolvedValueOnce({
      status: "ok",
      imageUrl: "https://storage.example/generated/stylized-character.png",
      imageKey: "generated/stylized-character.png",
    });
    creationAgentMocks.runJsonAgent.mockResolvedValueOnce({
      parsed: {
        reply: "我先把照片重绘成这个故事的画风。",
        toolCalls: [
          {
            tool: "createCharacterFromPhoto",
            photoUrl: "data:image/jpeg;base64,PHOTO",
          },
        ],
        focusShotNo: "SH01",
      },
      modelLabel: "mock-model",
    });
    const caller = appRouter.createCaller(createAuthContext(396));
    const story = await caller.storyAgent.storyUpsert({
      title: "照片锚点故事",
      projectId: 7396,
      body: { cards: [], characters: [], shots: [] },
    });

    const result = await caller.creationAgent.chat({
      projectId: 7396,
      storyId: story!.id,
      message: "用这张照片做主角",
      currentFocusShotNo: "SH01",
    });

    expect(imageGenMocks.editImage).toHaveBeenCalledWith(
      "data:image/jpeg;base64,PHOTO",
      expect.stringContaining("Preserve the person's recognizable face"),
      expect.objectContaining({ requireInputImage: true }),
    );
    expect(result).toMatchObject({
      characterAnchorChanged: true,
      reply: expect.stringContaining("已把照片重绘成风格化人物图"),
    });
    const loaded = await caller.storyAgent.storyGet({ id: story!.id });
    const body = loaded?.body as Record<string, unknown>;
    const direction = body.artDirection as { references?: Array<Record<string, unknown>> };
    expect(direction.references).toEqual([
      expect.objectContaining({
        role: "character",
        imageUrl: "https://storage.example/generated/stylized-character.png",
      }),
    ]);
  });

  it("照片重绘失败时不把原照或无关文生图设为人物锚点", async () => {
    imageGenMocks.editImage.mockResolvedValueOnce({
      status: "error",
      message: "MJ 图生图未能基于输入照片完成：malformed image prompt",
    });
    creationAgentMocks.runJsonAgent.mockResolvedValueOnce({
      parsed: {
        reply: "我试一下照片重绘。",
        toolCalls: [
          {
            tool: "createCharacterFromPhoto",
            photoUrl: "data:image/jpeg;base64,PHOTO",
          },
        ],
        focusShotNo: "SH01",
      },
      modelLabel: "mock-model",
    });
    const caller = appRouter.createCaller(createAuthContext(397));
    const story = await caller.storyAgent.storyUpsert({
      title: "照片失败故事",
      projectId: 7397,
      body: { cards: [], characters: [], shots: [] },
    });

    const result = await caller.creationAgent.chat({
      projectId: 7397,
      storyId: story!.id,
      message: "用这张照片做主角",
      currentFocusShotNo: "SH01",
    });

    expect(result).toMatchObject({
      characterAnchorChanged: false,
      reply: expect.stringContaining("不会把无关文生图或原始照片设为锚点"),
    });
    const loaded = await caller.storyAgent.storyGet({ id: story!.id });
    const body = loaded?.body as Record<string, unknown>;
    expect(body.artDirection).toBeUndefined();
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

    // 出图经美术网关，prompt 会被追加美术流派 DNA，这里只断言用户原 prompt 被包含。
    expect(imageGenMocks.generateImage).toHaveBeenCalledWith(
      expect.stringContaining("雨夜路灯下的一个停顿"),
      expect.any(Object),
    );
    expect(imageGenMocks.generateImage.mock.calls[0][1]).not.toHaveProperty("characterRef");
    expect(result).toMatchObject({
      status: "ok",
      imageUrl: "https://storage.example/generated/mobile-text.png",
    });
    const projectImages = await caller.creationAgent.getProjectAssets({ storyId: story!.id });
    expect(projectImages).toEqual([
      expect.objectContaining({
        projectId: 7301,
        storyId: story!.id,
        userId: 301,
        rawShotNo: "SH01",
        canonicalShotNo: "SH01",
        imageUrl: "https://storage.example/generated/mobile-text.png",
        generationType: "initial",
        isCurrent: false,
      }),
    ]);
  });

  it("generateForMobile draft 文生图走旧版 flux 草稿快轨", async () => {
    imageGenMocks.generateDraftImage.mockResolvedValueOnce({
      status: "ok",
      imageUrl: "https://storage.example/generated/mobile-draft.png",
      imageKey: "generated/mobile-draft.png",
    });
    const caller = appRouter.createCaller(createAuthContext(399));

    const story = await caller.storyAgent.storyUpsert({
      title: "flux draft 文生图故事",
      projectId: 7399,
      body: { cards: [], characters: [], shots: [] },
    });

    const result = await caller.storyAgent.generateForMobile({
      storyId: story!.id,
      shotNo: 1,
      prompt: "办公室门口的迟疑瞬间",
      mode: "draft",
    });

    expect(imageGenMocks.generateDraftImage).toHaveBeenCalledWith(
      expect.stringContaining("办公室门口的迟疑瞬间"),
    );
    expect(imageGenMocks.generateImage).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: "ok",
      imageUrl: "https://storage.example/generated/mobile-draft.png",
      mode: "draft",
    });
    const projectImages = await caller.creationAgent.getProjectAssets({ storyId: story!.id });
    expect(projectImages[0]).toMatchObject({
      projectId: 7399,
      storyId: story!.id,
      userId: 399,
      rawShotNo: "SH01",
      canonicalShotNo: "SH01",
      imageUrl: "https://storage.example/generated/mobile-draft.png",
      generationType: "generate",
      isCurrent: false,
    });
  });

  it("generateForMobile 有角色表时给正式图注入人物连续性档案", async () => {
    imageGenMocks.generateImage.mockResolvedValueOnce({
      status: "ok",
      imageUrl: "https://storage.example/generated/character-continuity.png",
      imageKey: "generated/character-continuity.png",
    });
    const caller = appRouter.createCaller(createAuthContext(402));

    const story = await caller.storyAgent.storyUpsert({
      title: "人物连续性故事",
      projectId: 7402,
      body: {
        cards: [],
        characters: [
          { name: "小林", role: "主角", oneLiner: "短发，深色外套，总背着旧包" },
        ],
        shots: [],
      },
    });

    await caller.storyAgent.generateForMobile({
      storyId: story!.id,
      shotNo: 1,
      prompt: "主角走进雨夜路灯下",
    });

    const renderedPrompt = imageGenMocks.generateImage.mock.calls[0]?.[0] ?? "";
    expect(renderedPrompt).toContain("主角走进雨夜路灯下");
    expect(renderedPrompt).toContain("Character continuity across all generated shots");
    expect(renderedPrompt).toContain("小林, 主角: 短发，深色外套，总背着旧包");
    expect(renderedPrompt).toContain("Preserve face shape");
  });

  it("generateForMobile draft 也注入人物连续性档案", async () => {
    imageGenMocks.generateDraftImage.mockResolvedValueOnce({
      status: "ok",
      imageUrl: "https://storage.example/generated/character-draft.png",
      imageKey: "generated/character-draft.png",
    });
    const caller = appRouter.createCaller(createAuthContext(403));

    const story = await caller.storyAgent.storyUpsert({
      title: "人物连续性草稿故事",
      projectId: 7403,
      body: {
        cards: [],
        characters: [
          { name: "候选人", role: "主视点", oneLiner: "黑色短发，灰色连帽衫" },
        ],
        shots: [],
      },
    });

    await caller.storyAgent.generateForMobile({
      storyId: story!.id,
      shotNo: 1,
      prompt: "候选人在桌前整理作品集",
      mode: "draft",
    });

    const renderedPrompt = imageGenMocks.generateDraftImage.mock.calls[0]?.[0] ?? "";
    expect(renderedPrompt).toContain("候选人在桌前整理作品集");
    expect(renderedPrompt).toContain("Character continuity across all generated shots");
    expect(renderedPrompt).toContain("候选人, 主视点: 黑色短发，灰色连帽衫");
  });

  it("generateForMobile 有 styleHint 时用共享美术配方，不混入每日流派", async () => {
    imageGenMocks.generateDraftImage.mockResolvedValueOnce({
      status: "ok",
      imageUrl: "https://storage.example/generated/mobile-style-draft.png",
      imageKey: "generated/mobile-style-draft.png",
    });
    const caller = appRouter.createCaller(createAuthContext(401));

    const story = await caller.storyAgent.storyUpsert({
      title: "共享美术风格故事",
      projectId: 7401,
      body: { cards: [], characters: [], shots: [] },
    });

    await caller.storyAgent.generateForMobile({
      storyId: story!.id,
      shotNo: 1,
      prompt: "候选人在白色工作台前整理作品集",
      styleHint: "premium commercial film, product storytelling, off-white",
      mode: "draft",
    });

    const renderedPrompt = imageGenMocks.generateDraftImage.mock.calls[0]?.[0] ?? "";
    expect(renderedPrompt).toContain("候选人在白色工作台前整理作品集");
    expect(renderedPrompt).toContain("【故事视觉配方】");
    expect(renderedPrompt).toContain("premium commercial film");
    expect(renderedPrompt).toContain("product storytelling");
    expect(renderedPrompt).toContain("off-white");
    expect(renderedPrompt).not.toContain("【美术流派");
  });

  it("generateForMobile draft 有原图时仍先走旧版 flux 草稿快轨", async () => {
    imageGenMocks.generateDraftImage.mockResolvedValueOnce({
      status: "ok",
      imageUrl: "https://storage.example/generated/mobile-draft-edit.png",
      imageKey: "generated/mobile-draft-edit.png",
    });
    const caller = appRouter.createCaller(createAuthContext(400));

    const story = await caller.storyAgent.storyUpsert({
      title: "flux draft 有原图故事",
      projectId: 7400,
      body: { cards: [], characters: [], shots: [] },
    });

    const result = await caller.storyAgent.generateForMobile({
      storyId: story!.id,
      shotNo: 1,
      prompt: "保留人物轮廓，换成暖色办公室灯光",
      originalImageUrl: "data:image/jpeg;base64,aW1hZ2U=",
      sceneWeight: 1.25,
      mode: "draft",
    });

    expect(imageGenMocks.generateDraftImage).toHaveBeenCalledWith(
      expect.stringContaining("保留人物轮廓，换成暖色办公室灯光"),
    );
    expect(imageGenMocks.editImage).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: "ok",
      imageUrl: "https://storage.example/generated/mobile-draft-edit.png",
      mode: "draft",
    });
  });

  it("Story Cards 删除画面后 storyGet 不再返回该图", async () => {
    imageGenMocks.generateImage.mockResolvedValueOnce({
      status: "ok",
      imageUrl: "https://storage.example/generated/delete-me.png",
      imageKey: "generated/delete-me.png",
    });
    const caller = appRouter.createCaller(createAuthContext(398));

    const story = await caller.storyAgent.storyUpsert({
      title: "删除故事画面",
      projectId: 7398,
      body: {
        cards: [],
        characters: [],
        shots: [{ shotNo: 1, subject: "窗边的人" }],
      },
    });

    const generated = await caller.storyAgent.generateForMobile({
      storyId: story!.id,
      shotNo: 1,
      prompt: "窗边的人回头看见晨光",
    });
    expect(generated.status).toBe("ok");

    await caller.storyAgent.recordSignal({
      storyId: story!.id,
      imageId: generated.imageId,
      action: "swipe_right",
      metadata: { source: "story-cards-accept" },
    });

    const before = await caller.storyAgent.storyGet({ id: story!.id });
    expect((before?.body as { mobileImages?: Array<{ id: number }> }).mobileImages).toEqual([
      expect.objectContaining({ id: generated.imageId }),
    ]);

    await caller.storyAgent.recordSignal({
      storyId: story!.id,
      imageId: generated.imageId,
      action: "swipe_left",
      metadata: { source: "story-cards-delete" },
    });

    const after = await caller.storyAgent.storyGet({ id: story!.id });
    expect((after?.body as { mobileImages?: Array<{ id: number }> }).mobileImages ?? []).toEqual([]);
  });

  it("recordSignal 拒绝给其他用户的故事图片打信号", async () => {
    imageGenMocks.generateImage.mockResolvedValueOnce({
      status: "ok",
      imageUrl: "https://storage.example/generated/owned-image.png",
      imageKey: "generated/owned-image.png",
    });
    const owner = appRouter.createCaller(createAuthContext(399));
    const other = appRouter.createCaller(createAuthContext(400));

    const story = await owner.storyAgent.storyUpsert({
      title: "图片信号鉴权",
      projectId: 7399,
      body: { cards: [], characters: [], shots: [] },
    });
    const generated = await owner.storyAgent.generateForMobile({
      storyId: story!.id,
      shotNo: 1,
      prompt: "只有故事主人能评价这张图",
    });
    expect(generated.status).toBe("ok");

    await expect(
      other.storyAgent.recordSignal({
        storyId: story!.id,
        imageId: generated.imageId,
        action: "swipe_left",
      }),
    ).resolves.toMatchObject({ status: "error" });
  });

  it("generateForMobile 传入 sceneAnalysis 时按分析组 prompt，空镜不造人", async () => {
    imageGenMocks.generateImage.mockResolvedValueOnce({
      status: "ok",
      imageUrl: "https://storage.example/generated/empty-alley.png",
      imageKey: "generated/empty-alley.png",
    });
    const caller = appRouter.createCaller(createAuthContext(321));

    const story = await caller.storyAgent.storyUpsert({
      title: "空镜故事",
      projectId: 7321,
      body: { cards: [], characters: [], shots: [] },
    });

    const result = await caller.storyAgent.generateForMobile({
      storyId: story!.id,
      shotNo: 1,
      styleHint: "delicate watercolor",
      sceneAnalysis: {
        subjectDescription: "雨后的窄巷积水反光",
        isPerson: false,
        recurringCharacter: null,
        action: "雨水沿屋檐落下",
        emotion: "清冷",
        keyElements: ["窄巷", "积水", "路灯倒影"],
        needsCharacterAnchor: false,
        confidence: 75,
        intent: "给招聘者看她能把复杂局面降噪",
        rationale: "这一镜用空巷说明问题被她整理清楚了",
      },
    });

    expect(result.status).toBe("ok");
    expect(result).toMatchObject({
      intent: "给招聘者看她能把复杂局面降噪",
      rationale: "这一镜用空巷说明问题被她整理清楚了",
    });
    expect(imageGenMocks.generateImage).toHaveBeenCalledWith(
      expect.stringContaining("雨后的窄巷积水反光"),
      expect.anything(),
    );
    const submittedPrompt = imageGenMocks.generateImage.mock.calls[0][0] as string;
    expect(submittedPrompt).toContain("no people");
    expect(submittedPrompt).toContain("no faces");
    expect(submittedPrompt).toContain("delicate watercolor");
    expect(submittedPrompt).not.toContain("这一镜用空巷");
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

  it("storyImages 和 storyGet 只投影用户收下的镜头主图", async () => {
    imageGenMocks.generateImage
      .mockResolvedValueOnce({
        status: "ok",
        imageUrl: "https://storage.example/generated/rejected-frame.png",
        imageKey: "generated/rejected-frame.png",
      })
      .mockResolvedValueOnce({
        status: "ok",
        imageUrl: "https://storage.example/generated/pending-frame.png",
        imageKey: "generated/pending-frame.png",
      })
      .mockResolvedValueOnce({
        status: "ok",
        imageUrl: "https://storage.example/generated/selected-frame.png",
        imageKey: "generated/selected-frame.png",
      });
    const caller = appRouter.createCaller(createAuthContext(312));
    const story = await caller.storyAgent.storyUpsert({
      title: "只显示收下的故事画面",
      projectId: 7312,
      body: {
        cards: [],
        characters: [],
        shots: [{ shotNo: 1, subject: "把优势画出来" }],
      },
    });

    const rejected = await caller.storyAgent.generateForMobile({
      storyId: story!.id,
      shotNo: 1,
      prompt: "第一张不满意",
    });
    expect(rejected.status).toBe("ok");
    await caller.storyAgent.recordSignal({
      storyId: story!.id,
      imageId: rejected.imageId,
      action: "swipe_left",
    });

    const pending = await caller.storyAgent.generateForMobile({
      storyId: story!.id,
      shotNo: 1,
      prompt: "第二张还没收下",
    });
    expect(pending.status).toBe("ok");

    const selected = await caller.storyAgent.generateForMobile({
      storyId: story!.id,
      shotNo: 1,
      prompt: "第三张收下",
    });
    expect(selected.status).toBe("ok");
    await caller.storyAgent.recordSignal({
      storyId: story!.id,
      imageId: selected.imageId,
      action: "swipe_right",
    });

    const storyImages = await caller.storyAgent.storyImages({ storyId: story!.id });
    expect(storyImages.map(image => image.id)).toEqual([selected.imageId]);
    expect(storyImages[0]).toMatchObject({
      shotNo: "SH01",
      imageUrl: "https://storage.example/generated/selected-frame.png",
    });

    const workspace = await caller.storyAgent.storyGet({ id: story!.id });
    expect((workspace?.body as { mobileImages?: Array<{ id: number; shotNo: number }> }).mobileImages).toEqual([
      expect.objectContaining({ id: selected.imageId, shotNo: 1 }),
    ]);
  });

  it("storyImages 不投影划走旧图后的 pending 草稿，草稿只留在图片工作区历史", async () => {
    imageGenMocks.generateDraftImage
      .mockResolvedValueOnce({
        status: "ok",
        imageUrl: "https://storage.example/generated/rejected-draft.png",
        imageKey: "generated/rejected-draft.png",
      })
      .mockResolvedValueOnce({
        status: "ok",
        imageUrl: "https://storage.example/generated/current-draft.png",
        imageKey: "generated/current-draft.png",
      });
    const caller = appRouter.createCaller(createAuthContext(313));
    const story = await caller.storyAgent.storyUpsert({
      title: "故事版草稿不消失",
      projectId: 7313,
      body: {
        cards: [],
        characters: [],
        shots: [{ shotNo: 1, subject: "把优势画出来" }],
      },
    });

    const rejected = await caller.storyAgent.generateForMobile({
      storyId: story!.id,
      shotNo: 1,
      prompt: "第一张草稿",
      mode: "draft",
    });
    expect(rejected.status).toBe("ok");
    await caller.storyAgent.recordSignal({
      storyId: story!.id,
      imageId: rejected.imageId,
      action: "swipe_left",
    });

    const currentDraft = await caller.storyAgent.generateForMobile({
      storyId: story!.id,
      shotNo: 1,
      prompt: "第二张 current 草稿",
      mode: "draft",
    });
    expect(currentDraft.status).toBe("ok");

    const storyImages = await caller.storyAgent.storyImages({ storyId: story!.id });
    expect(storyImages).toEqual([]);

    const projectAssets = await caller.creationAgent.getProjectAssets({ storyId: story!.id });
    expect(projectAssets.find(asset => asset.id === currentDraft.imageId)).toMatchObject({
      status: "pending",
      isPrimary: false,
      imageUrl: "https://storage.example/generated/current-draft.png",
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
      expect.any(Object),
    );
    expect(imageGenMocks.editImage.mock.calls[0][2]).not.toHaveProperty("characterRef");
    expect(result).toMatchObject({
      status: "ok",
      imageUrl: "https://storage.example/generated/mobile-edit.png",
    });
    const projectImages = await caller.creationAgent.getProjectAssets({ storyId: story!.id });
    expect(projectImages[0]).toMatchObject({
      projectId: 7302,
      storyId: story!.id,
      userId: 302,
      rawShotNo: "SH01",
      canonicalShotNo: "SH01",
      imageUrl: "https://storage.example/generated/mobile-edit.png",
      generationType: "initial",
      isCurrent: false,
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

    // 主角参照既作图生图垫图基底（第1参数），又经 --oref/--sref 锁人物长相与人物镜头画风
    expect(imageGenMocks.editImage).toHaveBeenCalledWith(
      heroUrl,
      expect.stringContaining("主角在公园散步"),
      expect.objectContaining({ characterRef: heroUrl, styleRef: heroUrl }),
    );
  });

  it("故事有主角参照但 sceneAnalysis 是空镜 → 经 helper 注入 characterRef，不注入 styleRef", async () => {
    imageGenMocks.editImage.mockResolvedValueOnce({
      status: "ok",
      imageUrl: "https://storage.example/generated/empty-shot.png",
      imageKey: "generated/empty-shot.png",
    });
    const caller = appRouter.createCaller(createAuthContext(309));
    const heroUrl = "https://file.302.ai/hero.png";

    const story = await caller.storyAgent.storyUpsert({
      title: "空镜保留锚点故事",
      projectId: 7309,
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
      sceneAnalysis: {
        subjectDescription: "雨后的空巷积水反光",
        isPerson: false,
        recurringCharacter: null,
        action: "积水反射路灯",
        emotion: "清冷",
        keyElements: ["空巷", "积水", "路灯"],
        needsCharacterAnchor: false,
        confidence: 75,
      },
    });

    expect(imageGenMocks.editImage).toHaveBeenCalledWith(
      heroUrl,
      expect.stringContaining("雨后的空巷积水反光"),
      expect.objectContaining({
        characterRef: heroUrl,
      }),
    );
    expect(imageGenMocks.editImage.mock.calls[0][2]).not.toHaveProperty("styleRef");
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
    const projectImages = await caller.creationAgent.getProjectAssets({ storyId: story!.id });
    expect(projectImages[0]).toMatchObject({
      projectId: 7303,
      storyId: story!.id,
      userId: 303,
      rawShotNo: "SH01",
      canonicalShotNo: "SH01",
      imageUrl: "https://storage.example/generated/mobile-inpaint.png",
      generationType: "inpaint",
      isCurrent: false,
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
    const projectImages = await caller.creationAgent.getProjectAssets({ storyId: story!.id });
    expect(projectImages).toEqual([]);
  });
});
