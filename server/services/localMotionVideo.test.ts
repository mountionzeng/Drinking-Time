import { describe, expect, it } from "vitest";

import { buildLocalMotionFfmpegArgs } from "./localMotionVideo";

describe("localMotionVideo", () => {
  it("builds a square ffmpeg zoom-pan render without an audio track", () => {
    const args = buildLocalMotionFfmpegArgs({
      imagePath: "/tmp/source.webp",
      outputPath: "/tmp/take.mp4",
      durationSec: 4,
      motion: {
        kind: "zoom-pan",
        zoomStart: 1,
        zoomEnd: 1.14,
        panStartX: 0.8,
        panStartY: 0,
        panEndX: -0.8,
        panEndY: 0,
      },
    });

    expect(args.find(value => value.startsWith("scale="))).toContain(
      "zoompan=z='1+(0.14)*on/119'"
    );
    expect(args).toContain("120");
    expect(args).toContain("-an");
    expect(args.join(" ")).toContain("s=1080x1080:fps=30");
    expect(args.at(-1)).toBe("/tmp/take.mp4");
  });
});
