import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage, SelectionState } from "./types";
import type { StoryIntent } from "./intentTypes";
import StoryAgentChat from "./views/StoryAgentChat";

vi.stubGlobal("React", React);

const fixtures = vi.hoisted(() => {
  const openingMessage: ChatMessage = {
    id: "first-question",
    role: "assistant",
    content: "你好，我是聊聊。",
    timestamp: 1,
  };
  const jobIntent: StoryIntent = {
    purpose: "linkedin_job_search",
    audience: "recruiters",
    platform: "linkedin",
    desiredEffect: "让招聘者看见竞争力",
    tone: "清晰、专业",
    confidence: 0.72,
    missingQuestion: "",
  };
  const fictionIntent: StoryIntent = {
    purpose: "fiction",
    audience: "public",
    platform: "presentation",
    desiredEffect: "把一句虚构灵感发展成一个能拍的短片故事",
    tone: "有世界感、有人物动机、带一点电影气质",
    confidence: 0.74,
    missingQuestion: "",
  };
  return {
    openingMessage,
    jobIntent,
    fictionIntent,
    chatContextState: {
      messages: [
        openingMessage,
        {
          id: "user-1",
          role: "user" as const,
          content: "想做找工作的片子",
          timestamp: 2,
        },
      ],
      cards: [],
      isReplying: false,
      sendMessage: vi.fn(),
      resetConversation: vi.fn(),
      renameStory: vi.fn(),
      backToList: vi.fn(),
      activeStoryId: -1,
      remoteStoryId: undefined as number | undefined,
      storyTitle: "月亮掉进菜市场",
      storyLogline: "一个虚构故事草稿",
      storyShotsCount: 0,
      saveStatus: "idle",
      lastSavedAt: undefined as number | undefined,
      returningGreeting: null as string | null,
      confirmedIntent: null as StoryIntent | null,
      pendingIntentDraft: jobIntent as StoryIntent | null,
      confirmPendingIntent: vi.fn(),
      dismissPendingIntent: vi.fn(),
      activeSelection: null as SelectionState | null,
      clearSelection: vi.fn(),
      sendSelectionEdit: vi.fn(),
    },
  };
});

describe("StoryAgentContext background intent recognition", () => {
  it("keeps listening through a short uncertain opening", async () => {
    const { shouldTriggerIntentRecognition } = await import(
      "./StoryAgentContext"
    );

    expect(
      shouldTriggerIntentRecognition({
        messages: [fixtures.openingMessage],
        confirmedIntent: null,
        pendingIntentDraft: null,
      })
    ).toBe(true);

    expect(
      shouldTriggerIntentRecognition({
        messages: [
          fixtures.openingMessage,
          {
            id: "user-1",
            role: "user",
            content: "我想做找工作的片子",
            timestamp: 2,
          },
        ],
        confirmedIntent: null,
        pendingIntentDraft: null,
      })
    ).toBe(true);
  });

  it("does not trigger after a confirmed purpose or while a soft-confirm draft exists", async () => {
    const { shouldTriggerIntentRecognition } = await import(
      "./StoryAgentContext"
    );

    expect(
      shouldTriggerIntentRecognition({
        messages: [fixtures.openingMessage],
        confirmedIntent: { ...fixtures.jobIntent, status: "confirmed" },
        pendingIntentDraft: null,
      })
    ).toBe(false);
    expect(
      shouldTriggerIntentRecognition({
        messages: [fixtures.openingMessage],
        confirmedIntent: null,
        pendingIntentDraft: fixtures.jobIntent,
      })
    ).toBe(false);
  });

  it("turns high-confidence job-search recognition into a soft-confirm draft", async () => {
    const { recognitionToPendingIntent, recognitionToPendingJobIntent } =
      await import("./StoryAgentContext");

    expect(recognitionToPendingIntent(fixtures.jobIntent)).toEqual(
      fixtures.jobIntent
    );
    expect(recognitionToPendingJobIntent(fixtures.jobIntent)).toEqual(
      fixtures.jobIntent
    );
  });

  it("turns high-confidence fiction recognition into a soft-confirm draft", async () => {
    const { recognitionToPendingIntent, recognitionToPendingJobIntent } =
      await import("./StoryAgentContext");

    expect(recognitionToPendingIntent(fixtures.fictionIntent)).toEqual(
      fixtures.fictionIntent
    );
    expect(recognitionToPendingJobIntent(fixtures.fictionIntent)).toBeNull();
  });

  it("soft-confirms the other three top-level intent lanes", async () => {
    const { recognitionToPendingIntent } = await import("./StoryAgentContext");

    for (const purpose of [
      "personal_memory",
      "gift",
      "social_post",
      "portfolio",
    ]) {
      expect(
        recognitionToPendingIntent({
          purpose,
          audience: purpose === "personal_memory" ? "self" : "public",
          platform: "presentation",
          confidence: 0.8,
        })
      ).toMatchObject({ purpose });
    }
  });

  it("stays quiet for low-confidence or unsupported recognition", async () => {
    const { recognitionToPendingIntent } = await import("./StoryAgentContext");

    expect(
      recognitionToPendingIntent({
        ...fixtures.jobIntent,
        confidence: 0.59,
      })
    ).toBeNull();
    expect(
      recognitionToPendingIntent({
        ...fixtures.jobIntent,
        purpose: "exploration",
        confidence: 0.95,
      })
    ).toBeNull();
  });

  it("logs recognition failures without throwing into the chat flow", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { warnIntentRecognitionError } = await import("./StoryAgentContext");

    warnIntentRecognitionError(new Error("network down"));

    expect(warnSpy).toHaveBeenCalledWith(
      "[storyAgent.intent] recognizeIntent failed:",
      "network down"
    );
    warnSpy.mockRestore();
  });
});

vi.mock("@/features/storyAgent/StoryAgentContext", async importOriginal => {
  const actual = await importOriginal<typeof import("./StoryAgentContext")>();
  return {
    ...actual,
    useStoryAgent: () => fixtures.chatContextState,
    useStoryAgentActions: () => fixtures.chatContextState,
  };
});

vi.mock("@/features/storyAgent/spine/selectors", async importOriginal => {
  const actual = await importOriginal<typeof import("./spine/selectors")>();
  return {
    ...actual,
    useStoryAgentChatSlice: () => ({
      messages: fixtures.chatContextState.messages,
      cardRefs: fixtures.chatContextState.cards,
      isReplying: fixtures.chatContextState.isReplying,
      activeStoryId: fixtures.chatContextState.activeStoryId,
      remoteStoryId: fixtures.chatContextState.remoteStoryId,
      storyTitle: fixtures.chatContextState.storyTitle,
      storyLogline: fixtures.chatContextState.storyLogline,
      storyShotsCount: fixtures.chatContextState.storyShotsCount,
      saveStatus: fixtures.chatContextState.saveStatus,
      lastSavedAt: fixtures.chatContextState.lastSavedAt,
      returningGreeting: fixtures.chatContextState.returningGreeting,
      confirmedIntent: fixtures.chatContextState.confirmedIntent,
      pendingIntentDraft: fixtures.chatContextState.pendingIntentDraft,
      activeSelection: fixtures.chatContextState.activeSelection,
    }),
  };
});

vi.mock("@/features/nayin/NayinContext", () => ({
  useNayin: () => ({ element: "fire" }),
}));

vi.mock("@/features/nayin/views/EmotiveWuxingIcon", () => ({
  default: () => <span data-testid="wuxing-icon" />,
}));

vi.mock("@/features/storyAgent/hooks/useVoiceInput", () => ({
  useVoiceInput: () => ({
    isBusy: false,
    isRecording: false,
    isTranscribing: false,
    toggleRecording: vi.fn(),
  }),
}));

describe("StoryAgentChat intent soft confirm", () => {
  beforeEach(() => {
    fixtures.chatContextState.pendingIntentDraft = fixtures.jobIntent;
    fixtures.chatContextState.confirmedIntent = null;
    fixtures.chatContextState.isReplying = false;
    fixtures.chatContextState.activeSelection = null;
  });

  it("renders the reflect-back bubble when a pending job intent exists", () => {
    const html = renderToStaticMarkup(<StoryAgentChat />);

    expect(html).toContain("听起来你是想做求职片");
    expect(html).toContain("对，按求职片来");
    expect(html).toContain("先不，继续聊");
  });

  it("renders the world-building reflect-back bubble when a pending fiction intent exists", () => {
    fixtures.chatContextState.pendingIntentDraft = fixtures.fictionIntent;

    const html = renderToStaticMarkup(<StoryAgentChat />);

    expect(html).toContain("听起来你是想创造一个虚构故事世界");
    expect(html).toContain("对，创造另一个世界");
    expect(html).toContain("先不，继续聊");
    expect(html).not.toContain("招聘者");
  });

  it("does not render the bubble while the assistant is replying", () => {
    fixtures.chatContextState.isReplying = true;

    expect(renderToStaticMarkup(<StoryAgentChat />)).not.toContain(
      "听起来你是想做求职片"
    );
  });

  it("keeps the left chat anchored to the current story and right-side selection", () => {
    fixtures.chatContextState.pendingIntentDraft = null;
    fixtures.chatContextState.confirmedIntent = fixtures.fictionIntent;
    fixtures.chatContextState.storyShotsCount = 3;
    fixtures.chatContextState.activeSelection = {
      sourceType: "shot",
      sourceId: "0:intent",
      selectedText: "月亮掉进菜市场",
      fullText: "月亮掉进菜市场",
      shotNo: 1,
      stableShotId: "shot-1",
      storyId: 46,
    };
    const html = renderToStaticMarkup(<StoryAgentChat />);

    expect(html).toContain("当前故事");
    expect(html).toContain("虚构故事");
    expect(html).toContain("月亮掉进菜市场");
    expect(html).toContain('aria-label="修改故事名称"');
    expect(html).toContain("01 · 镜头意图");
    expect(html).toContain("下一条消息会带着这个选区交给聊聊");
    expect(html).toContain("告诉聊聊这处想怎么改");
  });
});
