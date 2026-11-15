import type { SubtitleTrack } from "./timelineSubtitleModel";

// Read only explicit display instructions. Narrative, camera directions and
// dialogue do not become captions merely because they occur in a manuscript.
const labelledText = /(?:屏幕文字|字幕|画面文字)(?:淡入|渐显|出现|显示)?\s*[：:]\s*(?:「([^」\n]+)」|“([^”\n]+)”|"([^"\n]+)"|『([^』\n]+)』|([^\n。]+))/gu;
export function explicitScreenText(script: string): string[] {
  return [...script.matchAll(labelledText)].flatMap(match => {
    const text = match.slice(1).find(Boolean)?.trim();
    return text && !/^(?:无|无字幕|不显示|留白|none)$/i.test(text) ? [text] : [];
  });
}
export function stripExplicitScreenText(script: string): string {
  return script.replace(labelledText, "").replace(/^[\s。；]+/u, "").trim();
}

/** Separate from spoken dialogue; both tracks can be edited and exported. */
export function generatedScreenTextTrack(input: {
  shots: Array<{ stableShotId: string; scriptText?: string; publishingVideo?: unknown }>;
  spans: Array<{ stableShotId: string; startFrame: number; durationFrames: number }>;
  revision: number;
  nextId: () => string;
}): SubtitleTrack | undefined {
  const shots = new Map(input.shots.map(shot => [shot.stableShotId, shot]));
  const cues = input.spans.flatMap(span => {
    const shot = shots.get(span.stableShotId);
    const text = shot?.publishingVideo ? explicitScreenText(shot.scriptText ?? "").join("\n") : "";
    return text ? [{
      id: input.nextId(), text, startFrame: span.startFrame, durationFrames: span.durationFrames,
      provenance: { kind: "shot-screen-text" as const, stableShotId: span.stableShotId },
      sourceTextRevision: input.revision, textRevision: 1, textEdited: false, timingEdited: false,
    }] : [];
  });
  return cues.length ? {
    id: "screen-text", name: "Screen text",
    placement: { left: 0.1, top: 0.15, width: 0.8, fontSize: 0.045 }, cues,
  } : undefined;
}
