import { expect, it } from "vitest";
import {
  requestedShots,
  comparisonIntent,
  comparisonPair,
  pictureOnlyQuestion,
  pictureFollowup,
  requestsWrittenStoryboard,
  trialChatAction,
  trialChoice,
} from "./storyboardTrial";
import type { ConversionDraft } from "./bookWorkflow";
it("resolves ordinal shots and continuous ranges across a full reading", () => {
  expect(requestedShots("第03镜至第五镜，再调整第09镜", 10)).toEqual([
    3, 4, 5, 9,
  ]);
  expect(requestedShots("结尾放慢", 10)).toEqual([10]);
  expect(() => requestedShots("改第11镜", 10)).toThrow();
});
it("separates reading, revision, comparison and production", () => {
  expect(trialChatAction("把刚才试的几处串成全片文字。", true)).toBe("read");
  expect(trialChatAction("第04镜先看见这几个字，过一秒再听旁白。", false)).toBe(
    "write"
  );
  expect(trialChatAction("我喜欢这版", true)).toBeUndefined();
  expect(trialChatAction("生成视频", true)).toBeUndefined();
  expect(comparisonIntent("对比一下两个结尾")).toBe("endings");
  expect(requestsWrittenStoryboard("把刚才聊的整理成一份全片分镜稿")).toBe(
    true
  );
});
it("opens exactly the named review, with no implicit adoption", () => {
  const a = {
    status: "review",
    trial: { label: "全片 · 结尾 A｜留在今天" },
  } as ConversionDraft;
  const b = {
    status: "review",
    trial: { label: "全片 · 结尾 B｜合影" },
  } as ConversionDraft;
  expect(trialChoice("先试B，底稿保留。", [a, b])).toBe(b);
  expect(trialChoice("试B", [a, b, b])).toBeUndefined();
});

it("compares the named endings even while reading an unrelated revision of A",()=>{
  const a={id:"a", status:"review",trial:{label:"结尾 A｜步道",base:"import"}} as ConversionDraft;
  const b={id:"b", status:"review",trial:{label:"结尾 B｜合影",base:"import"}} as ConversionDraft;
  const edit={id:"edit", status:"review",trial:{label:"改第四镜的运镜",base:"a"}} as ConversionDraft;
  const candidates=[a, b, edit];
  expect(comparisonPair(comparisonIntent("比较两个结尾")!,candidates,edit)).toEqual([a,b]);
  expect(comparisonPair(comparisonIntent("A 和 B 有什么区别？")!,candidates,edit)).toEqual([a,b]);
  expect(comparisonPair(comparisonIntent("我刚才改了什么？")!,candidates,edit)).toEqual([a,edit]);
  expect(comparisonPair("endings",[a,edit,{...edit,id:"other"}],edit)).toEqual([]);
  expect(comparisonPair("endings", [a, edit], edit)).toEqual([]);
  expect(comparisonPair("pair", candidates, edit)).toEqual([a, edit]);
  expect(comparisonPair("parent", candidates, {...edit, trial:{...edit.trial!, baseRevision: 7}})).toEqual([]);
  expect(comparisonIntent("第04镜的旁白改成“我们来比较两个结尾”。")).toBeUndefined();
});
it("carries the ending and author wording across the picture question",()=>{
  const request="只换最后一镜的画面，旁白照旧。";
  expect(pictureOnlyQuestion(request)).toBe("最后一镜");
  expect(pictureOnlyQuestion("最后一镜的画面改成“路边一盏灯”。")).toBeUndefined();
  expect(trialChatAction(request,false)).toBe("write");
  expect(pictureFollowup(request,"“路牌上写着第04镜。”")).toBe("最后一镜的画面换成“路牌上写着第04镜。”，旁白照旧。");
  expect(requestedShots(pictureFollowup(request,"“路牌上写着第04镜。”")!,10)).toEqual([10]);
  expect(pictureFollowup(request,"先不改了")).toBeUndefined();
});
