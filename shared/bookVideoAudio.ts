/** Timings are derived from the existing recording; the manuscript remains authoritative. */
export type AlignedBookLine = {
  text: string;
  start: number;
  end: number;
  cutStart: number;
  cutEnd: number;
  probability: number;
};
export type BookAudioShot = {
  draftShotId: string;
  voiceText: string;
  durationSec?: number;
};
export type BookAudioPacing = {
  speed: number;
  durationFrames: number;
  shots: Array<{ draftShotId: string; durationFrames: number }>;
  lines: Array<
    AlignedBookLine & {
      draftShotId: string;
      audioStartFrame: number;
      audioFrames: number;
      startFrame: number;
      durationFrames: number;
    }
  >;
};
export type PreparedBookVideoAudio = {
  version: 1;
  durationFrames: number;
  shots: BookAudioPacing["shots"];
  narration?: {
    assetId: number;
    sourceAssetId: number;
    speed: number;
    lines: BookAudioPacing["lines"];
  };
  music: Array<{ assetId: number; sourceAssetId: number }>;
};
export function bookVoiceLines(text: string) {
  return text
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean);
}

/** Keep each shot's requested time when it fits; never cut or accelerate speech to fit it. */
export function planBookAudioPacing(
  shots: BookAudioShot[],
  aligned: AlignedBookLine[],
  speed = 0.9
): BookAudioPacing {
  if (!Number.isFinite(speed) || speed < 0.75 || speed > 1)
    throw new Error("Invalid narration speed");
  const expected = shots.flatMap(shot => bookVoiceLines(shot.voiceText));
  if (
    expected.length !== aligned.length ||
    expected.some((text, i) => text !== aligned[i].text)
  )
    throw new Error("Narration text does not match the storyboard");
  let previousEnd = 0;
  for (const line of aligned) {
    if (
      ![
        line.start,
        line.end,
        line.cutStart,
        line.cutEnd,
        line.probability,
      ].every(Number.isFinite) ||
      line.cutStart < previousEnd - 0.001 ||
      line.start < line.cutStart ||
      line.end <= line.start ||
      line.end > line.cutEnd ||
      line.probability < 0.15
    )
      throw new Error("Narration alignment is incomplete or uncertain");
    previousEnd = line.cutEnd;
  }
  let offset = 0,
    lineIndex = 0;
  const result: BookAudioPacing = {
    speed,
    durationFrames: 0,
    shots: [],
    lines: [],
  };
  for (const shot of shots) {
    const count = bookVoiceLines(shot.voiceText).length;
    const lines = aligned.slice(lineIndex, lineIndex + count);
    lineIndex += count;
    const lengths = lines.map(line =>
      Math.ceil(((line.cutEnd - line.cutStart) / speed) * 30)
    );
    const previous = result.lines.at(-1);
    const pauseAfter = (left: AlignedBookLine, right: AlignedBookLine) =>
      Math.max(
        21,
        Math.ceil(((right.cutStart - left.cutEnd) / speed) * 30) + 9
      );
    const lead =
      previous && lines.length
        ? Math.max(
            12,
            previous.audioStartFrame +
              previous.audioFrames +
              pauseAfter(previous, lines[0]) -
              offset
          )
        : 12;
    const pauses = lines.slice(1).map((line, i) => pauseAfter(lines[i], line));
    const tail = 18;
    const minimum = count
      ? lead +
        lengths.reduce((a, b) => a + b, 0) +
        pauses.reduce((a, b) => a + b, 0) +
        tail
      : 0;
    const durationFrames = Math.max(
      Math.round((shot.durationSec ?? 5) * 30),
      minimum
    );
    if (durationFrames > 3600)
      throw new Error("旁白调整后单镜超过两分钟，请先拆分镜头。");
    // Spread spare storyboard time across the existing breath gaps, including the tail.
    const spare = count ? Math.floor((durationFrames - minimum) / count) : 0;
    let cursor = offset + lead;
    lines.forEach((line, i) => {
      const startFrame =
        cursor + Math.round(((line.start - line.cutStart) / speed) * 30);
      const endFrame =
        cursor + Math.round(((line.end - line.cutStart) / speed) * 30);
      result.lines.push({
        ...line,
        draftShotId: shot.draftShotId,
        audioStartFrame: cursor,
        audioFrames: lengths[i],
        startFrame,
        durationFrames: Math.max(1, endFrame - startFrame),
      });
      cursor += lengths[i] + (pauses[i] ?? 0) + spare;
    });
    result.shots.push({ draftShotId: shot.draftShotId, durationFrames });
    offset += durationFrames;
  }
  result.durationFrames = offset;
  return result;
}
