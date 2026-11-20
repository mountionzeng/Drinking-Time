import { expect, it, vi } from "vitest";
import { appendCommandConversation } from "./commandConversation";
import type { ChatMessage } from "./types";
const user: ChatMessage = {
  id: "u",
  role: "user",
  content: "open mailbox",
  timestamp: 1,
  interfaceAction: true,
};
const assistant: ChatMessage = {
  id: "a",
  role: "assistant",
  content: "Opening",
  timestamp: 2,
  interfaceAction: true,
};
it("stores a command receipt in its existing story and does not create a story on the selection screen", async () => {
  const append = vi.fn().mockResolvedValue({});
  expect(
    await appendCommandConversation(append, null, user, assistant, null)
  ).toBe(false);
  expect(append).not.toHaveBeenCalled();
  expect(
    await appendCommandConversation(append, 7, user, assistant, null)
  ).toBe(true);
  expect(append).toHaveBeenCalledWith({
    storyId: 7,
    userMessage: {
      clientMessageId: "u",
      content: "open mailbox",
      selection: null,
    },
    assistantMessage: { clientMessageId: "a", content: "Opening" },
  });
});
it("does not retry a completed command when storing its conversation fails", async () => {
  const append = vi.fn().mockRejectedValue(new Error("offline"));
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    expect(
      await appendCommandConversation(append, 7, user, assistant, null)
    ).toBe(false);
    expect(append).toHaveBeenCalledOnce();
  } finally {
    warn.mockRestore();
  }
});

import { insertTurnReply, interruptedChatReply, videoAcknowledgement } from "./commandConversation";

const selectionQuote = { sourceType: "shot" as const, sourceId: "first", stableShotId: "first", storyId: 7, shotNo: 1, selectedText: "第 01 镜" };
const trial = { ...user, selectionQuote, content: "先试算：让第一镜的小茶杯随着第一句台词出现。" };
const result = { ...assistant, content: "试算结果：第 01 镜 · 3.93 秒 → 0.13 秒。" };
const ok = { ...user, id: "ok1", content: "OK", selectionQuote };

it("answers repeated acknowledgements after a preview with the exact edit for the selected shot", () => {
  expect(videoAcknowledgement("OK", [trial, result, ok, { ...ok, id: "ok2" }], 7, "first"))
    .toContain("请发送「让第一镜的小茶杯随着第一句台词出现。」");
});
it("does not revive an old trial across a different selection, story or intervening instruction", () => {
  for (const reply of [
    videoAcknowledgement("好", [trial, result], 7, "second"),
    videoAcknowledgement("OK", [trial, result], 8, "first"),
    videoAcknowledgement("收到", [trial, result, user, ok], 7, "first"),
    videoAcknowledgement("OK", [trial, result, { ...assistant, content: "等待确认报价" }], 7, "first"),
    videoAcknowledgement("OK", [], 7),
  ]) expect(reply).toContain("想改哪个镜头");
  for (const instruction of ["确认并生成", "确认发送", "好了，把画面放慢", "OK，换一张图"]) {
    expect(videoAcknowledgement(instruction, [trial, result], 7, "first")).toBeNull();
  }
});
it("inserts an interruption immediately after its user turn only once, keeping later messages", () => {
  const later = { ...user, id: "later" };
  const messages = [ok, later];
  const receipt = { ...assistant, id: "interrupted:ok1" };
  const output = insertTurnReply(messages, ok, receipt);
  expect(output).toEqual([ok, receipt, later]);
  expect(insertTurnReply(output, ok, receipt)).toBe(output);
  expect(insertTurnReply([later], ok, receipt)).toEqual([later]);
});
it("distinguishes invalid input and login problems from an unconfirmed result, without exposing internal errors", () => {
  expect(interruptedChatReply({ data: { code: "BAD_REQUEST" } })).toContain("校验");
  expect(interruptedChatReply({ data: { code: "UNAUTHORIZED" } })).toContain("登录");
  expect(interruptedChatReply(new Error("upstream private details"))).toContain("执行结果待核对");
  expect(interruptedChatReply(null)).not.toContain("再试");
});

import { wordTimingCommand } from "./commandConversation";
const priorPacing = { ...user, selectionQuote, content: "“yourself”那段还是慢了，句尾可以停顿一段时间。" };
it("executes a follow-up about the picture using the word and pause from the same shot", () => {
  expect(wordTimingCommand("还是慢了， 而且我想改的不是音轨是视频", [priorPacing, assistant], 7, selectionQuote))
    .toMatchObject({word:"yourself", hold:true, shotNo:1});
  expect(wordTimingCommand("还是慢了， 而且我想改的不是音轨是视频", [priorPacing], 8, selectionQuote)).not.toHaveProperty("word");
});
it("keeps feedback and audio edits separate from a current picture edit", () => {
  expect(wordTimingCommand("下次让画面上的“yourself”提前一点", [], 7, selectionQuote)).toHaveProperty("reply");
  expect(wordTimingCommand("把旁白的“yourself”提前", [], 7, selectionQuote)).toBeNull();
  expect(wordTimingCommand("第02镜用 Take #1648，画面上的“yourself”提前，句尾停一下", [], 7))
    .toMatchObject({word:"yourself",hold:true,sourceTakeId:1648,shotNo:2});
});

it("uses the spoken shot number and respects a negated or sound-only instruction", () => {
  expect(wordTimingCommand("第二镜把“yourself”的画面提前", [], 7, selectionQuote)).toMatchObject({shotNo:2});
  expect(wordTimingCommand("这次不要提前“yourself”的画面", [], 7, selectionQuote)).not.toHaveProperty("word");
  expect(wordTimingCommand("把音轨提前，配合画面上的“yourself”", [], 7, selectionQuote)).toBeNull();
});
