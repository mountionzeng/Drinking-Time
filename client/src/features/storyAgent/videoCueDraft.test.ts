import { describe, expect, it } from "vitest";
import { needsObjectOrigin } from "@shared/videoObjectOrigin";
import { cueRanges, retimeCues } from "@shared/videoCueTiming";
import { explicitFirstFrame, priorObjectOrigin, readOriginLine, resizeCueFrames, reviewTakeId } from "./videoCueDraft";
import { cueDurations, cueReferences, cueTarget, cueTranscript, readCueTranscript, currentCueTurn, proposedSeconds, requestsVideoCues, secondDefaults, splitCues } from "./videoCueDraft";

const message = "重新渲染03镜，我喜欢一开始城市的景观，但后续的森林请参考这两张图，另外不要用鼠标出现，只需要有一个纸飞机就好了，如果森林里面可以有一栋小房子最好，时间最好比03镜长一点[[ref:image%3A2122]] [[ref:image%3A2132]]";
describe("chat video cue review", () => {
  it("retimes the author's three actions across ten seconds, preserving the ending", () => {
    const original = ["掠过树林","下降对准入口","穿过门框，收在屋内"];
    const ten = retimeCues(original,10);
    expect(cueRanges(ten)).toEqual([
      {start:0,end:3,text:original[0]}, {start:3,end:7,text:original[1]}, {start:7,end:10,text:original[2]},
    ]);
    expect(retimeCues(ten,3)).toEqual(original);
    const saved = {total:10,lines:ten.join("\n"),ids:[9],singleOpening:true,prompt:"跟拍"};
    const transcript = cueTranscript(saved,saved.ids);
    expect(transcript).toContain("7–10 秒：穿过门框，收在屋内");
    expect(readCueTranscript(transcript)).toEqual(saved);
    expect(readCueTranscript(transcript.replace("3–7 秒","4–7 秒"))).toBeUndefined();
    expect(readCueTranscript(transcript.replace("3–7 秒","3–99 秒"))).toBeUndefined();
    expect(retimeCues(original,1)[0]).toBe(original.join("；"));
    expect(()=>retimeCues(["长".repeat(110),"后".repeat(110)],1)).toThrow("120");
    expect(cueRanges(["飞","飞","转向","飞"]).map(row=>row.text)).toEqual(["飞","转向","飞"]);
  });
  it("keeps frame IDs, palette and exclusions out of the initial timed actions", () => {
    const plan=secondDefaults("从 #2122 接第 03 镜收尾。飞机飞过树梢。保持折痕、白色和相对大小。树林沿用 #2132 的配色。纸飞机进入小屋。全程避开左缘红色团块。",10);
    expect(cueRanges(plan).map(row=>row.text)).toEqual(["飞机飞过树梢","纸飞机进入小屋"]);
  });
  it("routes the user's unnumbered video correction to the selected shot", () => {
    const correction = "纸飞机是由这个按钮变得，一开始你识别错了，先从新渲染，然后再在系统里面避免识别错误的事情发生";
    expect(requestsVideoCues(correction)).toBe(true);
    expect(cueTarget(correction, [{shotNo:3, stableShotId:"s3"}], "s3")?.shotNo).toBe(3);
    expect(requestsVideoCues("纸飞机是由这个按钮变的，重新渲染图片")).toBe(false);
    expect(requestsVideoCues("纸飞机由按钮变成，先不要重新渲染")).toBe(false);
  });
  it("recognizes one origin transforming and restores the exact bound area with the authored plan", () => {
    expect(needsObjectOrigin("纸飞机是由这个按钮变得")).toBe(true);
    expect(needsObjectOrigin("发送键里的纸飞机从按钮原位飞出")).toBe(true);
    expect(needsObjectOrigin("不要把树变成房子")).toBe(false);
    const objectOrigin={imageId:2135,label:"粉色圆形发送键",rect:{x:.825,y:.575,w:.094,h:.095}};
    const draft={total:1,prompt:"发送键变成纸飞机",ids:[2135,2122],lines:"按钮原位开始变化",objectOrigin};
    expect(readCueTranscript(cueTranscript(draft,draft.ids))).toEqual(draft);
    expect(explicitFirstFrame("图片 #2135 为首帧，图片 #2122 为森林衔接帧")).toBe(2135);
    expect(resizeCueFrames([2135,0,2122],3,2)).toEqual([2135,2122]);
    expect(resizeCueFrames([2135,2122],2,3)).toEqual([2135,0,2122]);
    const notes=[{id:"video-cues:u",role:"assistant",content:cueTranscript(draft,draft.ids),selectionQuote:{storyId:1217,stableShotId:"sh03"}}];
    expect(priorObjectOrigin(notes,1217,"sh03",2135)).toEqual(objectOrigin);
    expect(priorObjectOrigin(notes,1217,"sh01",2135)).toBeUndefined();
    expect(priorObjectOrigin(notes,44,"sh03",2135)).toBeUndefined();
    expect(readOriginLine("变形来源：A · #2135 · 0.92 / 0.8 / 0.3 / 0.1")).toBeUndefined();
    expect(reviewTakeId("复核视频 Take #1621，第03镜")).toBe(1621);
    expect(requestsVideoCues("复核视频 Take #1621，第03镜")).toBe(true);
    expect(reviewTakeId("重新渲染03镜，参考 Take #1621")).toBeUndefined();
  });
  it("routes the unhandled shot request and keeps both references in order", () => {
    expect(requestsVideoCues(message)).toBe(true);
    expect(cueReferences(message)).toEqual([2122,2132]);
    const shots = [1,3].map(shotNo=>({shotNo,stableShotId:"s"+shotNo}));
    expect(cueTarget(message,shots,"s1")?.shotNo).toBe(3);
    expect(cueTarget("第1镜、第3镜生成视频",shots,"s1")).toBeUndefined();
    const request={id:"u",role:"user",content:message,selectionQuote:{storyId:1217,stableShotId:"s3"}};
    expect(currentCueTurn([request,{id:"a",role:"assistant",content:"没接住你说的"}],1217)?.request).toBe(request);
    expect(currentCueTurn([request,{id:"a",role:"assistant",content:"Take 1718 已提交"}],1217)).toBeUndefined();
    expect(currentCueTurn([request,{id:"a",role:"assistant",content:"没接住你说的"}],8)).toBeUndefined();
  });
  it("proposes a longer shot and preserves real seconds rather than capping the render at eight", () => {
    expect(proposedSeconds(message,14.5)).toBe(16);
    expect(cueDurations(15)).toEqual([8,7]);
    const lines=secondDefaults(message,16);
    expect(lines[0]).toContain("城市");expect(lines.join(" ")).toContain("森林");expect(lines.at(-1)).toContain("小房子");
    expect(splitCues(lines,[8,8]).flat()).toEqual(lines);
    expect(()=>splitCues(["", "前进"],[2])).toThrow();
    expect(cueDurations(33)).toEqual([]);
  });
  it("persists an editable plan even when a key frame is undecided", () => {
    const opening={total:2,lines:"飞过树林\n进入屋内",prompt:"树林与小屋",ids:[2122],singleOpening:true};
    expect(readCueTranscript(cueTranscript(opening,opening.ids))).toEqual(opening);
    const draft = { total:2, lines:"沿屋顶前进\n进入森林", prompt:"只有一架纸飞机", ids:[0,2132] };
    const content = cueTranscript(draft,draft.ids);
    expect(readCueTranscript(content)).toEqual(draft);
    const request = {id:"u",role:"user",content:message,selectionQuote:{storyId:1217}};
    expect(currentCueTurn([request,{id:"other",role:"assistant",content:"另一条消息"},{id:"video-cues:u",role:"assistant",content}],1217)?.request).toBe(request);
  });
  it.each(["先不生成视频","修改图片 #2122，保留视频","第03镜视频渲染进度","生成图片用来制作视频","为什么视频失败","用这张图片生成视频","按已确认的关键帧生成视频"])("does not intercept %s", text=>expect(requestsVideoCues(text)).toBe(false));
});
