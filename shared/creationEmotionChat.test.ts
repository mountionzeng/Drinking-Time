import { describe, expect, it } from "vitest";
import { parseCreationEmotionChat } from "./creationEmotionChat";
describe("explicit work emotion routing", () => {
  it.each([
    [
      "把作品情绪设为：有一点失落，但并不绝望，最后慢慢释怀。",
      undefined,
      "有一点失落，但并不绝望，最后慢慢释怀。",
    ],
    ["我希望这个故事的情绪是温暖怀念", undefined, "温暖怀念"],
    [
      "把第01镜情绪改为：压抑不安，但音乐轻快反衬",
      1,
      "压抑不安，但音乐轻快反衬",
    ],
    [
      "把作品情绪改成温暖；画面留白，音乐重新生成时更舒缓",
      undefined,
      "温暖；画面留白，音乐重新生成时更舒缓",
    ],
  ])("keeps %s in the local intention path", (text, shotNo, raw) => {
    expect(parseCreationEmotionChat(text)).toEqual({
      action: "set",
      ...(shotNo ? { shotNo } : {}),
      raw,
    });
  });
  it("recognizes shot history without treating it as a generation command", () => {
    expect(parseCreationEmotionChat("查看第01镜情绪历史")).toEqual({
      action: "show",
      shotNo: 1,
    });
    expect(parseCreationEmotionChat("查看作品情绪")).toEqual({
      action: "show",
    });
  });
  it.each([
    "我今天很失落",
    "把音乐音量调低",
    "生成两张图片",
    "如果把作品情绪改为快乐会怎样？",
    "别把作品情绪设为悲伤",
  ])("does not commit personal, ordinary or hypothetical input: %s", text => {
    expect(parseCreationEmotionChat(text)).toBeNull();
  });
});
