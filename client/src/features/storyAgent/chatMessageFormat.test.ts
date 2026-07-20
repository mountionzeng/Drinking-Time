import { describe, expect, it } from "vitest";
import { tokenizeChatMessageText } from "./chatMessageFormat";

describe("tokenizeChatMessageText", () => {
  it("renders paired Markdown emphasis without exposing the markers", () => {
    expect(
      tokenizeChatMessageText(
        "这个故事一共分为 **4 幕**。\n**0102 属于第一幕**。",
      ),
    ).toEqual([
      { text: "这个故事一共分为 ", emphasis: false },
      { text: "4 幕", emphasis: true },
      { text: "。\n", emphasis: false },
      { text: "0102 属于第一幕", emphasis: true },
      { text: "。", emphasis: false },
    ]);
  });

  it("keeps unmatched markers as plain text", () => {
    expect(tokenizeChatMessageText("还没写完 **这一句")).toEqual([
      { text: "还没写完 **这一句", emphasis: false },
    ]);
  });
});
