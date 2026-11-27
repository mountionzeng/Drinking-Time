import { BookPageOrImage, BookPageCatalog } from "./BookPageExcerpt";
import { ChevronDown, FileText, Pencil } from "lucide-react";
import { pictureSourcePages, type PicturePage } from "@shared/pictureSourcePages";
import { PictureSourceLinks } from "./PictureSourceLinks";
import { useState, type ReactNode } from "react";
import { StoryboardEmotion } from "./StoryboardEmotion";
import { readBookShotChapter, shotDirections, shotMediaDirections, type BookShotChapter } from "@shared/bookShotDocument";
import { shotActionHeading, type ShotOutput } from "@shared/bookShotActions";
import { productionLabels, readProductionSeconds, type ProductionKind } from "@shared/bookShotProduction";
import { readShotField } from "@shared/bookShotFormat";
import { useUiText } from "@/features/uiLanguage/UiLanguage";

/** A heading-only legacy module contributes its format, while the next module supplies the words. */
function fieldText(lines: string[]) {
  return lines.map(line => {
    const heading = shotActionHeading(line);
    if (heading) return [heading.detail.replace(/^[ ·｜|]+/, ""), heading.inline].filter(Boolean).join("\n");
    const field = readShotField(line);
    return field ? field.inline : line;
  }).filter(Boolean).join("\n");
}

export type BookShotEditTarget = { chapterId: number; moduleId: string; offset: number; output?: ShotOutput; savedSourceKey?: string };
export function BookShotDocument({ chapters, storyId, sourceStoryId = storyId, showScenes, preceding = 0, initiallyOpen = false, onEdit }: { chapters: BookShotChapter[]; storyId?: number; sourceStoryId?: number; showScenes?: boolean; initiallyOpen?: boolean; preceding?: number; onEdit?(target: BookShotEditTarget): void }) {
  const ui = useUiText();
  const [open, setOpen] = useState(initiallyOpen);
  const count = chapters.reduce((sum, c) => sum + (c.blocks.writingStyle?.filter(r => r.format === "shot").length ?? 0), 0);
  if (!count) return null;
  let offset=preceding;
  const pages = open ? chapters.map(chapter => { const doc=readBookShotChapter(chapter,showScenes,offset);offset+=doc.shots.length;return doc; }) : [];
  const shots = pages.flatMap(p => p.shots);
  const audio = pages.flatMap(p => p.wholeAudio);
  const field = (label: string, value: string, edit?: () => void, detail = "", pages?: PicturePage[]) => (value.trim() || pages?.length) ? (
    <div className="mt-3"><dt className="mb-1 text-xs font-medium text-muted-foreground">{edit && onEdit
      ? <button type="button" className="underline decoration-dotted underline-offset-4 hover:text-foreground" onClick={edit}>{ui(label)}{detail}</button> : ui(label) + detail} {sourceStoryId && pages?.length ? <PictureSourceLinks storyId={sourceStoryId} pages={pages}/> : null}</dt>
      <dd className="whitespace-pre-line break-words leading-relaxed">{value}</dd></div>
  ) : null;
  const audioList = (items: typeof audio) => items.map(a => `${ui(a.label)} · ${a.title || '#' + a.assetId}`).join("\n");
  return <details open={open} className="group rounded-md border border-[var(--panel-border)] text-sm" onToggle={e => setOpen(e.currentTarget.open)}>
    <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-foreground focus-visible:outline-offset-2 [&::-webkit-details-marker]:hidden">
      <FileText aria-hidden="true" size={16} className="shrink-0 text-muted-foreground" />
      <span className="font-medium">{ui("镜头制作单")}</span>
      <span className="text-xs text-muted-foreground">{ui("{0} 个镜头", [count])}</span>
      <ChevronDown aria-hidden="true" size={15} className="ml-auto shrink-0 text-muted-foreground group-open:rotate-180" />
    </summary>
    {open && <BookPageCatalog storyId={sourceStoryId} urls={shots.flatMap(s=>s.images.filter(i=>!i.videoUrl).map(i=>i.url))}><div role="region" aria-label={ui("镜头制作单")} tabIndex={0} className="max-h-[55vh] overflow-y-auto overscroll-contain border-t border-[var(--panel-border)] px-4">
      {storyId && <StoryboardEmotion key={storyId} storyId={storyId} />}
      {shots.map((shot, index) => {
        const number = ui("第 {0} 镜", [String(preceding + index + 1).padStart(2, "0")]);
        const edit = (target?: { moduleId: string; offset: number }) => target && (() => onEdit?.({ chapterId: shot.chapterId, ...target }));
        const directions = shotDirections(shot.notes);
        const picture = pictureSourcePages(fieldText(directions.picture));
        const media = shotMediaDirections(directions, shot.title);
        const voiceTimings = directions.timing.filter(line => shotActionHeading(line)?.output === "narration");
        const voiceDetail = shot.dialogueText && voiceTimings.length === 1 ? shotActionHeading(voiceTimings[0])?.detail : "";
        const timing = voiceDetail ? directions.timing.filter(line => line !== voiceTimings[0]) : directions.timing;
        const seconds = readProductionSeconds(shot.notes.split("\n"));
        const make = (kind: ShotOutput) => onEdit?.({chapterId:shot.chapterId, moduleId:shot.moduleId, offset:0, output:kind});
        const group = (kind: ProductionKind, content: string, extra?: ReactNode, detail = "") => <div data-production={kind} className="mt-3">
          <dt className="mb-1 text-xs font-medium text-muted-foreground">{onEdit
            ? <button type="button" className="underline decoration-dotted underline-offset-4 hover:text-foreground" title={ui("准备制作")} onClick={()=>make(kind)}>{ui(productionLabels[kind])}{detail}</button>
            : <>{ui(productionLabels[kind])}{detail}</>}</dt>
          <dd className="whitespace-pre-line break-words leading-relaxed">{content || <span className="text-xs text-muted-foreground">{ui("待定")}</span>}{extra}</dd>
        </div>;
        const subfield = (kind: "subtitle"|"sfx", label: string, words: string) => words && <div className="mt-1 text-sm">
          {onEdit ? <button type="button" className="mr-2 text-xs text-muted-foreground underline decoration-dotted" onClick={()=>make(kind)}>{ui(label)}</button> :
            <span className="mr-2 text-xs text-muted-foreground">{ui(label)}</span>}{words}</div>;
        return <article tabIndex={-1} key={shot.id} data-book-shot={shot.id} className="border-b border-[var(--panel-border)] py-4 last:border-0">
          <h3 className="flex flex-wrap items-baseline gap-x-3 gap-y-1"><span className="text-xs tabular-nums text-muted-foreground">{number}</span><span className="font-semibold">{shot.title}</span>
            {onEdit && <button type="button" className="ml-auto p-1 text-muted-foreground hover:text-foreground" aria-label={ui("编辑第 {0} 镜", [preceding + index + 1])} onClick={edit({ moduleId: shot.moduleId, offset: 0 })}><Pencil size={14} /></button>}</h3>
          {shot.link && <button type="button" className="text-xs text-muted-foreground underline decoration-dotted underline-offset-2"
            title={shot.link.reason} onClick={e=>{const card=shots.find(s=>s.chapterId===shot.chapterId && s.moduleId===shot.link?.sourceId);
              const target=card && e.currentTarget.closest('[role=region]')?.querySelector<HTMLElement>('[data-book-shot="'+CSS.escape(card.id)+'"]');
              target?.focus({preventScroll:true});target?.scrollIntoView({block:"nearest"});}}>
            {ui(shot.link.reason === "同一画面素材" ? "与第 {0} 镜共用图" : shot.link.reason === "同一分场" ? "与第 {0} 镜同场" : "承接第 {0} 镜",[String(shot.link.sourceNumber).padStart(2,"0")])} · {shot.link.sourceTitle}</button>}
          <dl>
            {field("镜头说明", directions.other.join("\n"))}
            {field("时长与节奏", fieldText(timing), edit(shot.targets.timing))}
            {field("情绪走向", fieldText(directions.emotion), edit(shot.targets.emotion))}
            {group("image", directions.picture.length ? media.picture : "", picture.pages.length && sourceStoryId
              ? <div><PictureSourceLinks storyId={sourceStoryId} pages={picture.pages}/></div> : null)}
            {group("video", media.video.split("\n").map(line=>readShotField(line)?.inline ?? line).filter(Boolean).join("\n"),
              subfield("subtitle","字幕",fieldText(directions.subtitle)), seconds === undefined ? "" : ui(" · {0} 秒",[seconds]))}
            {group("music",fieldText(directions.music),subfield("sfx","现场音效",fieldText(directions.sound)))}
            {group("narration",shot.dialogueText,undefined,voiceDetail || "")}
            {field("出处与创作处理", fieldText(directions.source), edit(shot.targets.source))}
            {field("本镜音频素材", audioList(shot.audio))}
          </dl>
          {shot.images.length > 0 && <div className="mt-3 flex gap-2 overflow-x-auto">{shot.images.map((image, i) =>
            <BookPageOrImage key={i} url={image.url} videoUrl={image.videoUrl} context={shot.title + " " + shot.dialogueText}><img loading="lazy" src={image.url} alt={ui("镜头参考图 {0}", [i + 1])} className="h-16 max-w-32 rounded object-contain" /></BookPageOrImage>)}</div>}
        </article>;
      })}
      {audio.length > 0 && <section className="py-4"><h3 className="font-medium">{ui("全片音频素材")}</h3>
        <p className="mt-2 whitespace-pre-line leading-relaxed">{audioList(audio)}</p></section>}
    </div></BookPageCatalog>}
  </details>;
}
