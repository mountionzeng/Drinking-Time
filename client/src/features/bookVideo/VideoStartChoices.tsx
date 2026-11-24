import { useRef, useState } from "react";
import type { StoryMaterialState } from "@shared/storyMaterial";
import { useArtPreviewChat } from "@/features/storyAgent/useArtPreviewChat";

type Props = {
  storyId: number;
  material: StoryMaterialState;
  cues: readonly { text: string; startFrame: number }[];
  candidates: readonly { text: string; startFrame: number }[];
  shotLabels: ReadonlyMap<string, string>;
  musicCount: number;
  pending: boolean;
  error: string | null;
  generateSubtitles: () => Promise<void>;
  adoptImage: (imageId: number, stableShotId: string) => Promise<void>;
  openMusic: () => void;
  openBook: () => void;
};

export function VideoStartChoices({ storyId, material, cues, candidates, shotLabels, musicCount, pending, error, generateSubtitles, adoptImage, openMusic, openBook }: Props) {
  const [choice, setChoice] = useState<"images" | "subtitles" | null>(null);
  const [target, setTarget] = useState("");
  const [chosenSamples, setChosenSamples] = useState<string[] | null>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const lock = useRef(false);
  const preview = useArtPreviewChat();
  const sourceImages = material.shots.flatMap(s => s.imageGenerationReferences ?? []);
  const referenceCount = new Set(sourceImages.map(image => image.id)).size;
  const shot = material.shots.find(s => s.stableShotId === target)
    ?? material.shots.find(s => s.imageGenerationReferences?.length) ?? material.shots[0];
  const inset = Math.floor(material.shots.length * 0.15);
  const suggestedShots = [material.shots[inset], material.shots.at(-1 - inset)];
  const selectedIds = chosenSamples ?? suggestedShots.flatMap(s => s ? [s.stableShotId] : []);
  const samples = material.shots.filter(s => selectedIds.includes(s.stableShotId));
  const references = new Set(shot?.imageGenerationReferences?.map(image => image.id));
  const images = Array.from(new Map([...(shot?.imageGenerationReferences ?? []), ...(shot?.imageVersions ?? [])]
    .filter(image => image.availability !== "missing" && image.status !== "rejected")
    .map(image => [image.id, image])).values());
  const button = "rounded-md border border-border bg-background px-2 py-1.5 hover:bg-muted disabled:opacity-50";
  async function sample() {
    if (!samples.length || lock.current) return;
    lock.current = true;
    setWorking(true);
    setMessage("");
    try {
      const numbers = samples.map(s => s.shotNo).join("、");
      const result = await preview(storyId, `为第 ${numbers} 镜各生成四张基调示意图`, samples.map(s => s.stableShotId));
      setMessage(result?.reply ?? "未能开始试图，请重新选择镜头。");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "图片制作未完成。");
    } finally {
      lock.current = false;
      setWorking(false);
    }
  }
  const visibleCues = [...(cues.length ? cues : candidates)].sort((a, b) => a.startFrame - b.startFrame);
  const shortcut = "text-xs text-primary underline underline-offset-2 hover:text-foreground";
  return <div className="mt-1 space-y-1.5 text-xs">
    {shot ? <>
      <details className="text-muted-foreground"><summary className="cursor-pointer">已有素材</summary>
        <p>{material.shots.filter(s => s.currentImage || s.currentVideo).length}/{material.shots.length} 镜已采用画面{referenceCount > 0 && ` · 分镜参考图 ${referenceCount} 张`} · 字幕 {cues.length} 条 · 音乐轨 {musicCount} 段</p>
      </details>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        <button className={shortcut} aria-expanded={choice === "images"} onClick={() => setChoice(choice === "images" ? null : "images")}>选几镜试图定基调</button>
        <button className={shortcut} aria-expanded={choice === "subtitles"} onClick={() => setChoice(choice === "subtitles" ? null : "subtitles")}>{cues.length ? "查看已有字幕" : "从台词做字幕"}</button>
        <button className={shortcut} onClick={openMusic}>制作全片配乐</button>
      </div>
      {choice === "images" && <div className="space-y-2">
        <p>从故事前后挑镜头对照画风。每镜出四张候选，可勾选一至三镜。</p>
        <fieldset className="max-h-28 overflow-y-auto" aria-label="基调试图镜头">{material.shots.map(s => {
          const checked = samples.includes(s);
          return <label key={s.stableShotId} className="flex items-start gap-2 py-1">
            <input type="checkbox" checked={checked} disabled={working || (!checked && samples.length >= 3)} onChange={() => {
              setChosenSamples(checked ? selectedIds.filter(id => id !== s.stableShotId) : [...selectedIds, s.stableShotId]);
              setMessage("");
            }} />
            <span>第 {s.shotNo} 镜 · {shotLabels.get(s.stableShotId)?.slice(0, 32) || s.cueCode || s.shotNo}</span>
          </label>;
        })}</fieldset>
        <button className={button} disabled={working || !samples.length} onClick={() => void sample()}>{working ? "正在处理…" : samples.length ? `查看 ${samples.length} 镜 · ${samples.length * 4} 张试图报价` : "先选试图镜头"}</button>
        <div>查看本镜素材</div>
        <select aria-label="查看素材的镜头" value={shot.stableShotId} disabled={working} onChange={e => { setTarget(e.target.value); setMessage(""); }}>
          {material.shots.map(s => <option key={s.stableShotId} value={s.stableShotId}>第 {s.shotNo} 镜{s.cueCode ? ` · ${s.cueCode}` : ""}</option>)}
        </select>
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
        <p>{cues.length ? "字幕按播放顺序排列。双击字幕轨上的文字块可改字。" : candidates.length ? "按镜头时间整理出的字幕草稿，确认后放入字幕轨。" : "还没有可做字幕的台词，请先在分镜里补台词。"}</p>
        {visibleCues.length > 0 && <ol className="max-h-24 list-decimal overflow-y-auto pl-5">{visibleCues.map((c,i) => <li key={i}>{c.text}</li>)}</ol>}
        {!cues.length && candidates.length > 0 && <button className={button} disabled={pending} onClick={() => void generateSubtitles()}>确认放入 {candidates.length} 条字幕</button>}
        {error && <p role="alert">{error}</p>}
      </div>}
    </> : <><p>书稿提供故事和台词，分镜决定画面顺序和时长。有了分镜，就可以试图、做字幕或按全片时长配乐。</p><button className={button} onClick={openBook}>打开书稿</button></>}
  </div>;
}
