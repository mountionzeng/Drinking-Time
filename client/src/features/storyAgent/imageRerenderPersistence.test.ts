import { describe, expect, it } from "vitest";
import { normalizeChatMessages, type ChatMessage } from "./types";

describe("storyboard image rerender chat action", () => {
  it("restores the shot identity needed to rerender from a saved chat reply", () => {
    const message: ChatMessage = {
      id: "assistant-rerender",
      role: "assistant",
      content: "图片要求已经符合，可以直接重新渲染。",
      timestamp: 10,
      imageRerenderAction: {
        storyId: 1165,
        stableShotId: "story-1165-shot-0201",
        shotNo: 201,
        cueCode: "0201",
        imageId: 1418,
        instruction: "只把女主的裙子改为白色及地长裙，其余画面不变。",
      },
    };

    expect(normalizeChatMessages([message], [])).toEqual([message]);
  });

  it("keeps older rerender actions compatible when no exact image was saved", () => {
    const [message] = normalizeChatMessages(
      [
        {
          id: "assistant-rerender-legacy",
          role: "assistant",
          content: "可以重新渲染。",
          timestamp: 10,
          imageRerenderAction: {
            storyId: 1165,
            stableShotId: "story-1165-shot-0201",
            shotNo: 201,
            cueCode: "0201",
          },
        },
      ],
      []
    );

    expect(message?.imageRerenderAction).toEqual({
      storyId: 1165,
      stableShotId: "story-1165-shot-0201",
      shotNo: 201,
      cueCode: "0201",
    });
  });

  it("drops malformed rerender metadata without dropping the reply", () => {
    const [message] = normalizeChatMessages(
      [
        {
          id: "assistant-rerender",
          role: "assistant",
          content: "可以重新渲染。",
          timestamp: 10,
          imageRerenderAction: {
            storyId: 1165,
            shotNo: "0201",
          },
        },
      ],
      []
    );

    expect(message?.content).toBe("可以重新渲染。");
    expect(message?.imageRerenderAction).toBeUndefined();
  });
});
