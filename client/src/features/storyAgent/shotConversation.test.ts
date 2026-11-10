import { describe, expect, it } from "vitest";
import {
  shotConversationMessages,
  resolveConversationShot,
  shotConversationSelection,
  shotConversationImages,
} from "./shotConversation";
const shots = [
  { stableShotId: "a", shotNo: 1 },
  { stableShotId: "b", shotNo: 2 },
];
describe("shot conversation", () => {
  it("resolves explicit Chinese and English shot references without a click", () => {
    for (const text of [
      "第二个镜头的音乐怎么改？",
      "第02镜画面亮一点",
      "shot 2 music quieter",
    ])
      expect(resolveConversationShot(text, shots)?.stableShotId).toBe("b");
    expect(
      resolveConversationShot("第一镜和第二镜都要改", shots)
    ).toBeUndefined();
    expect(resolveConversationShot("第99镜音乐", shots)).toBeUndefined();
  });
  it("selects a shot without automatically selecting its main image", () => {
    expect(shotConversationSelection(1, shots[0])).toMatchObject({
      sourceType: "shot",
      stableShotId: "a",
      storyId: 1,
    });
    expect(shotConversationSelection(1, shots[0]).imageId).toBeUndefined();
  });
  it("includes both sides of a bound turn and stops inheriting at the next user turn", () => {
    const messages = [
      {
        id: "1",
        role: "user",
        content: "change",
        selectionQuote: { storyId: 1, stableShotId: "a" },
      },
      { id: "2", role: "assistant", content: "done" },
      { id: "3", role: "user", content: "other" },
      { id: "4", role: "assistant", content: "other reply" },
      {
        id: "5",
        role: "user",
        content: "foreign",
        selectionQuote: { storyId: 2, stableShotId: "a" },
      },
      { id: "6", role: "assistant", content: "foreign reply" },
    ];
    expect(shotConversationMessages(messages, 1, "a").map(m => m.id)).toEqual([
      "1",
      "2",
    ]);
  });
  it("shows originals, rejected candidates, descendants and explicit related assets without cross-shot leakage", () => {
    const images = [
      { id: 1, shotIdentity: "a", imageUrl: "/1" },
      { id: 2, parentImageId: 1, imageUrl: "/2", status: "rejected" },
      { id: 3, shotIdentity: "b", imageUrl: "/3" },
      { id: 4, shotIdentity: "b", imageUrl: "/4" },
    ];
    expect(shotConversationImages(images, "a", [4]).map(i => i.id)).toEqual([
      1, 2, 4,
    ]);
  });
});

it("retrieves explicit legacy mentions without overriding saved stable identity", () => {
  const messages = [
    { id: "legacy", role: "user", content: "第02镜生成图片" },
    { id: "reply", role: "assistant", content: "done" },
    {
      id: "stable",
      role: "user",
      content: "第02镜修改",
      selectionQuote: { storyId: 1, stableShotId: "a" },
    },
    { id: "stable-reply", role: "assistant", content: "done" },
  ];
  expect(
    shotConversationMessages(messages, 1, "b", shots[1]).map(m => m.id)
  ).toEqual(["legacy", "reply"]);
});
