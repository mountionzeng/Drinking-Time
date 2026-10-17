import { describe, expect, it } from "vitest";
import { creativeVersionIntent } from "./creativeVersionIntent";
import { creationFlowIntentAllows, isCreationFlowRequest } from "./creationFlowCommand";

describe("creative version intent", () => {
  it.each(["加一句话", "图片暖一点", "视频加旁白", "不要另做一版，直接改", "我昨天看了另一版电影"])("keeps ordinary edits and recollection out of branching: %s", text => {
    expect(creativeVersionIntent(text)).toBeNull();
  });
  it.each(["再来一个搞笑版，原来的保留", "保留原版，再写一版温柔的", "用文字版本2再做一个版本，原版留着"])("recognizes explicit alternatives: %s", text => {
    expect(creativeVersionIntent(text)).toBe("fork");
    expect(isCreationFlowRequest(text)).toBe(true);
    expect(creationFlowIntentAllows({type:"forkDraft", draft:"$current", instruction:text}, text)).toBe(true);
  });
  it("clarifies ambiguous style changes without granting generation permission", () => {
    expect(creativeVersionIntent("换个感觉")).toBe("clarify");
    expect(creationFlowIntentAllows({type:"forkDraft", draft:"$current", instruction:""}, "加一句话")).toBe(false);
  });
});
