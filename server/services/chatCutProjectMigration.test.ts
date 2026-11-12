import { afterEach, expect, it, vi } from "vitest";
import {
  buildChatCutMigration,
  parseBilingualSrt,
} from "./chatCutProjectMigration";
import { buildSubtitleRenderPlan } from "../../shared/timelineSubtitleModel";
import {
  buildSubtitleAssDocument,
  buildSubtitleOverlayIntervals,
  buildSubtitleOverlaySvg,
} from "./timelineMediaExport";

const srt =
  "1\n00:00:00,067 --> 00:00:01,000\nHello\n\n2\n00:00:00,067 --> 00:00:02,000\n你好";
const xml = `<xmeml><project><name>Test</name><children><sequence><name>Test</name><duration>60</duration><rate><timebase>30</timebase></rate><media>
<video><format><samplecharacteristics><width>1080</width><height>1920</height></samplecharacteristics></format><track>
<clipitem id="v1"><file id="f1"><name>shot.mp4</name><pathurl>file://./shot.mp4</pathurl></file><name>shot.mp4</name><start>0</start><end>59</end><in>0</in><out>59</out></clipitem>
</track></video><audio><track><clipitem id="a1"><file id="f2"><name>music.mp3</name><pathurl>file://./music.mp3</pathurl></file><name>music.mp3</name><start>0</start><end>60</end><in>30</in><out>90</out>
<filter><effect><parameter><parameterid>level</parameterid><value>0.25</value><keyframe><when>30</when><value>0</value></keyframe><keyframe><when>40</when><value>0.25</value></keyframe><keyframe><when>75</when><value>0.25</value></keyframe><keyframe><when>90</when><value>0</value></keyframe></parameter></effect></filter>
</clipitem></track></audio></media></sequence></children></project></xmeml>`;
const uiLabels = [
  "字幕，C1，00:00:00:02 至 00:00:01:00",
  "字幕，C2，00:00:00:02 至 00:00:02:00",
  "shot，V1，00:00:00:00 至 00:00:02:00",
  "music，A1，00:00:00:00 至 00:00:02:00",
];
it("cross-checks SRT/UI timing and imports linear gain and source-relative fades", () => {
  const migration = buildChatCutMigration({ xml, srt, uiLabels });
  expect(migration.plan.videoTracks[0].clips[0].endFrame).toBe(60);
  expect(migration.levels.a1).toEqual({
    gain: 0.25,
    fadeInFrames: 10,
    fadeOutFrames: 15,
  });
  expect(migration.plan.audioTracks[0].clips[0].inFrame).toBe(30);
});
it("rejects mismatched captions and unexplained timing drift", () => {
  expect(() =>
    buildChatCutMigration({
      xml,
      srt: srt.replace("00:00:01,000", "00:00:01,100"),
      uiLabels,
    })
  ).toThrow("SRT");
  expect(() =>
    buildChatCutMigration({
      xml: xml.replace("<end>59</end>", "<end>40</end>"),
      srt,
      uiLabels,
    })
  ).toThrow("一一对应");
  expect(() => parseBilingualSrt("broken")).toThrow("格式无效");
});
it("renders two language positions in both PNG and ASS without merging their timing", () => {
  const plan = buildSubtitleRenderPlan(parseBilingualSrt(srt));
  const intervals = buildSubtitleOverlayIntervals(plan);
  expect(intervals).toHaveLength(2);
  expect(intervals[0].positioned?.map(c => c.text)).toEqual(["Hello", "你好"]);
  expect(intervals[1].positioned?.map(c => c.text)).toEqual(["你好"]);
  const svg = buildSubtitleOverlaySvg(intervals[0], {
    width: 1080,
    height: 1920,
  });
  expect(svg).toContain("Hello");
  expect(svg).toContain("你好");
  expect(svg).toContain('y="1616.16"');
  expect(svg).toContain('y="1716.16"');
  const ass = buildSubtitleAssDocument(plan, { width: 1080, height: 1920 });
  expect(ass).toContain("\\pos(540.000,1560.000)");
  expect(ass).toContain("\\pos(540.000,1660.000)");
});

import * as stories from "../repositories/stories";
import * as timelines from "../repositories/timelines";
import * as videos from "../repositories/videos";
import { migrateChatCutProject } from "./chatCutProjectMigration";
afterEach(() => vi.restoreAllMocks());

it.each([
  "missing-owner",
  "changed-story",
  "changed-timeline",
  "already-imported",
])("does not replace editing or create assets when %s", async scenario => {
  const body = {
    _revision: scenario === "changed-story" ? 2 : 1,
    ...(scenario === "already-imported"
      ? { chatCutMigration: { id: "test-migration" } }
      : {}),
  };
  vi.spyOn(stories, "getStoryById").mockResolvedValue(
    scenario === "missing-owner" ? null : ({ body } as never)
  );
  vi.spyOn(timelines, "getStoryTimeline").mockResolvedValue({
    version: scenario === "changed-timeline" ? 2 : 1,
  } as never);
  const save = vi.spyOn(timelines, "updateStoryAndTimelineAtomic");
  const create = vi.spyOn(videos, "createVideoTake");
  const run = migrateChatCutProject({
    storyId: 1,
    userId: 2,
    migrationId: "test-migration",
    expectedRevision: 1,
    expectedTimelineVersion: 1,
    migration: buildChatCutMigration({ xml, srt, uiLabels }),
    files: new Map(),
  });
  if (scenario === "already-imported")
    await expect(run).resolves.toMatchObject({ status: "already-imported" });
  else
    await expect(run).rejects.toThrow(
      scenario === "missing-owner" ? "无权读取" : "作品已变动"
    );
  expect(save).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
});
