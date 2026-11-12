import path from "node:path";
import type {
  StoryTimelineImageClip,
  TimelineTransform,
} from "../../shared/storyMaterial";
import { renderExportImage } from "./videoExportImage";
import { runFfmpegCommand } from "./timelineMediaExport";

export type CompositeImageInterval = {
  imageId: number;
  startFrame: number;
  endFrame: number;
  clipStartFrame: number;
  durationFrames: number;
  transform: TimelineTransform;
  composition: NonNullable<StoryTimelineImageClip["composition"]>;
};

export function imageCompositionFilter(image: CompositeImageInterval): string {
  const { opacity, fadeInFrames, fadeOutFrames } = image.composition;
  const seconds = (frames: number) => (frames / 30).toFixed(6);
  return [
    "format=rgba",
    `loop=loop=${image.durationFrames}:size=1:start=0`,
    `trim=end_frame=${image.durationFrames}`,
    "setpts=N/(30*TB)",
    `colorchannelmixer=aa=${opacity}`,
    ...(fadeInFrames
      ? [`fade=t=in:st=0:d=${seconds(fadeInFrames)}:alpha=1`]
      : []),
    ...(fadeOutFrames
      ? [
          `fade=t=out:st=${seconds(Math.max(0, image.durationFrames - fadeOutFrames))}:d=${seconds(fadeOutFrames)}:alpha=1`,
        ]
      : []),
    `setpts=PTS+${seconds(image.clipStartFrame)}/TB`,
  ].join(",");
}

export async function compositeTimelineImages(input: {
  storyId: number;
  userId: number;
  workDir: string;
  visualMasterPath: string;
  images: CompositeImageInterval[];
  dimensions: { width: number; height: number };
  totalFrames: number;
}): Promise<string> {
  if (!input.images.length) return input.visualMasterPath;
  const paths: string[] = [];
  for (const [index, image] of input.images.entries()) {
    const file = path.join(input.workDir, `alpha-${index}.png`);
    await renderExportImage({
      ...input,
      imageId: image.imageId,
      transform: image.transform,
      outputPath: file,
      transparent: true,
    });
    paths.push(file);
  }
  // Keep a single output matrix/range while honoring each source frame's color
  // metadata. Otherwise disabling graph reinit would reinterpret later shots.
  const graph: string[] = [
    "[0:v]scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=colorspace=bt709:range=tv[base]",
  ];
  input.images.forEach((image, index) => {
    graph.push(
      `[${index + 1}:v]${imageCompositionFilter(image)}[alpha${index}]`
    );
    const base = index ? `layer${index - 1}` : "base";
    graph.push(
      `[${base}][alpha${index}]overlay=0:0:enable='gte(t,${(image.startFrame / 30).toFixed(6)})*lt(t,${(image.endFrame / 30).toFixed(6)})':eof_action=pass[layer${index}]`
    );
  });
  const output = path.join(input.workDir, "composited-master.mp4");
  // The visual master already has fixed dimensions/pixel format. Concatenated
  // shots can still change color metadata; reinitializing this graph would lose
  // buffered one-frame PNG inputs and reset their loop/fade state.
  await runFfmpegCommand(
    [
      "-y",
      "-reinit_filter",
      "0",
      "-i",
      input.visualMasterPath,
      ...paths.flatMap(p => ["-framerate", "30", "-i", p]),
      "-filter_complex",
      graph.join(";"),
      "-map",
      `[layer${input.images.length - 1}]`,
      "-an",
      "-r",
      "30",
      "-frames:v",
      String(input.totalFrames),
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "19",
      "-pix_fmt",
      "yuv420p",
      output,
    ],
    {
      timeoutMs: Math.min(
        30 * 60_000,
        Math.max(120_000, (input.totalFrames / 30) * 5_000)
      ),
    }
  );
  return output;
}
