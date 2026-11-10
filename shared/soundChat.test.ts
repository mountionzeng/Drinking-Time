import { describe, expect, it } from "vitest";
import { applySoundChat, parseSoundChat } from "./soundChat";
import { emptyAudioState } from "./timelineAudioModel";
const state = () => {
  const result = emptyAudioState();
  result.tracks.find(t => t.kind === "music")!.clips.push({ id: "m", assetId: 1, timelineStartFrame: 0, sourceInFrame: 0, sourceOutFrame: 100, durationFrames: 100, gain: .25, muted: false, fadeInFrames: 0, fadeOutFrames: 0 });
  return result;
};
describe("sound chat", () => {
  it.each(["背景音乐小一点", "把音乐音量调到20%", "音乐淡出2秒", "取消音乐静音", "music quieter", "我觉得背景音乐太响了", "旁白听不清"])("recognizes %s", text => expect(parseSoundChat(text)?.type).toBe("edit"));
  it.each(["音乐小一点，旁白慢一点", "音乐和旁白小一点", "音乐小一点不要改旁白", "不要把音乐调到20%", "音乐调到500%", "第2镜音乐小一点"])("does not partly execute %s", text => expect(parseSoundChat(text)?.type).toBe("unsupported"));
  it("leaves questions and book writing to conversation", () => {
    expect(parseSoundChat("怎么改音乐？")).toBeNull();
    expect(parseSoundChat("把这一章写得生动一些")).toBeNull();
  });
  it("changes actual gain relatively, clamps fades and leaves input unchanged", () => {
    const before = state();
    const parsed = parseSoundChat("音乐小一点，音乐淡出20秒");
    if (parsed?.type !== "edit") throw Error("parse");
    const after = applySoundChat(before, parsed.commands);
    expect(after.status).toBe("ok");
    if (after.status !== "ok") return;
    expect(after.state.tracks[2].clips[0]).toMatchObject({ gain: .2, fadeOutFrames: 100 });
    expect(before.tracks[2].clips[0].gain).toBe(.25);
  });
  it("rejects missing tracks atomically", () => {
    const parsed = parseSoundChat("音乐小一点，旁白大一点");
    if (parsed?.type !== "edit") throw Error("parse");
    const before = state();
    expect(applySoundChat(before, parsed.commands).status).toBe("error");
    expect(before.tracks[2].clips[0].gain).toBe(.25);
  });
});
