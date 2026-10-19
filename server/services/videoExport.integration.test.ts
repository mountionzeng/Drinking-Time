import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import sharp from "sharp";
import {
  DEFAULT_TIMELINE_TRANSFORM as transform,
  type StoryMaterialState,
} from "../../shared/storyMaterial";
import { SUBTITLE_TRACK_ID } from "../../shared/timelineSubtitleModel";
import { normalizePublishingAlbumTypographyLayout } from "../../shared/publishingAlbum";

const fixture = vi.hoisted(() => ({
  directory: "",
  material: null as unknown,
}));
vi.mock("./storyMaterials", () => ({
  getStoryMaterialState: async () => fixture.material,
  getOwnedStoryBody: async () => ({}),
}));
vi.mock("./videoMedia", () => ({ localVideoDir: () => fixture.directory }));
vi.mock("../persistence/storyVisualPersistence", () => ({
  loadAuthorizedStoryImage: async () => ({ imageUrl: "/api/images/red.png" }),
}));
vi.mock("./imageAssets", () => ({
  localImagePathForUrl: () => path.join(fixture.directory, "red.png"),
}));
import { exportStoryTimeline } from "./videoExport";

beforeAll(async () => {
  fixture.directory = await mkdtemp(
    path.join(os.tmpdir(), "timeline-export-test-")
  );
  await sharp({
    create: { width: 160, height: 90, channels: 3, background: "red" },
  })
    .png()
    .toFile(path.join(fixture.directory, "red.png"));
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=blue:s=160x90:r=30:d=1",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=1",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      path.join(fixture.directory, "blue.mp4"),
    ],
    { stdio: "ignore" }
  );
});
afterAll(async () => {
  await rm(fixture.directory, { recursive: true, force: true });
});

it("really encodes selected video, held image, subtitle, sound and an intentional gap", async () => {
  fixture.material = {
    storyId: 1,
    shots: [
      {
        stableShotId: "a",
        shotNo: 1,
        currentVideo: {
          id: 1,
          status: "available",
          videoKey: "blue.mp4",
          videoUrl: "/api/videos/blue.mp4",
          durationSec: 1,
          ranges: [],
          selectedSelectionType: "full_take",
        },
      },
      { stableShotId: "b", shotNo: 2, currentImage: { id: 2 } },
    ],
    timeline: {
      storyId: 1,
      version: 1,
      items: [
        {
          stableShotId: "a",
          included: true,
          position: 0,
          timelineStartFrame: 0,
          durationFrames: 30,
          plannedDurationMs: 1000,
          transform,
        },
        {
          stableShotId: "b",
          included: true,
          position: 1,
          timelineStartFrame: 45,
          durationFrames: 30,
          plannedDurationMs: 1000,
          transform,
        },
      ],
      extensions: {
        subtitleTracks: {
          tracks: [
            {
              id: SUBTITLE_TRACK_ID,
              cues: [
                {
                  id: "caption",
                  startFrame: 45,
                  durationFrames: 30,
                  text: "EXPORT TEST",
                  provenance: { kind: "manual" },
                },
              ],
            },
          ],
        },
      },
    },
    unassignedImages: [],
    unassignedVideos: [],
    reusableVideoTakes: [],
  } as unknown as StoryMaterialState;
  const result = await exportStoryTimeline({ storyId: 1, userId: 1 });
  expect(result.status, JSON.stringify(result)).toBe("ok");
  if (result.status !== "ok") return;
  const file = path.join(fixture.directory, result.videoKey);
  const probe = JSON.parse(
    execFileSync(
      "ffprobe",
      ["-v", "error", "-show_streams", "-show_format", "-of", "json", file],
      { encoding: "utf8" }
    )
  );
  expect(Number(probe.format.duration)).toBeCloseTo(2.5, 1);
  expect(
    probe.streams.map((stream: { codec_type: string }) => stream.codec_type)
  ).toEqual(["video", "audio"]);
  const frame = (time: string) =>
    execFileSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-ss",
        time,
        "-i",
        file,
        "-frames:v",
        "1",
        "-f",
        "image2pipe",
        "-vcodec",
        "png",
        "-",
      ],
      { maxBuffer: 8_000_000 }
    );
  const rgb = async (time: string) =>
    Array.from(
      await sharp(frame(time))
        .extract({ left: 20, top: 20, width: 1, height: 1 })
        .removeAlpha()
        .raw()
        .toBuffer()
    );
  expect((await rgb("0.5"))[2]).toBeGreaterThan(240);
  expect(Math.max(...(await rgb("1.2")))).toBeLessThan(10);
  expect((await rgb("2"))[0]).toBeGreaterThan(240);
  const { data } = await sharp(frame("2"))
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let whitePixels = 0;
  for (let i = 0; i < data.length; i += 3)
    if (data[i] > 210 && data[i + 1] > 210 && data[i + 2] > 210) whitePixels++;
  expect(whitePixels).toBeGreaterThan(100);
  const pcm = execFileSync(
    "ffmpeg",
    ["-v", "error", "-i", file, "-t", "0.8", "-f", "s16le", "-ac", "1", "-"],
    { maxBuffer: 1_000_000 }
  );
  let peak = 0;
  for (let i = 0; i < pcm.length; i += 2)
    peak = Math.max(peak, Math.abs(pcm.readInt16LE(i)));
  expect(peak).toBeGreaterThan(500);
}, 120_000);

it("rejects missing material by default and does not silently omit image text", async () => {
  const current = fixture.material as StoryMaterialState;
  const savedImage = current.shots[1].currentImage;
  current.shots[1].currentImage = null;
  const missing = await exportStoryTimeline({ storyId: 1, userId: 1 });
  expect(missing).toMatchObject({
    status: "error",
    error: expect.stringContaining("缺少素材"),
  });
  current.shots[1].currentImage = savedImage;
  current.timeline.items[1].imageTextOverlays = {
    "2": {
      text: "Do not drop me",
      typography: normalizePublishingAlbumTypographyLayout({
        kind: "region",
        fontId: "sans-serif",
      })!,
    },
  };
  const text = await exportStoryTimeline({ storyId: 1, userId: 1 });
  expect(text).toMatchObject({
    status: "error",
    error: expect.stringContaining("自定义文字层"),
  });
});
