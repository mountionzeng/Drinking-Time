import { describe, expect, it } from "vitest";
import { FIRST_QUESTION, type StoryCard } from "@/features/storyAgent/types";
import {
  buildMobileStoryBody,
  normalizeMobileCards,
  normalizeMobileImages,
  normalizeMobileMessages,
  serializeMobileMessages,
  type GeneratedImageItem,
  type MobileChatMessage,
} from "./types";

describe("mobileChat story body helpers", () => {
  it("序列化消息时保留桌面端可读取的 role/content/timestamp", () => {
    const messages: MobileChatMessage[] = [
      {
        id: "u-1",
        role: "user",
        content: "今天晚风很轻",
        timestamp: 101,
        photoUrl: "data:image/jpeg;base64,abc",
      },
      {
        id: "a-1",
        role: "assistant",
        content: "这可以是一场很安静的开场。",
        timestamp: 102,
        suggestImage: true,
        imagePrompt: "安静晚风，街边灯光",
        imageShotNo: 1,
      },
    ];

    expect(serializeMobileMessages(messages)).toEqual([
      expect.objectContaining({
        role: "user",
        content: "今天晚风很轻",
        timestamp: 101,
        photoUrl: "data:image/jpeg;base64,abc",
      }),
      expect.objectContaining({
        role: "assistant",
        content: "这可以是一场很安静的开场。",
        timestamp: 102,
        imagePrompt: "安静晚风，街边灯光",
      }),
    ]);
  });

  it("hydrate 时保留纯照片用户消息", () => {
    expect(
      normalizeMobileMessages([
        {
          id: "u-photo",
          role: "user",
          content: "",
          photoUrl: "https://example.com/photo.jpg",
          timestamp: 101,
        },
      ])
    ).toEqual([
      expect.objectContaining({
        id: "u-photo",
        role: "user",
        content: "",
        photoUrl: "https://example.com/photo.jpg",
      }),
    ]);
  });

  it("hydrate 时不会重复制造开场白", () => {
    const messages = normalizeMobileMessages([
      {
        id: "first-q",
        role: "assistant",
        content: FIRST_QUESTION,
        timestamp: 100,
      },
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      id: "first-q",
      role: "assistant",
      content: FIRST_QUESTION,
    });
  });

  it("能读取桌面归档的 who/text 消息格式", () => {
    expect(
      normalizeMobileMessages([
        { who: "u", text: "我想继续上次那个故事" },
        { who: "s", text: "我还在，接着说。" },
      ])
    ).toEqual([
      expect.objectContaining({
        role: "user",
        content: "我想继续上次那个故事",
      }),
      expect.objectContaining({
        role: "assistant",
        content: "我还在，接着说。",
      }),
    ]);
  });

  it("构建 body 时写入 cards/messages/mobileImages", () => {
    const cards: StoryCard[] = [
      {
        id: "card-1",
        title: "路边",
        content: "路边停了一会儿",
        emotion: "quiet",
        sensoryDetails: [],
        createdAt: 100,
      },
    ];
    const images: GeneratedImageItem[] = [
      {
        id: 7,
        imageUrl: "https://example.com/image.jpg",
        prompt: "路边灯光",
        storyId: 9,
        status: "ready",
      },
    ];
    const body = buildMobileStoryBody(
      [{ id: "u-1", role: "user", content: "路边", timestamp: 99 }],
      cards,
      images
    );

    expect(normalizeMobileCards(body.cards)).toHaveLength(1);
    expect(normalizeMobileMessages(body.messages)).toEqual([
      expect.objectContaining({ role: "user", content: "路边", timestamp: 99 }),
    ]);
    expect(normalizeMobileImages(body.mobileImages)).toEqual([
      expect.objectContaining({ id: 7, storyId: 9, status: "ready" }),
    ]);
  });
});
