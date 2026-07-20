import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ENV } from "../_core/env";
import {
  getStoryById,
  getStoryTimeline,
  resetMemoryStateForTesting,
} from "../db";
import {
  attachChatCutXmlToStory,
  buildChatCutStoryPayload,
  importChatCutXmlStory,
  parseChatCutXml,
  summarizeChatCutImport,
} from "./chatCutXml";
import { createStory } from "../db";

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

const VOICE_FIXTURE = FIXTURE.replace(
  `<audio>
            <track>
              <clipitem id="audio-1"><file id="file-1"/><name>first.mp4</name><start>0</start><end>90</end><in>30</in><out>120</out></clipitem>
            </track>
          </audio>`,
  `<audio>
            <track>
              <clipitem id="voice-1"><file id="voice-file-1"><pathurl>file://./VO-0101.mp3</pathurl><name>VO-0101.mp3</name></file><name>VO-0101.mp3</name><start>0</start><end>60</end><in>0</in><out>60</out></clipitem>
              <clipitem id="voice-2"><file id="voice-file-2"><pathurl>file://./VO-0102.mp3</pathurl><name>VO-0102.mp3</name></file><name>VO-0102.mp3</name><start>90</start><end>150</end><in>0</in><out>60</out></clipitem>
            </track>
  </audio>`
);

const SPLIT_VOICE_FIXTURE = FIXTURE.replace(
  `<audio>
            <track>
              <clipitem id="audio-1"><file id="file-1"/><name>first.mp4</name><start>0</start><end>90</end><in>30</in><out>120</out></clipitem>
            </track>
          </audio>`,
  `<audio>
            <track>
              <clipitem id="voice-1"><file id="voice-file-1"><pathurl>file://./VO-0301.mp3</pathurl><name>VO-0301.mp3</name></file><name>VO-0301.mp3</name><start>0</start><end>30</end><in>0</in><out>30</out></clipitem>
              <clipitem id="voice-2"><file id="voice-file-2"><pathurl>file://./VO-0302.mp3</pathurl><name>VO-0302.mp3</name></file><name>VO-0302.mp3</name><start>40</start><end>70</end><in>0</in><out>30</out></clipitem>
              <clipitem id="voice-3"><file id="voice-file-3"><pathurl>file://./VO-0303.mp3</pathurl><name>VO-0303.mp3</name></file><name>VO-0303.mp3</name><start>80</start><end>110</end><in>0</in><out>30</out></clipitem>
              <clipitem id="voice-4"><file id="voice-file-4"><pathurl>file://./VO-0304.mp3</pathurl><name>VO-0304.mp3</name></file><name>VO-0304.mp3</name><start>120</start><end>150</end><in>0</in><out>30</out></clipitem>
            </track>
          </audio>`
);

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

describe("attachChatCutXmlToStory", () => {
  it("adds the ChatCut timeline to an existing semantic story without changing stable ids or dialogue", async () => {
    const created = await createStory({
      userId: 8,
      projectId: null,
      title: "SheSelf",
      body: {
        chatCutImport: {
          playbackAudioTrackIndexes: [1],
          audioTracks: [
            {
              index: 1,
              clips: [
                {
                  name: "first.mp4",
                  audioUrl: "https://media.example/first.mp4",
                },
              ],
            },
          ],
        },
        shots: [
          {
            stableShotId: "sheself-0101",
            shotIdentity: "sheself-0101",
            shotNo: 1,
            cueCode: "0101",
            dialogue: "我害怕所有的事情",
            subject: "女人回头",
            action: "她停在画前",
          },
          {
            stableShotId: "sheself-0102",
            shotIdentity: "sheself-0102",
            shotNo: 2,
            cueCode: "0102",
            dialogue: "我会反反复复地被告知",
            subject: "凝视她的眼睛",
            action: "视线没有移开",
          },
        ],
      },
    });

    const result = await attachChatCutXmlToStory({
      storyId: created.id,
      userId: 8,
      xml: FIXTURE,
    });
    const story = await getStoryById(created.id, 8);
    const timeline = await getStoryTimeline(created.id, 8);
    const body = story?.body as {
      shots: Array<Record<string, unknown>>;
      chatCutImport: {
        width: number;
        height: number;
        playbackAudioTrackIndexes: number[];
        audioTracks: Array<{
          clips: Array<{ name: string; audioUrl?: string | null }>;
        }>;
        scriptCues: Array<{ code: string; text: string }>;
      };
    };

    expect(result.summary).toMatchObject({ primaryClipCount: 2 });
    expect(body.shots).toHaveLength(2);
    expect(body.shots[0]).toMatchObject({
      stableShotId: "sheself-0101",
      dialogue: "我害怕所有的事情",
      durationMs: 3000,
      chatCutMapping: { itemId: "clip-1", assetId: "file-1" },
    });
    expect(body.shots[1]).toMatchObject({
      stableShotId: "sheself-0102",
      dialogue: "我会反反复复地被告知",
      durationMs: 3000,
    });
    expect(body.chatCutImport).toMatchObject({ width: 1080, height: 1080 });
    expect(body.chatCutImport.playbackAudioTrackIndexes).toEqual([1]);
    expect(body.chatCutImport.audioTracks).toHaveLength(1);
    expect(body.chatCutImport.audioTracks[0].clips[0]).toMatchObject({
      name: "first.mp4",
      audioUrl: "https://media.example/first.mp4",
    });
    expect(body.chatCutImport.scriptCues).toEqual([
      {
        code: "0101",
        text: "我害怕所有的事情",
        startFrame: null,
        endFrame: null,
      },
      {
        code: "0102",
        text: "我会反反复复地被告知",
        startFrame: null,
        endFrame: null,
      },
    ]);
    expect(timeline?.items).toMatchObject([
      { stableShotId: "sheself-0101", position: 0 },
      { stableShotId: "sheself-0102", position: 1 },
    ]);
  });

  it("rebinds preserved subtitle text to updated VO cue codes and timing", async () => {
    const created = await createStory({
      userId: 9,
      projectId: null,
      title: "SheSelf",
      body: {
        chatCutImport: {
          scriptCues: [
            { code: "SH01", text: "我害怕所有的事情" },
            { code: "SH02", text: "我会反反复复地被告知" },
          ],
        },
        shots: [
          {
            stableShotId: "sheself-sh01",
            shotNo: 1,
            cueCode: "SH01",
            dialogue: "我害怕所有的事情",
          },
          {
            stableShotId: "sheself-sh02",
            shotNo: 2,
            cueCode: "SH02",
            dialogue: "我会反反复复地被告知",
          },
        ],
      },
    });

    await attachChatCutXmlToStory({
      storyId: created.id,
      userId: 9,
      xml: VOICE_FIXTURE,
    });
    const story = await getStoryById(created.id, 9);
    const body = story?.body as {
      chatCutImport: {
        scriptCues: Array<{
          code: string;
          text: string;
          startFrame: number | null;
          endFrame: number | null;
        }>;
      };
    };

    expect(body.chatCutImport.scriptCues).toEqual([
      {
        code: "0101",
        text: "我害怕所有的事情",
        startFrame: 0,
        endFrame: 60,
      },
      {
        code: "0102",
        text: "我会反反复复地被告知",
        startFrame: 90,
        endFrame: 150,
      },
    ]);
  });

  it("realigns split subtitle lines when a repeated shot offsets later VO cues", async () => {
    const repeatedLine =
      "他们希望把我塑造成一个比他们更低级的物种，成为他们的养料";
    const created = await createStory({
      userId: 10,
      projectId: null,
      title: "SheSelf",
      body: {
        chatCutImport: {
          scriptCues: [
            { code: "0301", text: repeatedLine },
            { code: "0302", text: repeatedLine },
            { code: "0303", text: "当我无处可逃的时候，\n我只能往下走。" },
            { code: "0304", text: "走到身体里，走到泥土里。" },
          ],
        },
        shots: [
          { stableShotId: "sh16", cueCode: "SH16", dialogue: repeatedLine },
          { stableShotId: "sh17", cueCode: "SH17", dialogue: repeatedLine },
          {
            stableShotId: "sh18",
            cueCode: "SH18",
            dialogue: "当我无处可逃的时候，\n我只能往下走。",
          },
          {
            stableShotId: "sh19",
            cueCode: "SH19",
            dialogue: "走到身体里，走到泥土里。",
          },
        ],
      },
    });

    await attachChatCutXmlToStory({
      storyId: created.id,
      userId: 10,
      xml: SPLIT_VOICE_FIXTURE,
    });
    const story = await getStoryById(created.id, 10);
    const body = story?.body as {
      chatCutImport: {
        scriptCues: Array<{ code: string; text: string }>;
      };
    };

    expect(
      body.chatCutImport.scriptCues.map(({ code, text }) => [code, text])
    ).toEqual([
      ["0301", repeatedLine],
      ["0302", "当我无处可逃的时候，"],
      ["0303", "我只能往下走。"],
      ["0304", "走到身体里，走到泥土里。"],
    ]);
  });
});
