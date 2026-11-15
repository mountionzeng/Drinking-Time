import { describe, expect, it } from "vitest";
import { explicitScreenText, generatedScreenTextTrack, stripExplicitScreenText } from "./bookScreenText";
import { buildSubtitleRenderPlan, normalizeSubtitleState } from "./timelineSubtitleModel";

describe("book screen text", () => {
  it("extracts explicit quoted captions without swallowing the visual action", () => {
    const script = "字幕淡入：「雨停后的第一天」。画面为旧城墙，缓慢推近。\n城门打开。字幕：“终于回家了”。镜头升起。";
    expect(explicitScreenText(script)).toEqual(["雨停后的第一天", "终于回家了"]);
    expect(stripExplicitScreenText(script)).toContain("画面为旧城墙，缓慢推近");
    expect(stripExplicitScreenText(script)).not.toContain("雨停后的第一天");
    expect(explicitScreenText("镜头推近。旁白说：回家了。\n字幕：无")).toEqual([]);
    expect(explicitScreenText("屏幕文字：纸船邮局\n画面：河边")).toEqual(["纸船邮局"]);
  });
  it("keeps screen text independently editable, timed and exportable", () => {
    const track = generatedScreenTextTrack({
      shots: [{ stableShotId: "a", publishingVideo: {}, scriptText: "字幕：「纸船邮局」。河上驶来一条船。" },
        { stableShotId: "b", scriptText: "字幕：「普通草稿不自动转换」" }],
      spans: [{ stableShotId: "a", startFrame: 60, durationFrames: 90 }, { stableShotId: "b", startFrame: 150, durationFrames: 60 }],
      revision: 3, nextId: () => "screen-a",
    })!;
    expect(track.cues).toHaveLength(1);
    expect(track.cues[0]).toMatchObject({ text: "纸船邮局", startFrame: 60, durationFrames: 90, provenance: { kind: "shot-screen-text", stableShotId: "a" } });
    const state = normalizeSubtitleState({ tracks: [track] });
    expect(state.tracks[0]).toEqual(track);
    expect(buildSubtitleRenderPlan(state).cues[0]).toMatchObject({ text: "纸船邮局", placement: track.placement });
  });
});
