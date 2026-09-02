import { describe, expect, it } from "vitest";

import {
  parseChatImageLocalEditInstruction,
  rotateTimelineImage180,
} from "./chatImageLocalEdit";

describe("chat image local edits", () => {
  it("recognizes a combined rotate and OCR instruction", () => {
    expect(
      parseChatImageLocalEditInstruction("把这张图倒过来，然后再提取这张图的文字")
    ).toEqual({ rotate180: true, extractText: true });
  });

  it("does not intercept a generative image edit", () => {
    expect(
      parseChatImageLocalEditInstruction("把图里的人换成穿红衣服的女性")
    ).toBeNull();
  });

  it("toggles an upside-down image without exceeding transform bounds", () => {
    expect(rotateTimelineImage180(0)).toBe(180);
    expect(rotateTimelineImage180(180)).toBe(0);
    expect(rotateTimelineImage180(-90)).toBe(90);
  });
});
