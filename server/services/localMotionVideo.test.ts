import { describe, expect, it } from "vitest";

import { buildLocalMotionFfmpegArgs } from "./localMotionVideo";

describe("localMotionVideo", () => {
  it("fits the full opening image in the book's vertical frame and writes ten seconds",()=>{
    const args=buildLocalMotionFfmpegArgs({imagePath:"frame.jpg",outputPath:"clip.mp4",durationSec:10,aspectRatio:"9:16",
      motion:{kind:"hold",zoomStart:1,zoomEnd:1,panStartX:0,panStartY:0,panEndX:0,panEndY:0}});
    expect(args.join(" ")).toContain("pad=1080:1920");
    expect(args.join(" ")).toContain("s=1080x1920");
    expect(args).toContain("300");
  });
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
