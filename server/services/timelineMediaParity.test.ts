import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildAudioMixPlan,
  emptyAudioState,
  insertAudioClip,
  setAudioClipFade,
  setAudioClipMuted,
  type AudioMixPlan,
} from "../../shared/timelineAudioModel";
import { STORY_TIMELINE_FPS } from "../../shared/storyMaterial";
import {
  SUBTITLE_TRACK_ID,
  buildSubtitleRenderPlan,
} from "../../shared/timelineSubtitleModel";
import {
  composeTimelineMedia,
  type ResolvedAudioMixInput,
} from "./timelineMediaExport";

const execFileAsync = promisify(execFile);
const workDirs: string[] = [];

afterEach(async () => {
  await Promise.all(workDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

async function ffmpeg(args: string[]): Promise<void> {
  await execFileAsync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], {
    maxBuffer: 4 * 1024 * 1024,
  });
}

function channelSamples(bytes: Buffer): Float32Array {
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

function rms(samples: Float32Array, startSec: number, endSec: number): number {
  const start = Math.round(startSec * 48_000);
  const end = Math.min(samples.length, Math.round(endSec * 48_000));
  let sum = 0;
  for (let index = start; index < end; index += 1) sum += samples[index] ** 2;
  return Math.sqrt(sum / Math.max(1, end - start));
}

describe("timeline media FFmpeg result parity", () => {
  it(
    "burns frame-bounded subtitles and emits one mixed audio stream with plan-level gain/fade",
    async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "timeline-media-parity-"));
      workDirs.push(dir);
      const visual = path.join(dir, "visual.mp4");
      const tone440 = path.join(dir, "tone-440.wav");
      const tone880 = path.join(dir, "tone-880.wav");
      const output = path.join(dir, "result.mp4");
      await ffmpeg([
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=320x180:r=30:d=3",
        "-an",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        visual,
      ]);
      await Promise.all(
        [
          [440, tone440],
          [880, tone880],
        ].map(([frequency, outputPath]) =>
          ffmpeg([
            "-f",
            "lavfi",
            "-i",
            `sine=frequency=${frequency}:sample_rate=48000:duration=3`,
            "-c:a",
            "pcm_s16le",
            String(outputPath),
          ])
        )
      );

      let audioState = emptyAudioState();
      const music = insertAudioClip(audioState, {
        id: "music",
        kind: "music",
        assetId: 1,
        timelineStartFrame: 0,
        sourceOutFrame: 90,
        gain: 0.5,
      });
      if (music.status !== "ok") throw new Error(music.message);
      audioState = music.state;
      const voice = insertAudioClip(audioState, {
        id: "voice",
        kind: "narration",
        assetId: 2,
        timelineStartFrame: 60,
        sourceOutFrame: 30,
        gain: 0.25,
      });
      if (voice.status !== "ok") throw new Error(voice.message);
      audioState = voice.state;
      const faded = setAudioClipFade(audioState, {
        clipId: "music",
        fadeInFrames: 30,
      });
      if (faded.status !== "ok") throw new Error(faded.message);
      const audioPlan = buildAudioMixPlan({ audioState: faded.state });
      const byAsset = new Map([
        [1, tone440],
        [2, tone880],
      ]);
      const resolvedAudioInputs: ResolvedAudioMixInput[] = audioPlan.inputs.map(
        input => ({
          input,
          filePath: byAsset.get(
            input.source.kind === "asset" ? input.source.assetId : -1
          )!,
        })
      );
      const subtitlePlan = buildSubtitleRenderPlan({
        tracks: [
          {
            id: SUBTITLE_TRACK_ID,
            cues: [
              {
                id: "caption",
                startFrame: 15,
                durationFrames: 30,
                text: "字幕校验",
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

      await composeTimelineMedia({
        visualMasterPath: visual,
        outputPath: output,
        workDir: dir,
        totalFrames: 90,
        dimensions: { width: 320, height: 180 },
        subtitlePlan,
        audioPlan,
        resolvedAudioInputs,
        subtitleFontDirectory: path.resolve(
          process.cwd(),
          "client/src/assets/fonts/publishing-album/noto-sans-sc"
        ),
      });

      const { stdout: probeOutput } = await execFileAsync("ffprobe", [
        "-v",
        "error",
        "-show_entries",
        "stream=codec_type:format=duration",
        "-of",
        "json",
        output,
      ]);
      const probe = JSON.parse(probeOutput) as {
        streams: Array<{ codec_type: string }>;
        format: { duration: string };
      };
      expect(probe.streams.filter(stream => stream.codec_type === "video")).toHaveLength(1);
      expect(probe.streams.filter(stream => stream.codec_type === "audio")).toHaveLength(1);
      expect(Number(probe.format.duration)).toBeCloseTo(3, 1);

      const pcmPath = path.join(dir, "decoded.f32le");
      await ffmpeg([
        "-i",
        output,
        "-map",
        "0:a:0",
        "-ac",
        "1",
        "-ar",
        "48000",
        "-f",
        "f32le",
        pcmPath,
      ]);
      const samples = channelSamples(await readFile(pcmPath));
      // AAC priming may shift the envelope by a fraction of one 30fps frame;
      // sampling around the 50% point keeps that allowed offset below 0.5dB.
      const fadedWindow = rms(samples, 0.45, 0.55);
      const fullWindow = rms(samples, 1.2, 1.3);
      const gainDeltaDb = 20 * Math.log10(fadedWindow / fullWindow);
      expect(gainDeltaDb).toBeCloseTo(20 * Math.log10(0.5), 0);
      expect(rms(samples, 2.2, 2.3)).toBeGreaterThan(fullWindow);

      const frameWithSubtitle = path.join(dir, "with.rgb");
      const frameAfterSubtitle = path.join(dir, "after.rgb");
      for (const [at, target] of [
        ["1.000", frameWithSubtitle],
        ["1.700", frameAfterSubtitle],
      ]) {
        await ffmpeg([
          "-ss",
          at,
          "-i",
          output,
          "-frames:v",
          "1",
          "-pix_fmt",
          "rgb24",
          "-f",
          "rawvideo",
          target,
        ]);
      }
      const brightPixels = (bytes: Buffer) =>
        [...bytes].filter(value => value > 48).length;
      expect(brightPixels(await readFile(frameWithSubtitle))).toBeGreaterThan(100);
      expect(brightPixels(await readFile(frameAfterSubtitle))).toBeLessThan(10);
    },
    30_000
  );
});

// ── Reference mixer: the node-side stand-in for the browser executor ───────
//
// The repo's vitest runs in `environment: "node"`, so there is no real
// `OfflineAudioContext`. This renders the SAME AudioMixPlan with the same
// semantics the browser executor applies (source trim -> gain -> fades ->
// timeline delay -> sum) so both executors can be handed to one analyser and
// compared. It deliberately mirrors the plan, never the FFmpeg graph.
const SAMPLE_RATE = 48_000;
/**
 * FFmpeg's `sine` lavfi source emits at 0.125 full scale, not 1.0. The
 * reference mixer has to model the real fixture amplitude or every comparison
 * is off by a flat 18.06 dB. `makeTone` asserts this so a future FFmpeg change
 * fails loudly here instead of silently skewing the parity threshold.
 */
const TONE_AMPLITUDE = 0.125;

function renderPlanReference(input: {
  plan: AudioMixPlan;
  totalFrames: number;
  toneByInputId: Map<string, number>;
}): Float32Array {
  const totalSamples = Math.round(
    (input.totalFrames / STORY_TIMELINE_FPS) * SAMPLE_RATE
  );
  const out = new Float32Array(totalSamples);
  for (const planned of input.plan.inputs) {
    if (planned.muted || planned.baseGain <= 0) continue;
    const frequency = input.toneByInputId.get(planned.id);
    if (frequency === undefined) continue;
    const startSample = Math.round(
      (planned.timelineStartFrame / STORY_TIMELINE_FPS) * SAMPLE_RATE
    );
    const lengthSamples = Math.round(
      (planned.durationFrames / STORY_TIMELINE_FPS) * SAMPLE_RATE
    );
    const fadeInSamples = Math.round(
      (planned.fadeInFrames / STORY_TIMELINE_FPS) * SAMPLE_RATE
    );
    const fadeOutSamples = Math.round(
      (planned.fadeOutFrames / STORY_TIMELINE_FPS) * SAMPLE_RATE
    );
    const sourceOffsetSamples = Math.round(
      (planned.sourceInFrame / STORY_TIMELINE_FPS) * SAMPLE_RATE
    );
    for (let index = 0; index < lengthSamples; index += 1) {
      const target = startSample + index;
      if (target < 0 || target >= totalSamples) continue;
      let gain = planned.baseGain;
      if (fadeInSamples > 0 && index < fadeInSamples) {
        gain *= index / fadeInSamples;
      }
      if (fadeOutSamples > 0 && index > lengthSamples - fadeOutSamples) {
        gain *= Math.max(0, (lengthSamples - index) / fadeOutSamples);
      }
      // The tone fixtures are continuous sine waves, so the source crop is a
      // phase offset rather than different content.
      const t = (sourceOffsetSamples + index) / SAMPLE_RATE;
      out[target] += Math.sin(2 * Math.PI * frequency * t) * TONE_AMPLITUDE * gain;
    }
  }
  return out;
}

/** Goertzel magnitude for one frequency over a window — no FFT needed. */
function toneMagnitude(
  samples: Float32Array,
  frequency: number,
  startSec: number,
  endSec: number
): number {
  const start = Math.max(0, Math.round(startSec * SAMPLE_RATE));
  const end = Math.min(samples.length, Math.round(endSec * SAMPLE_RATE));
  const count = end - start;
  if (count <= 0) return 0;
  const omega = (2 * Math.PI * frequency) / SAMPLE_RATE;
  const coeff = 2 * Math.cos(omega);
  let s1 = 0;
  let s2 = 0;
  for (let index = start; index < end; index += 1) {
    const s0 = samples[index] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return Math.sqrt(s1 * s1 + s2 * s2 - coeff * s1 * s2) / (count / 2);
}

const dbOf = (value: number) => 20 * Math.log10(Math.max(value, 1e-9));

async function decodeMonoPcm(mediaPath: string, dir: string, name: string) {
  const pcmPath = path.join(dir, name);
  await ffmpeg([
    "-i",
    mediaPath,
    "-map",
    "0:a:0",
    "-ac",
    "1",
    "-ar",
    String(SAMPLE_RATE),
    "-f",
    "f32le",
    pcmPath,
  ]);
  return channelSamples(await readFile(pcmPath));
}

async function makeTone(
  dir: string,
  name: string,
  frequency: number,
  seconds: number
) {
  const filePath = path.join(dir, name);
  await ffmpeg([
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=${frequency}:sample_rate=${SAMPLE_RATE}:duration=${seconds}`,
    "-c:a",
    "pcm_f32le",
    filePath,
  ]);
  const probe = await decodeMonoPcm(filePath, dir, `${name}.probe.f32le`);
  let peak = 0;
  for (let index = 0; index < probe.length; index += 1) {
    peak = Math.max(peak, Math.abs(probe[index]));
  }
  expect(peak).toBeCloseTo(TONE_AMPLITUDE, 3);
  return filePath;
}

async function makeSilentVisual(dir: string, name: string, seconds: number) {
  const filePath = path.join(dir, name);
  await ffmpeg([
    "-f",
    "lavfi",
    "-i",
    `color=c=black:s=320x180:r=${STORY_TIMELINE_FPS}:d=${seconds}`,
    "-an",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    filePath,
  ]);
  return filePath;
}

describe("timeline media executor parity (frequency domain)", () => {
  it(
    "renders each track at its own frequency, drops a muted track, and matches the reference mixer within 1 frame / 0.5 dB",
    async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "timeline-media-freq-"));
      workDirs.push(dir);
      const totalFrames = 90; // 3s
      const visual = await makeSilentVisual(dir, "visual.mp4", 3);
      const musicTone = await makeTone(dir, "music.wav", 440, 3);
      const ambienceTone = await makeTone(dir, "ambience.wav", 1200, 3);
      const mutedTone = await makeTone(dir, "sfx.wav", 3000, 3);

      // music: full span, half gain. ambience: second half only, unity gain.
      // sfx: muted -> its frequency must be absent from the output entirely.
      let state = emptyAudioState();
      for (const [id, kind, assetId, startFrame, outFrame, gain] of [
        ["m", "music", 1, 0, 90, 0.5],
        ["a", "ambience", 2, 45, 45, 1],
        ["s", "sfx", 3, 0, 90, 1],
      ] as const) {
        const inserted = insertAudioClip(state, {
          id,
          kind,
          assetId,
          timelineStartFrame: startFrame,
          sourceInFrame: 0,
          sourceOutFrame: outFrame,
          gain,
        });
        if (inserted.status !== "ok") throw new Error(inserted.message);
        state = inserted.state;
      }
      const muted = setAudioClipMuted(state, { clipId: "s", muted: true });
      if (muted.status !== "ok") throw new Error(muted.message);
      state = muted.state;

      const audioPlan = buildAudioMixPlan({ audioState: state });
      const fileByAsset = new Map([
        [1, musicTone],
        [2, ambienceTone],
        [3, mutedTone],
      ]);
      const resolvedAudioInputs: ResolvedAudioMixInput[] = audioPlan.inputs
        .filter(planned => !planned.muted && planned.baseGain > 0)
        .map(planned => ({
          input: planned,
          filePath: fileByAsset.get(
            planned.source.kind === "asset" ? planned.source.assetId : -1
          )!,
        }));

      const output = path.join(dir, "freq.mp4");
      await composeTimelineMedia({
        visualMasterPath: visual,
        outputPath: output,
        workDir: dir,
        totalFrames,
        dimensions: { width: 320, height: 180 },
        subtitlePlan: { cues: [], endFrame: 0 },
        audioPlan,
        resolvedAudioInputs,
      });

      const rendered = await decodeMonoPcm(output, dir, "freq.f32le");
      const reference = renderPlanReference({
        plan: audioPlan,
        totalFrames,
        toneByInputId: new Map([
          ["m", 440],
          ["a", 1200],
          ["s", 3000],
        ]),
      });

      // A muted track never reaches the output.
      expect(dbOf(toneMagnitude(rendered, 3000, 0.3, 1.2))).toBeLessThan(-40);

      // Window A (0.3–1.2s): music only. Window B (1.8–2.7s): music + ambience.
      const windows: Array<[number, number, number]> = [
        [440, 0.3, 1.2],
        [440, 1.8, 2.7],
        [1200, 1.8, 2.7],
      ];
      for (const [frequency, startSec, endSec] of windows) {
        const renderedDb = dbOf(
          toneMagnitude(rendered, frequency, startSec, endSec)
        );
        const referenceDb = dbOf(
          toneMagnitude(reference, frequency, startSec, endSec)
        );
        expect(Math.abs(renderedDb - referenceDb)).toBeLessThanOrEqual(0.5);
      }

      // Ambience is absent before its start and present after — the boundary is
      // correct to within one 30fps frame on either side.
      const frameSec = 1 / STORY_TIMELINE_FPS;
      expect(
        dbOf(toneMagnitude(rendered, 1200, 0.3, 1.5 - frameSec))
      ).toBeLessThan(-40);
      expect(
        dbOf(toneMagnitude(rendered, 1200, 1.5 + frameSec, 2.7))
      ).toBeGreaterThan(-20);
    },
    60_000
  );

  it(
    "keeps a linked ChatCut source from double-playing the video's own audio",
    async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "timeline-media-dedupe-"));
      workDirs.push(dir);
      const totalFrames = 60; // 2s
      const visual = await makeSilentVisual(dir, "visual.mp4", 2);
      const sourceTone = await makeTone(dir, "source.wav", 440, 2);
      const musicTone = await makeTone(dir, "music.wav", 1200, 2);

      // One `source` clip explicitly linked to the video's embedded audio, plus
      // an independent music bed that must still be mixed.
      let state = emptyAudioState();
      const withSource = insertAudioClip(state, {
        id: "src",
        kind: "source",
        assetId: 1,
        timelineStartFrame: 0,
        sourceInFrame: 0,
        sourceOutFrame: 60,
        linkedVisualSourceId: "visual-1",
      });
      if (withSource.status !== "ok") throw new Error(withSource.message);
      state = withSource.state;
      const withMusic = insertAudioClip(state, {
        id: "bed",
        kind: "music",
        assetId: 2,
        timelineStartFrame: 0,
        sourceInFrame: 0,
        sourceOutFrame: 60,
      });
      if (withMusic.status !== "ok") throw new Error(withMusic.message);
      state = withMusic.state;

      const audioPlan = buildAudioMixPlan({
        audioState: state,
        visualSources: [
          {
            id: "visual-1",
            timelineStartFrame: 0,
            sourceInFrame: 0,
            sourceOutFrame: 60,
            durationFrames: 60,
            gain: 1,
            muted: false,
          },
        ],
      });

      // The planner, not the executor, decides the de-duplication.
      expect(audioPlan.suppressedVisualSourceIds).toContain("visual-1");
      expect(
        audioPlan.inputs.filter(
          planned => planned.source.kind === "visual-source"
        )
      ).toHaveLength(0);
      expect(audioPlan.inputs.map(planned => planned.id).sort()).toEqual([
        "bed",
        "src",
      ]);

      const fileByAsset = new Map([
        [1, sourceTone],
        [2, musicTone],
      ]);
      const output = path.join(dir, "dedupe.mp4");
      await composeTimelineMedia({
        visualMasterPath: visual,
        outputPath: output,
        workDir: dir,
        totalFrames,
        dimensions: { width: 320, height: 180 },
        subtitlePlan: { cues: [], endFrame: 0 },
        audioPlan,
        resolvedAudioInputs: audioPlan.inputs.map(planned => ({
          input: planned,
          filePath: fileByAsset.get(
            planned.source.kind === "asset" ? planned.source.assetId : -1
          )!,
        })),
      });

      const { stdout } = await execFileAsync("ffprobe", [
        "-v",
        "error",
        "-show_entries",
        "stream=codec_type",
        "-of",
        "json",
        output,
      ]);
      const streams = (
        JSON.parse(stdout) as { streams: Array<{ codec_type: string }> }
      ).streams;
      // Exactly one audio stream: the single final mix pass.
      expect(streams.filter(s => s.codec_type === "audio")).toHaveLength(1);

      const rendered = await decodeMonoPcm(output, dir, "dedupe.f32le");
      const sourceDb = dbOf(toneMagnitude(rendered, 440, 0.4, 1.6));
      const musicDb = dbOf(toneMagnitude(rendered, 1200, 0.4, 1.6));
      // The linked source is heard once (not doubled ≈ +6 dB) and the
      // independent music bed is still mixed alongside it.
      expect(Math.abs(sourceDb - musicDb)).toBeLessThanOrEqual(0.5);
      expect(musicDb).toBeGreaterThan(-20);
    },
    60_000
  );
});
