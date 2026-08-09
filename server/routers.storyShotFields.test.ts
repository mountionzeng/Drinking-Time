import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TrpcContext } from "./_core/context";
import { ENV } from "./_core/env";
import { resetMemoryStateForTesting } from "./db";
import { appRouter } from "./routers";

const savedDatabaseUrl = ENV.databaseUrl;
const savedVoiceEnv = {
  api302Key: ENV.api302Key,
  tts302Provider: ENV.tts302Provider,
  tts302Voice: ENV.tts302Voice,
};

function context(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `shot-fields-${userId}`,
      email: `shot-fields-${userId}@example.com`,
      name: `Shot Fields ${userId}`,
      loginMethod: "test",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  };
}

beforeEach(() => {
  ENV.databaseUrl = "";
  resetMemoryStateForTesting();
});

afterEach(() => {
  ENV.databaseUrl = savedDatabaseUrl;
  ENV.api302Key = savedVoiceEnv.api302Key;
  ENV.tts302Provider = savedVoiceEnv.tts302Provider;
  ENV.tts302Voice = savedVoiceEnv.tts302Voice;
  vi.unstubAllGlobals();
});

describe("storyAgent.updateStoryShotFields", () => {
  it("patches the latest server story by stable id without replacing sibling edits", async () => {
    const caller = appRouter.createCaller(context(611));
    const created = await caller.storyAgent.storyUpsert({
      title: "SheSelf",
      body: {
        cards: [],
        characters: [],
        shots: [
          {
            stableShotId: "shot-0101",
            shotIdentity: "shot-0101",
            shotNo: 1,
            dialogue: "我害怕所有的事情",
            cameraMove: "缓慢推进",
          },
          {
            stableShotId: "shot-0102",
            shotIdentity: "shot-0102",
            shotNo: 2,
            dialogue: "另一镜保持不变",
          },
        ],
        timeline: { version: 7, items: ["shot-0101", "shot-0102"] },
        publishing: { activeVersionId: "v3" },
      },
    });
    if (!created) throw new Error("story creation failed");

    await caller.storyAgent.storyUpsert({
      id: created.id,
      baseRevision: created.revision,
      title: created.title,
      body: {
        ...(created.body as Record<string, unknown>),
        editorNote: "another tab saved this first",
      },
    });

    const result = await caller.storyAgent.updateStoryShotFields({
      storyId: created.id,
      stableShotId: "shot-0101",
      patch: {
        cueCode: "0101",
        cameraPath: "从正面极近景开始，沿视线轴推至眼部后停住。",
      },
    });

    expect(result.status).toBe("ok");
    const body = result.story?.body as Record<string, unknown>;
    expect(body.editorNote).toBe("another tab saved this first");
    expect((body.shots as Array<Record<string, unknown>>)[0]).toMatchObject({
      stableShotId: "shot-0101",
      cueCode: "0101",
      cameraMove: "缓慢推进",
      cameraPath: "从正面极近景开始，沿视线轴推至眼部后停住。",
    });
    expect((body.shots as Array<Record<string, unknown>>)[1]).toMatchObject({
      stableShotId: "shot-0102",
      dialogue: "另一镜保持不变",
    });
    expect(body.timeline).toEqual({
      version: 7,
      items: ["shot-0101", "shot-0102"],
    });
    expect(body.publishing).toEqual({ activeVersionId: "v3" });
  });

  it("updates editor metadata atomically without replacing sibling state", async () => {
    const caller = appRouter.createCaller(context(612));
    const created = await caller.storyAgent.storyUpsert({
      title: "Metadata command",
      body: {
        shots: [
          {
            stableShotId: "shot-0101",
            shotIdentity: "shot-0101",
            shotNo: 1,
            subject: "窗边人物",
            promptOverrides: {
              tone: { value: "暖色", weight: 0.3 },
            },
          },
          {
            stableShotId: "shot-0102",
            shotIdentity: "shot-0102",
            shotNo: 2,
            subject: "兄弟镜头",
          },
        ],
        timeline: { version: 4 },
        publishing: { activeVersionId: "v2" },
      },
    });
    if (!created) throw new Error("story creation failed");

    const result = await caller.storyAgent.updateStoryShotFields({
      storyId: created.id,
      stableShotId: "SHOT-0101",
      patch: { cameraMove: "缓慢推进" },
      metadata: {
        durationMs: 4200,
        promptOverride: {
          dimension: "genre",
          override: { value: "水彩", weight: 0.9 },
        },
        promptRun: {
          finalPrompt: "窗边人物，水彩质感",
          generatedAt: 123,
          imageId: 99,
          source: "prompt-table-rerender",
          usedDimensions: ["subject", "genre"],
        },
      },
    });

    expect(result.status).toBe("ok");
    const body = result.story?.body as Record<string, unknown>;
    expect((body.shots as Array<Record<string, unknown>>)[0]).toMatchObject({
      stableShotId: "shot-0101",
      cameraMove: "缓慢推进",
      durationMs: 4200,
      promptOverrides: {
        tone: { value: "暖色", weight: 0.3 },
        genre: { value: "水彩", weight: 0.9 },
      },
      promptRun: { imageId: 99, finalPrompt: "窗边人物，水彩质感" },
    });
    expect((body.shots as Array<Record<string, unknown>>)[1]).toMatchObject({
      stableShotId: "shot-0102",
      subject: "兄弟镜头",
    });
    expect(body.timeline).toEqual({ version: 4 });
    expect(body.publishing).toEqual({ activeVersionId: "v2" });
  });

  it("does not allow another user to patch the story", async () => {
    const owner = appRouter.createCaller(context(612));
    const intruder = appRouter.createCaller(context(613));
    const created = await owner.storyAgent.storyUpsert({
      title: "Private story",
      body: {
        shots: [{ stableShotId: "private-shot", shotNo: 1 }],
      },
    });
    if (!created) throw new Error("story creation failed");

    await expect(
      intruder.storyAgent.updateStoryShotFields({
        storyId: created.id,
        stableShotId: "private-shot",
        patch: { cameraMove: "should not persist" },
      })
    ).resolves.toEqual({ status: "error", error: "故事不存在" });
  });

  it("versions script, image, and video columns independently and restores an old column", async () => {
    const caller = appRouter.createCaller(context(614));
    const created = await caller.storyAgent.storyUpsert({
      title: "Versioned storyboard",
      body: {
        shots: [
          {
            stableShotId: "versioned-shot",
            shotIdentity: "versioned-shot",
            shotNo: 1,
            scriptText: "剧本 V1",
            promptDraft: "图片 V1",
            videoPrompt: "视频 V1",
            dialogue: "旁白 V1",
            sound: "雨声 V1",
          },
        ],
      },
    });
    if (!created) throw new Error("story creation failed");

    const edited = await caller.storyAgent.updateStoryShotFields({
      storyId: created.id,
      stableShotId: "versioned-shot",
      patch: { promptDraft: "图片 V2" },
    });
    expect(edited.status).toBe("ok");
    const editedBody = edited.story?.body as Record<string, any>;
    expect(editedBody.storyboardFieldVersions.tracks).toMatchObject({
      scriptText: { currentRevision: 1 },
      promptDraft: { currentRevision: 2 },
      videoPrompt: { currentRevision: 1 },
    });

    const restored = await caller.storyAgent.restoreStoryShotFieldVersion({
      storyId: created.id,
      field: "promptDraft",
      revision: 1,
    });
    expect(restored.status).toBe("ok");
    const restoredBody = restored.story?.body as Record<string, any>;
    expect(restoredBody.shots[0].promptDraft).toBe("图片 V1");
    expect(
      restoredBody.storyboardFieldVersions.tracks.promptDraft.currentRevision
    ).toBe(3);

    const voiceEdited = await caller.storyAgent.updateStoryShotFields({
      storyId: created.id,
      stableShotId: "versioned-shot",
      patch: { sound: "风声 V2" },
    });
    expect(voiceEdited.status).toBe("ok");
    const voiceBody = voiceEdited.story?.body as Record<string, any>;
    expect(
      voiceBody.storyboardFieldVersions.tracks.dialogue.currentRevision
    ).toBe(2);
    const voiceRestored = await caller.storyAgent.restoreStoryShotFieldVersion({
      storyId: created.id,
      field: "dialogue",
      revision: 1,
    });
    expect(voiceRestored.status).toBe("ok");
    expect(
      (voiceRestored.story?.body as Record<string, any>).shots[0]
    ).toMatchObject({ dialogue: "旁白 V1", sound: "雨声 V1" });
  });
});

describe("storyAgent.generateStoryShotVoice", () => {
  it("generates narration through 302 and saves audio metadata on the latest shot", async () => {
    ENV.api302Key = "test-302-key";
    ENV.tts302Provider = "openai";
    ENV.tts302Voice = "alloy";
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            audio_url: "https://file.302.ai/voice/shot-0101.mp3",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
    );
    vi.stubGlobal("fetch", fetch);
    const caller = appRouter.createCaller(context(614));
    const created = await caller.storyAgent.storyUpsert({
      title: "Voice storyboard",
      body: {
        shots: [
          {
            stableShotId: "voice-shot",
            shotIdentity: "voice-shot",
            shotNo: 1,
            scriptText: "文字稿原文",
            dialogue: "",
          },
        ],
      },
    });
    if (!created) throw new Error("story creation failed");

    const result = await caller.storyAgent.generateStoryShotVoice({
      storyId: created.id,
      stableShotId: "voice-shot",
      text: "文字稿原文",
    });

    expect(result.status).toBe("ok");
    expect(fetch).toHaveBeenCalledTimes(1);
    const request = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
    expect(request).toEqual({
      text: "文字稿原文",
      provider: "openai",
      voice: "alloy",
    });
    const body = result.story?.body as Record<string, any>;
    expect(body.shots[0]).toMatchObject({
      dialogue: "文字稿原文",
      voiceAudioUrl: "https://file.302.ai/voice/shot-0101.mp3",
      voiceAudioText: "文字稿原文",
      voiceAudioProvider: "openai",
      voiceAudioVoice: "alloy",
    });
    expect(body.storyboardFieldVersions.tracks.dialogue.currentRevision).toBe(
      2
    );
  });

  it("reuses matching saved audio instead of charging 302 again", async () => {
    ENV.api302Key = "test-302-key";
    ENV.tts302Provider = "openai";
    ENV.tts302Voice = "alloy";
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ audio_url: "https://file.302.ai/voice/reused.mp3" }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
    );
    vi.stubGlobal("fetch", fetch);
    const caller = appRouter.createCaller(context(619));
    const created = await caller.storyAgent.storyUpsert({
      title: "Reusable voice",
      body: {
        shots: [
          {
            stableShotId: "reusable-voice-shot",
            shotIdentity: "reusable-voice-shot",
            shotNo: 1,
            dialogue: "相同旁白",
          },
        ],
      },
    });
    if (!created) throw new Error("story creation failed");

    const input = {
      storyId: created.id,
      stableShotId: "reusable-voice-shot",
      text: "相同旁白",
    } as const;
    const first = await caller.storyAgent.generateStoryShotVoice(input);
    const second = await caller.storyAgent.generateStoryShotVoice(input);

    expect(first.status).toBe("ok");
    expect(second).toMatchObject({
      status: "ok",
      audioUrl: "https://file.302.ai/voice/reused.mp3",
      provider: "openai",
      voice: "alloy",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent matching requests into one paid TTS call", async () => {
    ENV.api302Key = "test-302-key";
    ENV.tts302Provider = "openai";
    ENV.tts302Voice = "alloy";
    let release!: () => void;
    const blocked = new Promise<void>(resolve => {
      release = resolve;
    });
    let started!: () => void;
    const didStart = new Promise<void>(resolve => {
      started = resolve;
    });
    const fetch = vi.fn(async () => {
      started();
      await blocked;
      return new Response(
        JSON.stringify({
          audio_url: "https://file.302.ai/voice/coalesced.mp3",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetch);
    const caller = appRouter.createCaller(context(620));
    const created = await caller.storyAgent.storyUpsert({
      title: "Concurrent matching voice",
      body: {
        shots: [
          {
            stableShotId: "coalesced-voice-shot",
            shotIdentity: "coalesced-voice-shot",
            shotNo: 1,
            dialogue: "同一段旁白",
          },
        ],
      },
    });
    if (!created) throw new Error("story creation failed");
    const input = {
      storyId: created.id,
      stableShotId: "coalesced-voice-shot",
      text: "同一段旁白",
    } as const;

    const first = caller.storyAgent.generateStoryShotVoice(input);
    await didStart;
    const second = caller.storyAgent.generateStoryShotVoice(input);
    release();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult.status).toBe("ok");
    expect(secondResult.status).toBe("ok");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps the newer TTS request when an older request finishes last", async () => {
    ENV.api302Key = "test-302-key";
    ENV.tts302Provider = "openai";
    ENV.tts302Voice = "alloy";
    let releaseOlder!: () => void;
    const olderBlocked = new Promise<void>(resolve => {
      releaseOlder = resolve;
    });
    let olderStarted!: () => void;
    const didStartOlder = new Promise<void>(resolve => {
      olderStarted = resolve;
    });
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      if (request.text === "较早旁白") {
        olderStarted();
        await olderBlocked;
        return new Response(
          JSON.stringify({ audio_url: "https://file.302.ai/voice/older.mp3" }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ audio_url: "https://file.302.ai/voice/newer.mp3" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetch);
    const caller = appRouter.createCaller(context(621));
    const created = await caller.storyAgent.storyUpsert({
      title: "Latest voice request wins",
      body: {
        shots: [
          {
            stableShotId: "latest-voice-shot",
            shotIdentity: "latest-voice-shot",
            shotNo: 1,
            dialogue: "较早旁白",
          },
        ],
      },
    });
    if (!created) throw new Error("story creation failed");

    const older = caller.storyAgent.generateStoryShotVoice({
      storyId: created.id,
      stableShotId: "latest-voice-shot",
      text: "较早旁白",
    });
    await didStartOlder;
    const newer = await caller.storyAgent.generateStoryShotVoice({
      storyId: created.id,
      stableShotId: "latest-voice-shot",
      text: "较新旁白",
    });
    releaseOlder();
    const olderResult = await older;

    expect(newer.status).toBe("ok");
    expect(olderResult.status).toBe("ok");
    expect(fetch).toHaveBeenCalledTimes(2);
    const body = olderResult.story?.body as Record<string, any>;
    expect(body.shots[0]).toMatchObject({
      dialogue: "较新旁白",
      voiceAudioUrl: "https://file.302.ai/voice/newer.mp3",
      voiceAudioText: "较新旁白",
    });
  });

  it("keeps reusable audio for the latest dialogue when an older request finishes", async () => {
    ENV.api302Key = "test-302-key";
    ENV.tts302Provider = "openai";
    ENV.tts302Voice = "alloy";
    let releaseOlder!: () => void;
    const olderBlocked = new Promise<void>(resolve => {
      releaseOlder = resolve;
    });
    let olderStarted!: () => void;
    const didStartOlder = new Promise<void>(resolve => {
      olderStarted = resolve;
    });
    const fetch = vi.fn(async () => {
      olderStarted();
      await olderBlocked;
      return new Response(
        JSON.stringify({ audio_url: "https://file.302.ai/voice/older-again.mp3" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetch);
    const caller = appRouter.createCaller(context(622));
    const created = await caller.storyAgent.storyUpsert({
      title: "Reusable latest voice wins",
      body: {
        shots: [
          {
            stableShotId: "reusable-latest-voice-shot",
            shotIdentity: "reusable-latest-voice-shot",
            shotNo: 1,
            dialogue: "较新旁白",
            voiceAudioUrl: "https://file.302.ai/voice/reusable-newer.mp3",
            voiceAudioText: "较新旁白",
            voiceAudioProvider: "openai",
            voiceAudioVoice: "alloy",
          },
        ],
      },
    });
    if (!created) throw new Error("story creation failed");

    const older = caller.storyAgent.generateStoryShotVoice({
      storyId: created.id,
      stableShotId: "reusable-latest-voice-shot",
      text: "较早旁白",
    });
    await didStartOlder;
    const reused = await caller.storyAgent.generateStoryShotVoice({
      storyId: created.id,
      stableShotId: "reusable-latest-voice-shot",
      text: "较新旁白",
    });
    releaseOlder();
    const olderResult = await older;

    expect(reused.status).toBe("ok");
    expect(fetch).toHaveBeenCalledTimes(1);
    const body = olderResult.story?.body as Record<string, any>;
    expect(body.shots[0]).toMatchObject({
      dialogue: "较新旁白",
      voiceAudioUrl: "https://file.302.ai/voice/reusable-newer.mp3",
      voiceAudioText: "较新旁白",
    });
  });

  it("checks ownership and shot identity before calling the paid provider", async () => {
    ENV.api302Key = "test-302-key";
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const owner = appRouter.createCaller(context(614));
    const intruder = appRouter.createCaller(context(617));
    const created = await owner.storyAgent.storyUpsert({
      title: "Private voice",
      body: {
        shots: [
          {
            stableShotId: "private-voice-shot",
            shotIdentity: "private-voice-shot",
            shotNo: 1,
          },
        ],
      },
    });
    if (!created) throw new Error("story creation failed");

    await expect(
      intruder.storyAgent.generateStoryShotVoice({
        storyId: created.id,
        stableShotId: "private-voice-shot",
        text: "不应生成",
      })
    ).resolves.toEqual({ status: "error", error: "故事不存在" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("preserves a newer dialogue edit made while TTS is still running", async () => {
    ENV.api302Key = "test-302-key";
    ENV.tts302Provider = "openai";
    ENV.tts302Voice = "alloy";
    let release!: () => void;
    const blocked = new Promise<void>(resolve => {
      release = resolve;
    });
    let started!: () => void;
    const didStart = new Promise<void>(resolve => {
      started = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        started();
        await blocked;
        return new Response(
          JSON.stringify({
            audio_url: "https://file.302.ai/voice/old-text.mp3",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      })
    );
    const caller = appRouter.createCaller(context(618));
    const created = await caller.storyAgent.storyUpsert({
      title: "Concurrent voice edit",
      body: {
        shots: [
          {
            stableShotId: "concurrent-voice-shot",
            shotIdentity: "concurrent-voice-shot",
            shotNo: 1,
            dialogue: "旧旁白",
          },
        ],
      },
    });
    if (!created) throw new Error("story creation failed");

    const generation = caller.storyAgent.generateStoryShotVoice({
      storyId: created.id,
      stableShotId: "concurrent-voice-shot",
      text: "旧旁白",
    });
    await didStart;
    await caller.storyAgent.updateStoryShotFields({
      storyId: created.id,
      stableShotId: "concurrent-voice-shot",
      patch: { dialogue: "用户刚改的新旁白" },
    });
    release();

    const result = await generation;
    expect(result.status).toBe("ok");
    const body = result.story?.body as Record<string, any>;
    expect(body.shots[0]).toMatchObject({
      dialogue: "用户刚改的新旁白",
      voiceAudioText: "旧旁白",
      voiceAudioUrl: "https://file.302.ai/voice/old-text.mp3",
    });
  });
});
