import { useRef, useState } from "react";
import type { StoryMaterialState } from "@shared/storyMaterial";
import { useArtPreviewChat } from "@/features/storyAgent/useArtPreviewChat";

type Props = {
  storyId: number;
  material: StoryMaterialState;
  cues: readonly { text: string }[];
  candidates: readonly { text: string }[];
  musicCount: number;
  pending: boolean;
  error: string | null;
  generateSubtitles: () => Promise<void>;
  adoptImage: (imageId: number, stableShotId: string) => Promise<void>;
  openMusic: () => void;
  openBook: () => void;
};

export function VideoStartChoices({ storyId, material, cues, candidates, musicCount, pending, error, generateSubtitles, adoptImage, openMusic, openBook }: Props) {
  const [choice, setChoice] = useState<"images" | "subtitles" | null>(null);
  const [target, setTarget] = useState("");
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const lock = useRef(false);
  const preview = useArtPreviewChat();
  const sourceImages = material.shots.flatMap(s => s.imageGenerationReferences ?? []);
  const referenceCount = new Set(sourceImages.map(image => image.id)).size;
  const shot = material.shots.find(s => s.stableShotId === target)
    ?? material.shots.find(s => s.imageGenerationReferences?.length) ?? material.shots[0];
  const references = new Set(shot?.imageGenerationReferences?.map(image => image.id));
  const images = Array.from(new Map([...(shot?.imageGenerationReferences ?? []), ...(shot?.imageVersions ?? [])]
    .filter(image => image.availability !== "missing" && image.status !== "rejected")
    .map(image => [image.id, image])).values());
  const button = "rounded-md border border-border bg-background px-2 py-1.5 hover:bg-muted disabled:opacity-50";
  async function sample() {
    if (!shot || lock.current) return;
    lock.current = true;
    setWorking(true);
    setMessage("");
    try {
      const result = await preview(storyId, `为第 ${shot.shotNo} 镜生成四张基调示意图`, shot.stableShotId);
      setMessage(result?.reply ?? "未能开始试图，请重新选择镜头。");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "图片制作未完成。");
    } finally {
      lock.current = false;
      setWorking(false);
    }
  }
  const visibleCues = cues.length ? cues : candidates;
  return <section aria-label="视频制作起点" className="mb-2 max-h-[32vh] space-y-2 overflow-auto rounded-lg border border-border bg-background p-3 text-xs">
    <p className="font-medium">{shot ? "这条视频，你想先做哪一部分？" : "先把故事拆成镜头"}</p>
    {shot ? <>
      <p>{material.shots.filter(s => s.currentImage || s.currentVideo).length}/{material.shots.length} 镜已采用画面{referenceCount > 0 && ` · 分镜参考图 ${referenceCount} 张`} · 字幕 {cues.length} 条 · 音乐轨 {musicCount} 段</p>
      <div className="flex flex-wrap gap-2">
        <button className={button} aria-expanded={choice === "images"} onClick={() => setChoice(choice === "images" ? null : "images")}>{referenceCount ? "看参考图或试图" : "试几张图定基调"}</button>
        <button className={button} aria-expanded={choice === "subtitles"} onClick={() => setChoice(choice === "subtitles" ? null : "subtitles")}>{cues.length ? "查看已有字幕" : "从台词做字幕"}</button>
        <button className={button} onClick={openMusic}>制作全片配乐</button>
      </div>
      {choice === "images" && <div className="space-y-2">
        <p>选一个镜头出四张候选，先比较画面，再决定采用哪张。</p>
        <select aria-label="试图镜头" value={shot.stableShotId} disabled={working} onChange={e => { setTarget(e.target.value); setMessage(""); }}>
          {material.shots.map(s => <option key={s.stableShotId} value={s.stableShotId}>第 {s.shotNo} 镜{s.cueCode ? ` · ${s.cueCode}` : ""}</option>)}
        </select>
        <button className={button} disabled={working} onClick={() => void sample()}>{working ? "正在处理…" : "查看四张试图报价"}</button>
        {images.length > 0 && <details open key={shot.stableShotId}><summary>比较本镜已有图片（{images.length}）</summary>
          <div className="grid grid-cols-2 gap-2 pt-2">{images.map(image =>
            <figure key={image.id}><a href={image.imageUrl} target="_blank" rel="noreferrer"><img loading="lazy" className="aspect-video w-full object-contain" src={image.imageUrl} alt={`第 ${shot.shotNo} 镜图片 #${image.id}`} /></a>
              {references.has(image.id) && <figcaption>分镜参考图</figcaption>}
              <button type="button" disabled={working || shot.currentImage?.id === image.id} className={button} onClick={async () => {
                if (lock.current) return;
                lock.current = true; setWorking(true);
                try { await adoptImage(image.id, shot.stableShotId); setMessage(`第 ${shot.shotNo} 镜已采用图片 #${image.id}。`); }
                catch (cause) { setMessage(cause instanceof Error ? cause.message : "图片尚未采用。"); }
                finally { lock.current = false; setWorking(false); }
              }}>{shot.currentImage?.id === image.id ? "当前画面" : "确认采用这张"}</button>
            </figure>)}</div></details>}
        {message && <p role="status">{message}</p>}
      </div>}
      {choice === "subtitles" && <div className="space-y-2">
        <p>{cues.length ? "剪辑线已保存这些字幕，可在字幕轨调整。" : candidates.length ? "按镜头时间整理出的字幕草稿，确认后放入字幕轨。" : "还没有可做字幕的台词，请先在分镜里补台词。"}</p>
        {visibleCues.length > 0 && <ol className="max-h-24 list-decimal overflow-y-auto pl-5">{visibleCues.map((c,i) => <li key={i}>{c.text}</li>)}</ol>}
        {!cues.length && candidates.length > 0 && <button className={button} disabled={pending} onClick={() => void generateSubtitles()}>确认放入 {candidates.length} 条字幕</button>}
        {error && <p role="alert">{error}</p>}
      </div>}
    </> : <><p>书稿提供故事和台词，分镜决定画面顺序和时长。有了分镜，就可以试图、做字幕或按全片时长配乐。</p><button className={button} onClick={openBook}>打开书稿</button></>}
  </section>;
}
