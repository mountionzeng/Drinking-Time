import { describe, expect, it } from "vitest";

import { peekSpeech } from "./workspaceView";

const msg = (role: string, content: string) => ({ role, content });

describe("收起档该露什么", () => {
  // R09：收起档要直接显示真实回答，不是「有新消息」提示。
  it("shows the real latest reply, not a notice", () => {
    const { thinking, reply } = peekSpeech(null, [
      msg("user", "在吗"),
      msg("assistant", "在的，你说。"),
    ]);
    expect(thinking).toBe(false);
    expect(reply).toBe("在的，你说。");
  });

  // R08：等回信期间摆的是「它在想」，不是上一条旧回答——否则分不清新旧。
  it("shows thinking instead of the previous reply while a reply is in flight", () => {
    const { thinking, reply } = peekSpeech("正在回复…", [
      msg("assistant", "上一条旧回答"),
      msg("user", "再问一句"),
    ]);
    expect(thinking).toBe(true);
    expect(reply).toBeNull();
  });

  // 失败或中断后 busy 不再是「正在回复…」，就该退出思考、把能读的回答摆回来。
  it("stops thinking once the request is no longer in flight", () => {
    expect(peekSpeech("保存失败", [msg("assistant", "读得到的回答")])).toEqual({
      thinking: false,
      reply: "读得到的回答",
    });
  });

  it("has nothing to show before 聊聊 has said anything", () => {
    expect(peekSpeech(null, [msg("user", "第一句")])).toEqual({
      thinking: false,
      reply: null,
    });
  });
});
