import { expect, it } from "vitest";
import { answeredSeconds, productionKinds, productionTurnHint, readProductionSeconds } from "./bookShotProduction";
import { decideVideoRenderStrategy } from "./videoMotionPolicy";

it("puts duration on the video and treats a cut time, subtitle cue or depicted text as separate information",()=>{
  expect(productionKinds).toEqual(["image","video","music","narration"]);
  for (const cue of ["视频｜10秒：缓缓推近","视频时长：10 秒","时长：十秒","视频（10秒）：固定机位"])
    expect(readProductionSeconds([cue])).toBe(10);
  expect(readProductionSeconds(["画面：钟面写着‘第8秒’","视频：第10秒，从合影切到城墙","字幕｜10–15秒：九月"])).toBeUndefined();
  expect(readProductionSeconds(["时长：5秒","视频时长：10秒"])).toBeUndefined();
  expect(readProductionSeconds(["视频｜10秒：推近","时长：5秒","已确认视频时长：8秒"])).toBe(8);
  expect(answeredSeconds("就用十秒吧")).toBe(10);
  for(const invalid of ["第10秒切","9.5秒","11秒","0秒"]) expect(answeredSeconds(invalid)).toBeUndefined();
});
it("inherits only an attributed user direction for the selected shot and medium",()=>{
  const turns=[{role:"user",content:"第02镜音乐：用单音钢琴"},{role:"assistant",content:"第02镜音乐：改用大鼓"},{role:"user",content:"第03镜音乐：小提琴"}];
  expect(productionTurnHint(turns,2,"music")).toBe("用单音钢琴");
  expect(productionTurnHint(turns,2,"narration")).toBe("");
});
it("can do a static zoom locally while a changing subject or a new angle needs a generated shot",()=>{
  expect(decideVideoRenderStrategy({videoPrompt:"缓缓推近。"})).toMatchObject({strategy:"local-transform",localMotion:{kind:"zoom"}});
  for(const text of ["缓缓推近，孩子跑出门","从合影切到城墙，缓缓推近","手持缓缓推近"]) expect(decideVideoRenderStrategy({videoPrompt:text}).strategy).toBe("paid-302");
});
