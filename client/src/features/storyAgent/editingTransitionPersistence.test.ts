import { describe, expect, it } from "vitest";
import { mergeStoryConversationMessages } from "./storyConversationStore";
import {
  normalizeChatMessages,
  type ChatMessage,
  type EditingTransitionCandidateReference,
} from "./types";

function candidate(
  status: EditingTransitionCandidateReference["status"] = "pending"
): EditingTransitionCandidateReference {
  return {
    candidateId: "transition-0123456789abcdef",
    provisionalStableShotId: "transition-shot-0123456789abcdef",
    storyId: 91,
    source: {
      stableShotId: "shot-a",
      shotNo: 1,
      imageId: 101,
      imageUrl: "/api/images/a.png",
    },
    target: {
      stableShotId: "shot-b",
      shotNo: 2,
      imageId: 102,
      imageUrl: "/api/images/b.png",
    },
    instruction: "人物快速转身后接到下一镜",
    prompt: "保持人物、场景和油画风格不变，只做快速转身衔接。",
    durationSec: 2,
    resolution: "720p",
    cutAtSec: 1.4,
    estimatedCredits: 10,
    estimatedCny: 0.35,
    expectedTimelineVersion: 3,
    status,
  };
}

describe("editing transition message persistence", () => {
  it("restores a pending confirmation card from archived story messages", () => {
    const restored = normalizeChatMessages(
      [
        {
          id: "msg-transition",
          who: "s",
          text: "我已锁定 SH01 → SH02。",
          timestamp: 123,
          editingTransitionCandidate: candidate(),
        },
      ],
      []
    );

    expect(restored[0]).toMatchObject({
      id: "msg-transition",
      timestamp: 123,
      editingTransitionCandidate: {
        candidateId: "transition-0123456789abcdef",
        status: "pending",
      },
    });
  });

  it("turns an interrupted generating card into a safe same-task retry", () => {
    const restored = normalizeChatMessages(
      [
        {
          who: "s",
          text: "正在生成",
          editingTransitionCandidate: candidate("generating"),
        },
      ],
      []
    );

    expect(restored[0].editingTransitionCandidate).toMatchObject({
      status: "failed",
      retryable: true,
    });
    expect(restored[0].editingTransitionCandidate?.error).toContain(
      "不会重复提交"
    );
  });

  it("keeps the local confirmation card when conversation rows merge by client id", () => {
    const local: ChatMessage = {
      id: "msg-transition",
      role: "assistant",
      content: "我已锁定 SH01 → SH02。",
      timestamp: 123,
      editingTransitionCandidate: candidate(),
    };
    const merged = mergeStoryConversationMessages({
      current: [local],
      messages: [
        {
          id: 8,
          role: "assistant",
          content: local.content,
          clientMessageId: local.id,
          candidateRevisionId: null,
          createdAt: "2026-07-14T00:00:00.000Z",
        },
      ],
      references: [],
      candidates: [],
    });

    expect(merged).toHaveLength(1);
    expect(merged[0].editingTransitionCandidate).toMatchObject({
      candidateId: "transition-0123456789abcdef",
      status: "pending",
    });
  });
});
