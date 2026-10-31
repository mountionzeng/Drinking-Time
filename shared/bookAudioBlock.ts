/** Stable, owned audio reference carried by the manuscript and its versions. */
export function readBookAudio(
  text: string
): { storyId: number; assetId: number; title: string; kind: "music" | "narration"; url: string } | null {
  const match =
    /^!\[(音乐|有声书):([^\]]*)\]\(\/api\/story-audio-asset\/(\d+)\/(\d+)\)$/.exec(text);
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
      kind: match[1] === "有声书" ? "narration" : "music",
      storyId: Number(match[3]),
      assetId: Number(match[4]),
      url: `/api/story-audio-asset/${match[3]}/${match[4]}`,
    };
  } catch {
    return null;
  }
}
export function bookAudioText(storyId: number, assetId: number, title: string, kind: "music" | "narration" = "music") {
  const text = `![${kind === "narration" ? "有声书" : "音乐"}:${encodeURIComponent(title.slice(0, 200))}](/api/story-audio-asset/${storyId}/${assetId})`;
  if (!readBookAudio(text)) throw new Error("音乐素材不可用");
  return text;
}
