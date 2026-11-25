const labels = { music: "音乐", narration: "有声书", sfx: "音效" } as const;
type BookAudioKind = keyof typeof labels;

/** Stable, owned audio reference carried by the manuscript and its versions. */
export function readBookAudio(
  text: string
): { storyId: number; assetId: number; title: string; kind: BookAudioKind; label: string; url: string } | null {
  const match =
    /^!\[(音乐|有声书|音效):([^\]]*)\]\(\/api\/story-audio-asset\/(\d+)\/(\d+)\)$/.exec(text);
  if (
    !match ||
    !Number.isSafeInteger(Number(match[3])) ||
    !Number.isSafeInteger(Number(match[4])) ||
    Number(match[3]) <= 0 ||
    Number(match[4]) <= 0
  )
    return null;
  try {
    return {
      title: decodeURIComponent(match[2]),
      label: match[1],
      kind: match[1] === "有声书" ? "narration" : match[1] === "音效" ? "sfx" : "music",
      storyId: Number(match[3]),
      assetId: Number(match[4]),
      url: `/api/story-audio-asset/${match[3]}/${match[4]}`,
    };
  } catch {
    return null;
  }
}
export function bookAudioText(storyId: number, assetId: number, title: string, kind: BookAudioKind = "music") {
  const text = `![${labels[kind]}:${encodeURIComponent(title.slice(0, 200))}](/api/story-audio-asset/${storyId}/${assetId})`;
  if (!readBookAudio(text)) throw new Error("音乐素材不可用");
  return text;
}
