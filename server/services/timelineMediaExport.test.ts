import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  buildAudioMixPlan,
  emptyAudioState,
  insertAudioClip,
  setAudioClipFade,
  setAudioTrackGain,
} from "../../shared/timelineAudioModel";
import {
  SUBTITLE_TRACK_ID,
  buildSubtitleRenderPlan,
} from "../../shared/timelineSubtitleModel";
import {
  buildSubtitleOverlayIntervals,
  buildSubtitleOverlaySvg,
  buildSubtitleAssDocument,
  buildTimelineMediaFfmpegPlan,
  MAX_SUBTITLE_PNG_FALLBACK_INTERVALS,
  selectSubtitleExportMode,
  type ResolvedAudioMixInput,
} from "./timelineMediaExport";

function subtitlePlan() {
  return buildSubtitleRenderPlan({
    tracks: [
      {
        id: SUBTITLE_TRACK_ID,
        cues: [
          {
            id: "b",
            startFrame: 30,
            durationFrames: 30,
            text: "第二条{\\危险}<script>\n下一行",
            provenance: { kind: "manual" },
            sourceTextRevision: 0,
            textEdited: false,
            timingEdited: false,
            textRevision: 1,
          },
          {
            id: "a",
            startFrame: 30,
            durationFrames: 30,
            text: "第一条",
            provenance: { kind: "manual" },
            sourceTextRevision: 0,
            textEdited: false,
            timingEdited: false,
            textRevision: 1,
          },
        ],
      },
    ],
  });
}

describe("timelineMediaExport", () => {
  it("serializes stable overlapping subtitles into one escaped SVG interval", () => {
    const intervals = buildSubtitleOverlayIntervals(subtitlePlan());
    expect(intervals).toEqual([
      {
        startFrame: 30,
        endFrame: 60,
        lines: ["第一条", "第二条{\\危险}<script>", "下一行"],
      },
    ]);
    const document = buildSubtitleOverlaySvg(intervals[0], {
      width: 1080,
      height: 1920,
    });

    expect(document).toContain('viewBox="0 0 1080 1920"');
    expect(document).toContain("第一条");
    expect(document).toContain("第二条{\\危险}&lt;s");
    expect(document).toContain("cript&gt;");
    expect(document).not.toContain("<script>");
    expect(document.match(/<tspan/g)).toHaveLength(4);
  });

  it("serializes frame timing and literal ASS control characters safely", () => {
    const document = buildSubtitleAssDocument(subtitlePlan(), {
      width: 1080,
      height: 1920,
    });

    expect(document).toContain("PlayResX: 1080");
    expect(document).toContain("PlayResY: 1920");
    expect(document).toContain(
      "Dialogue: 0,0:00:01.00,0:00:02.00,TimelineSubtitle"
    );
    expect(document).toContain(
      "第一条\\N第二条\\{\\\\危险\\}<script>\\N下一行"
    );
    expect(document).not.toContain("第二条{\\危险}");
  });

  it("uses one ASS filter without adding a subtitle input per interval", () => {
    const audioPlan = buildAudioMixPlan({ audioState: emptyAudioState() });
    const subtitleOverlays = Array.from({ length: 1_000 }, (_, index) => ({
      startFrame: index,
      endFrame: index + 1,
      lines: [`字幕 ${index}`],
      filePath: `/safe/subtitle-${index}.png`,
    }));

    const ffmpeg = buildTimelineMediaFfmpegPlan({
      visualMasterPath: "/safe/visual.mp4",
      outputPath: "/safe/output.mp4",
      totalFrames: 1_000,
      audioPlan,
      resolvedAudioInputs: [],
      subtitleOverlays,
      subtitleAssPath: "/safe/timeline:subtitles.ass",
      subtitleFontDirectory: "/safe/fonts",
    });

    expect(ffmpeg.inputPaths).toEqual(["/safe/visual.mp4"]);
    expect(ffmpeg.args.filter(arg => arg === "-i")).toHaveLength(1);
    expect(ffmpeg.filterComplex).toContain(
      "ass=filename='/safe/timeline\\:subtitles.ass':fontsdir='/safe/fonts'"
    );
    expect(ffmpeg.filterComplex).not.toContain("overlay=");
  });

  it("keeps the no-libass PNG compatibility path explicitly bounded", () => {
    expect(
      selectSubtitleExportMode({ intervalCount: 1, assSupported: false })
    ).toBe("bounded-png");
    expect(() =>
      selectSubtitleExportMode({
        intervalCount: MAX_SUBTITLE_PNG_FALLBACK_INTERVALS + 1,
        assSupported: false,
      })
    ).toThrow(/缺少 ass\/libass.*超过兼容上限/);
  });

  it("translates source trim, track × clip gain, fades and frame-exact delay into one mix graph", () => {
    let state = emptyAudioState();
    for (const clip of [
      { id: "music", kind: "music" as const, assetId: 1, gain: 0.8 },
      { id: "voice", kind: "narration" as const, assetId: 2, gain: 0.5 },
    ]) {
      const inserted = insertAudioClip(state, {
        ...clip,
        timelineStartFrame: 30,
        sourceInFrame: 60,
        sourceOutFrame: 150,
      });
      if (inserted.status !== "ok") throw new Error(inserted.message);
      state = inserted.state;
    }
    const trackGain = setAudioTrackGain(state, { kind: "music", gain: 0.25 });
    if (trackGain.status !== "ok") throw new Error(trackGain.message);
    const faded = setAudioClipFade(trackGain.state, {
      clipId: "music",
      fadeInFrames: 15,
      fadeOutFrames: 30,
    });
    if (faded.status !== "ok") throw new Error(faded.message);
    const audioPlan = buildAudioMixPlan({ audioState: faded.state });
    const resolvedAudioInputs: ResolvedAudioMixInput[] = audioPlan.inputs.map(
      input => ({ input, filePath: `/safe/${input.id}.wav` })
    );

    const ffmpeg = buildTimelineMediaFfmpegPlan({
      visualMasterPath: "/safe/visual.mp4",
      outputPath: "/safe/output.mp4",
      totalFrames: 180,
      audioPlan,
      resolvedAudioInputs,
      subtitleOverlays: [
        {
          startFrame: 30,
          endFrame: 60,
          lines: ["字幕"],
          filePath: "/safe/subtitles.png",
        },
      ],
    });

    expect(ffmpeg.inputPaths).toEqual([
      "/safe/visual.mp4",
      "/safe/voice.wav",
      "/safe/music.wav",
      "/safe/subtitles.png",
    ]);
    expect(ffmpeg.filterComplex).toContain("atrim=start=2.000000:end=5.000000");
    expect(ffmpeg.filterComplex).toContain("volume=0.20000000");
    expect(ffmpeg.filterComplex).toContain("afade=t=in:st=0:d=0.500000");
    expect(ffmpeg.filterComplex).toContain(
      "afade=t=out:st=2.000000:d=1.000000"
    );
    expect(ffmpeg.filterComplex).toContain("adelay=48000S:all=1");
    expect(ffmpeg.filterComplex).toContain(
      "amix=inputs=2:duration=longest:dropout_transition=0:normalize=0"
    );
    expect(ffmpeg.filterComplex).toContain(
      "overlay=0:0:enable='gte(t,1.000000)*lt(t,2.000000)'"
    );
    expect(ffmpeg.args).not.toContain("-an");
  });

  it("still creates one silent final mix track when every planned input is muted or missing", () => {
    const audioPlan = buildAudioMixPlan({ audioState: emptyAudioState() });
    const ffmpeg = buildTimelineMediaFfmpegPlan({
      visualMasterPath: "/safe/visual.mp4",
      outputPath: "/safe/output.mp4",
      totalFrames: 30,
      audioPlan,
      resolvedAudioInputs: [],
    });

    expect(ffmpeg.filterComplex).toContain("anullsrc=r=48000:cl=stereo");
    expect(ffmpeg.filterComplex).toContain("atrim=duration=1.000000");
    expect(ffmpeg.audioMap).toBe("[mixout]");
  });
});

// ── Ownership + missing-source contract (U8) ──────────────────────────────

describe("export audio input resolution", () => {
  let tmp: string;
  const previousAudioDir = process.env.LOCAL_AUDIO_DIR;

  beforeAll(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "dt-export-resolve-"));
    process.env.LOCAL_AUDIO_DIR = path.join(tmp, "audio");
    await mkdir(path.join(tmp, "audio"), { recursive: true });
    await mkdir(path.join(tmp, "video"), { recursive: true });
  });
  afterAll(async () => {
    if (previousAudioDir === undefined) delete process.env.LOCAL_AUDIO_DIR;
    else process.env.LOCAL_AUDIO_DIR = previousAudioDir;
    await rm(tmp, { recursive: true, force: true });
  });
  beforeEach(async () => {
    const { resetMemoryStateForTesting } = await import("../db");
    resetMemoryStateForTesting();
  });

  async function seedReadyAsset(input: {
    storyId: number;
    userId: number;
    storageKey: string;
    status?: "ready" | "pending";
    writeFileBytes?: boolean;
  }) {
    const { createStoryAudioAssetRow } = await import("../db");
    const asset = await createStoryAudioAssetRow({
      storyId: input.storyId,
      userId: input.userId,
      storageKey: input.storageKey,
      displayName: "bed.wav",
      sourceKind: "local-upload",
      status: input.status ?? "ready",
      durationFrames: 90,
    });
    if (input.writeFileBytes) {
      const { resolveManagedAudioPath } = await import("./audioMedia");
      await writeFile(
        resolveManagedAudioPath(input.storageKey),
        "not-real-audio"
      );
    }
    return asset;
  }

  function planForAsset(assetId: number) {
    const inserted = insertAudioClip(emptyAudioState(), {
      id: "bed",
      kind: "music",
      assetId,
      timelineStartFrame: 0,
      sourceInFrame: 0,
      sourceOutFrame: 90,
    });
    if (inserted.status !== "ok") throw new Error(inserted.message);
    return buildAudioMixPlan({ audioState: inserted.state });
  }

  async function resolve(input: {
    storyId: number;
    userId: number;
    assetId: number;
    missingSourceMode: "strict" | "relaxed";
  }) {
    const { resolveExportAudioInputs } = await import("./videoExport");
    const diagnostics: string[] = [];
    const resolved = await resolveExportAudioInputs({
      storyId: input.storyId,
      userId: input.userId,
      audioPlan: planForAsset(input.assetId),
      visualSources: [],
      videoDirectory: path.join(tmp, "video"),
      missingSourceMode: input.missingSourceMode,
      diagnostics,
    });
    return { resolved, diagnostics };
  }

  it("resolves an owned, ready asset with bytes on disk to its managed path", async () => {
    const asset = await seedReadyAsset({
      storyId: 1,
      userId: 7,
      storageKey: "a".repeat(32),
      writeFileBytes: true,
    });
    const { resolved, diagnostics } = await resolve({
      storyId: 1,
      userId: 7,
      assetId: asset.id,
      missingSourceMode: "strict",
    });
    expect(resolved).toHaveLength(1);
    expect(resolved[0].filePath).toContain("a".repeat(32));
    expect(diagnostics).toEqual([]);
  });

  it("refuses another Story's asset id in both modes, and never reads a file for it", async () => {
    const foreign = await seedReadyAsset({
      storyId: 2,
      userId: 7,
      storageKey: "b".repeat(32),
      writeFileBytes: true,
    });
    for (const missingSourceMode of ["strict", "relaxed"] as const) {
      await expect(
        resolve({
          storyId: 1,
          userId: 7,
          assetId: foreign.id,
          missingSourceMode,
        })
      ).rejects.toThrow(/不属于当前故事|不存在|未就绪/);
    }
  });

  it("refuses another user's asset id even with the right storyId", async () => {
    const asset = await seedReadyAsset({
      storyId: 1,
      userId: 7,
      storageKey: "c".repeat(32),
      writeFileBytes: true,
    });
    await expect(
      resolve({
        storyId: 1,
        userId: 8,
        assetId: asset.id,
        missingSourceMode: "relaxed",
      })
    ).rejects.toThrow();
  });

  it("refuses a not-yet-ready asset", async () => {
    const pending = await seedReadyAsset({
      storyId: 1,
      userId: 7,
      storageKey: "d".repeat(32),
      status: "pending",
      writeFileBytes: true,
    });
    await expect(
      resolve({
        storyId: 1,
        userId: 7,
        assetId: pending.id,
        missingSourceMode: "relaxed",
      })
    ).rejects.toThrow();
  });

  it("strict fails on missing managed bytes; relaxed keeps going with a diagnostic and silence", async () => {
    const asset = await seedReadyAsset({
      storyId: 1,
      userId: 7,
      storageKey: "e".repeat(32),
      writeFileBytes: false, // row is ready, bytes are gone
    });
    await expect(
      resolve({
        storyId: 1,
        userId: 7,
        assetId: asset.id,
        missingSourceMode: "strict",
      })
    ).rejects.toThrow(/受管文件缺失/);

    const { resolved, diagnostics } = await resolve({
      storyId: 1,
      userId: 7,
      assetId: asset.id,
      missingSourceMode: "relaxed",
    });
    // Dropped from the mix (so it renders as silence) but explained, not hidden.
    expect(resolved).toEqual([]);
    expect(diagnostics.join(" ")).toMatch(/受管文件缺失/);
    expect(diagnostics.join(" ")).toMatch(/保留时长/);
  });

  it("bounds legacy downloads across the whole export and memoizes skipped URLs", async () => {
    const { downloadLegacyAudioForExport } = await import("./videoExport");
    const fetchBytes = vi.fn(
      async (
        _url: string,
        _options?: { maxBytes?: number; totalTimeoutMs?: number }
      ) => Buffer.alloc(3)
    );
    const diagnostics: string[] = [];
    const paths = await downloadLegacyAudioForExport(
      {
        sources: [
          { assetId: -1, clipId: "a", displayName: "A", url: "https://a" },
          { assetId: -2, clipId: "b", displayName: "B", url: "https://b" },
          {
            assetId: -3,
            clipId: "b-copy",
            displayName: "B copy",
            url: "https://b",
          },
          { assetId: -4, clipId: "c", displayName: "C", url: "https://c" },
        ],
        workDir: tmp,
        missingSourceMode: "relaxed",
        diagnostics,
      },
      {
        fetchBytes,
        limits: {
          maxSources: 2,
          maxBytes: 5,
          maxDownloadMs: 1_000,
          maxFileBytes: 4,
        },
      }
    );

    expect(fetchBytes).toHaveBeenCalledTimes(2);
    expect(fetchBytes.mock.calls[0]?.[1]).toMatchObject({ maxBytes: 4 });
    expect(fetchBytes.mock.calls[1]?.[1]).toMatchObject({ maxBytes: 2 });
    expect([...paths.keys()]).toEqual([-1]);
    expect(diagnostics.join(" ")).toMatch(/下载容量上限/);
    expect(diagnostics.join(" ")).toMatch(/来源数量上限/);
  });

  it("attempts a repeated failing legacy URL once and honors the elapsed budget", async () => {
    const { downloadLegacyAudioForExport } = await import("./videoExport");
    const failingFetch = vi.fn(async () => {
      throw new Error("upstream down");
    });
    const failedDiagnostics: string[] = [];
    await downloadLegacyAudioForExport(
      {
        sources: [
          { assetId: -10, clipId: "x", displayName: "X", url: "https://x" },
          {
            assetId: -11,
            clipId: "x-copy",
            displayName: "X copy",
            url: "https://x",
          },
        ],
        workDir: tmp,
        missingSourceMode: "relaxed",
        diagnostics: failedDiagnostics,
      },
      { fetchBytes: failingFetch }
    );
    expect(failingFetch).toHaveBeenCalledTimes(1);
    expect(failedDiagnostics).toHaveLength(1);

    let clock = 0;
    const timedFetch = vi.fn(
      async (
        _url: string,
        _options?: { maxBytes?: number; totalTimeoutMs?: number }
      ) => {
        clock = 10;
        return Buffer.from("a");
      }
    );
    const timedDiagnostics: string[] = [];
    const timedWorkDir = path.join(tmp, "timed-legacy-downloads");
    await mkdir(timedWorkDir, { recursive: true });
    const timedPaths = await downloadLegacyAudioForExport(
      {
        sources: [
          { assetId: -20, clipId: "y", displayName: "Y", url: "https://y" },
          { assetId: -21, clipId: "z", displayName: "Z", url: "https://z" },
        ],
        workDir: timedWorkDir,
        missingSourceMode: "relaxed",
        diagnostics: timedDiagnostics,
      },
      {
        fetchBytes: timedFetch,
        now: () => clock,
        limits: {
          maxSources: 10,
          maxBytes: 10,
          maxDownloadMs: 5,
          maxFileBytes: 10,
        },
      }
    );
    expect(timedFetch).toHaveBeenCalledTimes(1);
    expect(timedFetch.mock.calls[0]?.[1]).toMatchObject({ totalTimeoutMs: 5 });
    expect([...timedPaths.keys()]).toEqual([-20]);
    expect(timedDiagnostics.join(" ")).toMatch(/下载时间上限/);
  });
});
