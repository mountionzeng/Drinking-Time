import { expect, it } from "vitest";
import { resolveShotAction, shotActionHeading, shotOutputSource, shotMenuOutputs, shotOutputLabels } from "./bookShotActions";
import { stillVisualDescription } from "./stillVisualDescription";
import { shotDirections, shotMediaDirections } from "./bookShotDocument";

const row = (id: string, text: string, parentId: string | null = "shot") =>
  ({ id, text, parentId, format: parentId ? "text" : "shot" });
const shot = row("shot", "开场", null);

it("offers five manuscript actions and projects one still without changing its source", () => {
  const mixed = "画面提示词：第10秒，从合影直接切到城墙画面，缓缓推近。按全片时间试排，字幕在10.5—11秒淡入，11—15秒完整停留。配音后可调整。";
  const rows = [shot, row("p", mixed), row("sub", "屏幕文字：九月十八日"), row("s", "音效提示词：轻微风声")];
  expect(shotMenuOutputs().map(kind=>shotOutputLabels[kind].name)).toEqual(["画面描述","视频","字幕","台词","音乐"]);
  expect(resolveShotAction(rows, 1)).toMatchObject({prompt:"城墙画面",parts:[{text:mixed}]});
  expect(shotOutputSource(rows, 0, "image")?.prompt).toBe("城墙画面");
  expect(shotOutputSource(rows, 0, "video")?.prompt).toContain("从合影直接切到城墙画面，缓缓推近");
  expect(shotOutputSource(rows, 0, "subtitle")?.prompt).toBe("九月十八日");
  expect(shotOutputSource(rows, 0, "music")?.prompt).not.toContain("风声");
  expect(stillVisualDescription("第5秒，缓慢推近。字幕淡入。")).toBe("");
  expect(stillVisualDescription("近景，孩子双手推开窗户。纸上写着“第10秒，缓缓推近”。")).toBe("近景，孩子双手推开窗户。纸上写着“第10秒，缓缓推近”。");
  expect(stillVisualDescription("画面提示词：纸船，运镜提示词：慢推。\n旁白\n天亮了。\n画面描述：船边有水草")).toBe("纸船\n船边有水草");
});

it("keeps the timing in the heading and takes only the lines to speak", () => {
  const rows = [shot, row("heading", "**旁白｜第 2 秒开口，第 7 秒前收住** \\"), row("one","早。"), row("two","出发吧。"), row("sfx","音效提示词：风声")];
  expect(resolveShotAction(rows,1)).toMatchObject({label:"旁白｜第 2 秒开口，第 7 秒前收住",prompt:"早。\n\n出发吧。",parts:[{id:"one"},{id:"two"}]});
});
it("preserves inline directions and stops at another shot or a dialogue block", () => {
  const rows = [shot,row("image","画面提示词：书页\n纸上有一行字。"),{...row("speech","出发吧。"),videoRole:"dialogue"},row("next","第二镜",null)];
  expect(resolveShotAction(rows,1)?.prompt).toBe("书页\n纸上有一行字。");
  expect(resolveShotAction([shot,row("m","运镜提示词"),row("x","别镜","other")],1)?.prompt).toBe("");
});
it("leaves source and timing headings alone and gives each actionable heading its own render hint", () => {
  for (const text of ["出处：第 268 页","参考素材：书页","时长：10 秒"]) expect(resolveShotAction([shot,row("a",text)],1)).toBeUndefined();
  for (const [heading,name,hint] of [["画面提示词","画面描述","渲染成图片"],["运镜提示词","视频","渲染成视频"],["音效提示词","音效","渲染成音效"],["背景音乐","音乐","渲染成音乐"],["屏幕文字","字幕","生成字幕"],["旁白","台词","生成配音"]]) {
    expect(shotOutputLabels[shotActionHeading(heading)!.output]).toEqual({name,hint});
  }
  expect(shotActionHeading("旁白｜第 2 秒开口")?.detail).toBe("｜第 2 秒开口");
  expect(shotMenuOutputs("sfx").at(-1)).toBe("sfx");
  expect(shotActionHeading("视频：推近")?.output).toBe("video");
  expect(shotActionHeading("字幕：第一天")?.output).toBe("subtitle");
  expect(shotMediaDirections(shotDirections("字幕：\n第一天\n画面描述\n窗边的小狗"),"开场").picture).toBe("窗边的小狗");
});

it("a heading addresses its own words when other fields share the shot",()=>{
  const rows=[shot,row("a","音效提示词：翻页"),row("b","配乐：弦乐"),row("c","环境声：风声"),
    row("d","旁白：出发吧。"),row("e","屏幕文字：「九月」")];
  expect(shotOutputSource(rows,1,"sfx")).toMatchObject({prompt:"翻页",moduleId:"a"});
  expect(shotOutputSource(rows,2,"music")?.prompt).toBe("弦乐");
  expect(shotOutputSource(rows,5,"subtitle")).toMatchObject({prompt:"九月",moduleId:"e"});
  expect(shotOutputSource(rows,0,"subtitle")).toMatchObject({prompt:"出发吧。",moduleId:"shot"});
  const multi=[shot,row("c","屏幕文字：天亮了。人们出发。\n到车站。")];
  for (const index of [0,1]) expect(shotOutputSource(multi,index,"subtitle")?.prompt).toBe("天亮了。人们出发。\n到车站。");
});

it("uses the selected shot for each output and keeps spoken lines separate from sounds",()=>{
  const rows=[shot,row("picture","画面提示词：书页"),row("motion","运镜提示词：向左摇"),row("sound","音效提示词：翻页"),row("music","配乐：弦乐"),row("voice","旁白｜第 2 秒开口"),{...row("line","早安。"),videoRole:"dialogue"},row("next","下镜",null),row("wrong","画面提示词：雪山","next")];
  expect(shotOutputSource(rows,1,"image")?.prompt).toBe("书页");
  expect(shotOutputSource(rows,0,"video")?.prompt).toBe("向左摇");
  expect(shotOutputSource(rows,0,"music")?.prompt).toBe("弦乐");
  expect(shotOutputSource(rows,0,"sfx")?.prompt).toBe("翻页");
  expect(shotOutputSource(rows,0,"subtitle")?.prompt).toBe("早安。");
});
