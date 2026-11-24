import type { BookVideoImportReview } from "@shared/bookVideoImportReview";

export function BookImportMaterials({ review }: { review: BookVideoImportReview }) {
  const music = review.audio.filter(clip => clip.kind === "music");
  return <div className="my-2 space-y-2">
    <p>{review.shots} 个分镜 · {review.images.length} 张书内图片 · {review.dialogue.length} 段已标记台词 · {music.length} 条音乐</p>
    {review.images.length > 0 && <div className="flex gap-2 overflow-x-auto">{review.images.map((url, i) =>
      <a key={url} href={url} target="_blank" rel="noreferrer"><img src={url} alt={`书内图片 ${i + 1}`} className="h-16 max-w-28 object-contain" /></a>)}</div>}
    {review.dialogue.length > 0 && <details><summary>查看字幕来源</summary><div className="whitespace-pre-line">{review.dialogue.join("\n")}</div></details>}
    {review.audio.map(clip => <div key={clip.assetId}>{clip.title || (clip.kind === "music" ? "背景音乐" : "旁白")}<audio className="w-full" controls preload="none" src={clip.url} /></div>)}
    {!review.images.length && !review.dialogue.length && !review.audio.length && <p>这版只有分镜。进入视频后，可以先试画面、从镜头台词整理字幕，或为全片制作音乐。</p>}
  </div>;
}
