import {expect,it} from "vitest";
import {motionEditTarget,motionTextPrefix,readMotionDraft} from "./bookShotMotion";
import {newWritingBlock,blockBody,writingStyleOf,restoreStyledBlocks} from "./chapterBlockTree";
import {readBookShotChapter,shotDirections} from "@shared/bookShotDocument";

const shot = {...newWritingBlock("窗边"),format:"shot" as const};
const nextShot = {...newWritingBlock("室外"),format:"shot" as const};
const child = (text:string) => newWritingBlock(text,shot.id);

it("opens the legacy camera direction as an editable manuscript field without touching the picture or next shot",()=>{
  const picture = child("画面提示词：从窗户切到钟楼，缓缓推近。");
  const target = motionEditTarget([shot,picture,nextShot],shot.id,picture.id);
  expect(target.blocks[1]).toBe(picture);
  expect(target.blocks.at(-1)).toBe(nextShot);
  const field=target.blocks[2];
  expect(field.parentId).toBe(shot.id);
  expect(field.text.slice(motionTextPrefix(field.text).length)).toContain("推近");
  expect(target.cursor).toBe(field.text.length);
  const edited=target.blocks.map(b=>b===field?{...b,text:motionTextPrefix(b.text)+"先停一下"}:b);
  const saved={body:blockBody(edited),writingStyle:writingStyleOf(edited)};
  const reopened=restoreStyledBlocks(saved.body,saved.writingStyle);
  expect(motionEditTarget(reopened,shot.id,picture.id).blocks).toBe(reopened);
  expect(readMotionDraft(reopened,shot.id).values).toEqual(["先停一下"]);
  expect(shotDirections(readBookShotChapter({id:7,blocks:saved}).shots[0].notes).motion).toEqual(["视频：先停一下"]);
});

it("focuses the actual continuation or mixed module and preserves neighbouring fields and media",()=>{
  const mixed=child("画面描述：小狗\n运镜提示词：慢推\n音效提示词：雨声");
  const continuation=child("向右摇");
  const blocks=[shot,mixed,child("**运镜提示词**"),continuation,child("![图片](/api/test.jpg)"),child("字幕：傍晚")];
  expect(readMotionDraft(blocks,shot.id).values).toEqual(["慢推","向右摇"]);
  expect(motionEditTarget(blocks,shot.id,mixed.id)).toEqual({blocks,id:mixed.id,cursor:mixed.text.indexOf("慢推")+2});
  expect(motionEditTarget(blocks,shot.id,continuation.id)).toEqual({blocks,id:continuation.id,cursor:3});
  expect(motionTextPrefix(mixed.text)).toBe("");
});

it("supports absent, empty and markdown fields and opens collapsed ancestors",()=>{
  const empty = child("**运镜提示词**");
  const blocks = [{...shot,collapsed:true},empty,nextShot];
  const target=motionEditTarget(blocks,shot.id,shot.id);
  expect(target.blocks[0].collapsed).toBe(false);
  expect(target.blocks[1]).toBe(empty);
  expect(motionTextPrefix(empty.text)).toBe(empty.text+"\n");
  expect(readMotionDraft([shot,child("**运镜提示词：**缓慢推近\n停住")],shot.id).values).toEqual(["缓慢推近\n停住"]);
  expect(readMotionDraft([shot,child("视频："),child("画面描述：缓缓推近")],shot.id).values).toEqual([""]);
  expect(motionEditTarget([shot,nextShot],shot.id,shot.id).blocks[1].text).toBe("视频：");
  expect(()=>motionEditTarget([nextShot],shot.id,shot.id)).toThrow("本镜已变化");
});

it("carries multiline edits into video preparation and stops before the next cue",()=>{
  const blocks=[shot,child("视频：先保持远景。\n\n再靠近。\n停住。"),child("音效：雨声")];
  const book={body:blockBody(blocks),writingStyle:writingStyleOf(blocks)};
  const directions=shotDirections(readBookShotChapter({id:9,blocks:book}).shots[0].notes);
  expect(directions.motion).toEqual(["视频：先保持远景。","再靠近。","停住。"]);
  expect(directions.sound).toEqual(["音效：雨声"]);
});
