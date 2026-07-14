import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ENV } from "../_core/env";
import {
  getStoryById,
  getStoryTimeline,
  resetMemoryStateForTesting,
} from "../db";
import {
  buildChatCutStoryPayload,
  importChatCutXmlStory,
  parseChatCutXml,
  summarizeChatCutImport,
} from "./chatCutXml";

const savedDatabaseUrl = ENV.databaseUrl;

const FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<xmeml version="4">
  <project>
    <name>测试工程</name>
    <children>
      <sequence id="sequence-1">
        <name>方形故事</name>
        <duration>180</duration>
        <rate><timebase>30</timebase><ntsc>FALSE</ntsc></rate>
        <media>
          <video>
            <format><samplecharacteristics><width>1080</width><height>1080</height></samplecharacteristics></format>
            <track>
              <clipitem id="slate-1"><file id="file-slate"><pathurl>file://./script.png</pathurl><name>script.png</name></file><name>script.png</name><start>0</start><end>180</end><in>0</in><out>180</out></clipitem>
            </track>
            <track>
              <clipitem id="clip-1">
                <file id="file-1"><pathurl>file://./first.mp4</pathurl><name>first.mp4</name><duration>240</duration><media><video><samplecharacteristics><width>1920</width><height>1080</height></samplecharacteristics></video><audio/></media></file>
                <name>first.mp4</name><start>0</start><end>90</end><in>30</in><out>120</out>
                <filter><effect><effectid>basic</effectid><parameter><parameterid>scale</parameterid><value>150</value></parameter><parameter><parameterid>center</parameterid><value><horiz>0.25</horiz><vert>-0.1</vert></value></parameter></effect></filter>
                <filter><effect><effectid>crop</effectid><parameter><parameterid>left</parameterid><value>10</value></parameter><parameter><parameterid>right</parameterid><value>20</value></parameter></effect></filter>
                <link><linkclipref>audio-1</linkclipref></link>
              </clipitem>
              <clipitem id="clip-2">
                <file id="file-2"><pathurl>file://./second.webp</pathurl><name>second.webp</name><duration>90</duration><media><video><samplecharacteristics><width>1024</width><height>1024</height></samplecharacteristics></video></media></file>
                <name>second.webp</name><start>90</start><end>177</end><in>0</in><out>87</out>
                <filter><effect><effectid>timeremap</effectid><parameter><parameterid>speed</parameterid><value>50</value></parameter><parameter><parameterid>reverse</parameterid><value>TRUE</value></parameter></effect></filter>
              </clipitem>
            </track>
            <track>
              <clipitem id="overlay-1"><file id="file-overlay"><pathurl>file://./overlay.png</pathurl><name>overlay.png</name></file><name>overlay.png</name><start>100</start><end>140</end><in>0</in><out>40</out></clipitem>
            </track>
          </video>
          <audio>
            <track>
              <clipitem id="audio-1"><file id="file-1"/><name>first.mp4</name><start>0</start><end>90</end><in>30</in><out>120</out></clipitem>
            </track>
          </audio>
        </media>
      </sequence>
    </children>
  </project>
</xmeml>`;

beforeEach(() => {
  resetMemoryStateForTesting();
  ENV.databaseUrl = "";
});

afterEach(() => {
  ENV.databaseUrl = savedDatabaseUrl;
});

describe("parseChatCutXml", () => {
  it("selects the editorial track and preserves transforms, retiming and audio", () => {
    const plan = parseChatCutXml(FIXTURE);
    const summary = summarizeChatCutImport(plan);

    expect(summary).toMatchObject({
      sequenceName: "方形故事",
      durationFrames: 180,
      durationMs: 6000,
      width: 1080,
      height: 1080,
      fps: 30,
      primaryVideoTrackIndex: 2,
      primaryClipCount: 2,
      videoClipCount: 4,
      audioClipCount: 1,
    });
    expect(plan.videoTracks[1].clips[0]).toMatchObject({
      name: "first.mp4",
      inFrame: 30,
      outFrame: 120,
      transform: {
        scalePercent: 150,
        centerX: 0.25,
        centerY: -0.1,
        cropLeft: 10,
        cropRight: 20,
      },
    });
    expect(plan.videoTracks[1].clips[1].timeRemap).toEqual({
      speedPercent: 50,
      reverse: true,
    });
    expect(plan.audioTracks[0].clips[0].pathUrl).toBe("file://./first.mp4");
  });

  it("rejects entity declarations and non-XMEML files", () => {
    expect(() =>
      parseChatCutXml(
        '<!DOCTYPE x [<!ENTITY secret SYSTEM "file:///etc/passwd">]><xmeml/>'
      )
    ).toThrow("外部实体");
    expect(() =>
      parseChatCutXml("<project><name>nope</name></project>")
    ).toThrow("XMEML");
  });
});

describe("buildChatCutStoryPayload", () => {
  it("creates a linear editable timeline while retaining the source manifest", () => {
    const plan = parseChatCutXml(FIXTURE);
    const payload = buildChatCutStoryPayload(plan);

    expect(payload.shots).toHaveLength(2);
    expect(payload.timelineItems).toHaveLength(2);
    expect(payload.timelineItems[0]).toMatchObject({
      plannedDurationMs: 3000,
      transform: {
        cropX: 0.1,
        cropWidth: 0.7,
        zoom: 1.5,
        panX: 0.25,
      },
    });
    expect(payload.timelineItems[1].plannedDurationMs).toBe(3000);
    expect(payload.shots.map(shot => shot.durationMs)).toEqual([3000, 3000]);
    expect(payload.shots[1].cameraMove).toContain("倒放");
    expect(payload.shots[1].note).toContain("并行图层");
    expect(payload.body.chatCutImport).toMatchObject({
      schemaVersion: 1,
      sequenceName: "方形故事",
      relinkStatus: "required",
    });
  });
});

describe("importChatCutXmlStory", () => {
  it("creates a new story and persisted timeline without touching other stories", async () => {
    const result = await importChatCutXmlStory({ xml: FIXTURE, userId: 7 });
    const story = await getStoryById(result.story.id, 7);
    const timeline = await getStoryTimeline(result.story.id, 7);

    expect(story?.title).toBe("方形故事");
    expect((story?.body as { shots?: unknown[] }).shots).toHaveLength(2);
    expect(timeline?.items).toHaveLength(2);
    expect(result.summary).toMatchObject({
      primaryClipCount: 2,
      requiresMediaRelink: true,
    });
  });
});
