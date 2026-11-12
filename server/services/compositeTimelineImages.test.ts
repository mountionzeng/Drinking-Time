import { expect, it, vi } from "vitest";
import sharp from "sharp";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { tmpdir } from "node:os";
import { compositeTimelineImages } from "./compositeTimelineImages";
import { DEFAULT_TIMELINE_TRANSFORM } from "../../shared/storyMaterial";
vi.mock("./videoExportImage", () => ({
  renderExportImage: vi.fn(async ({ outputPath }) => {
    const image = await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([
        {
          input: Buffer.from(
            '<svg width="64" height="64"><rect y="32" width="64" height="32" fill="blue"/></svg>'
          ),
        },
      ])
      .png()
      .toBuffer();
    await writeFile(outputPath, image);
  }),
}));
it("keeps the underlying video through transparent pixels and applies boundary fades", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "alpha-test-"));
  const ffmpeg = "ffmpeg";
  try {
    const source = path.join(dir, "base.mp4");
    execFileSync(ffmpeg, [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=red:s=64x64:r=30:d=1",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      source,
    ]);
    const output = await compositeTimelineImages({
      storyId: 1,
      userId: 1,
      workDir: dir,
      visualMasterPath: source,
      totalFrames: 30,
      dimensions: { width: 64, height: 64 },
      images: [
        {
          imageId: 1,
          startFrame: 0,
          endFrame: 30,
          clipStartFrame: 0,
          durationFrames: 30,
          transform: DEFAULT_TIMELINE_TRANSFORM,
          composition: { opacity: 1, fadeInFrames: 6, fadeOutFrames: 6 },
        },
      ],
    });
    const pixels = (frame: number) =>
      execFileSync(ffmpeg, [
        "-v",
        "error",
        "-i",
        output,
        "-vf",
        `select=eq(n\\,${frame})`,
        "-frames:v",
        "1",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "pipe:1",
      ]);
    const mid = pixels(15),
      first = pixels(0),
      last = pixels(29);
    const rgb = (p: Buffer, y: number) =>
      Array.from(p.subarray((y * 64 + 32) * 3, (y * 64 + 32) * 3 + 3));
    expect(rgb(mid, 10)[0]).toBeGreaterThan(230);
    expect(rgb(mid, 48)[2]).toBeGreaterThan(230);
    expect(rgb(first, 48)[0]).toBeGreaterThan(230);
    expect(rgb(last, 48)[0]).toBeGreaterThan(180);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 20000);

it("composites delayed image clips at their own source-independent timestamps", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "alpha-offset-test-"));
  try {
    const source = path.join(dir, "base.mp4");
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=red:s=64x64:r=30:d=165",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      source,
    ]);
    const images = [
      0, 184, 279, 386, 645, 1112, 1320, 1553, 1761, 2109, 2312, 2622, 2774,
      3174, 3336, 3589, 3798, 4001, 4178, 4316, 4747,
    ].map((startFrame, i, starts) => ({
      imageId: startFrame + 1,
      startFrame,
      endFrame: starts[i + 1] ?? 4950,
      clipStartFrame: startFrame,
      durationFrames: (starts[i + 1] ?? 4950) - startFrame,
      transform: DEFAULT_TIMELINE_TRANSFORM,
      composition: { opacity: 1, fadeInFrames: 6, fadeOutFrames: 6 },
    }));
    const output = await compositeTimelineImages({
      storyId: 1,
      userId: 1,
      workDir: dir,
      visualMasterPath: source,
      totalFrames: 4950,
      dimensions: { width: 64, height: 64 },
      images,
    });
    for (const frame of [90, 1200, 2460, 3720, 4890]) {
      const pixels = execFileSync("ffmpeg", [
        "-v",
        "error",
        "-i",
        output,
        "-vf",
        `select=eq(n\\,${frame})`,
        "-frames:v",
        "1",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "pipe:1",
      ]);
      expect(
        pixels[(48 * 64 + 32) * 3 + 2],
        `blue image at frame ${frame}`
      ).toBeGreaterThan(230);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 20000);

it("preserves pending overlays when concatenated shots change color metadata", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "alpha-color-change-test-"));
  try {
    for (const [name, colorArgs] of [
      ["first", []],
      ["second", ["-colorspace", "bt709", "-color_range", "tv"]],
    ] as const) {
      execFileSync("ffmpeg", [
        "-v",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=red:s=64x64:r=30:d=1",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        ...colorArgs,
        path.join(dir, `${name}.mp4`),
      ]);
    }
    const concat = path.join(dir, "concat.txt");
    await writeFile(concat, "file first.mp4\nfile second.mp4\n");
    const source = path.join(dir, "base.mp4");
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concat,
      "-c",
      "copy",
      source,
    ]);
    const output = await compositeTimelineImages({
      storyId: 1,
      userId: 1,
      workDir: dir,
      visualMasterPath: source,
      totalFrames: 60,
      dimensions: { width: 64, height: 64 },
      images: [
        {
          imageId: 1,
          startFrame: 36,
          endFrame: 60,
          clipStartFrame: 36,
          durationFrames: 24,
          transform: DEFAULT_TIMELINE_TRANSFORM,
          composition: { opacity: 1, fadeInFrames: 3, fadeOutFrames: 3 },
        },
      ],
    });
    const pixels = execFileSync("ffmpeg", [
      "-v",
      "error",
      "-i",
      output,
      "-vf",
      "select=eq(n\\,48)",
      "-frames:v",
      "1",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "pipe:1",
    ]);
    expect(pixels.length).toBe(64 * 64 * 3);
    expect(
      pixels[(48 * 64 + 32) * 3 + 2],
      "pending image survives the shot metadata change"
    ).toBeGreaterThan(230);
    expect(
      pixels[(10 * 64 + 32) * 3],
      "transparent area keeps the underlying video"
    ).toBeGreaterThan(230);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 20000);
