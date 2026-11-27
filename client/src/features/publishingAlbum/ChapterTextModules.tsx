import { useUiText as useDesktopUiText } from "@/features/uiLanguage/UiLanguage";
import { MediaPlayer } from "@/components/ui/media-player";
import { useBookModuleActions } from "./bookModuleActions";
import { compositionSources } from '@shared/bookImageComposition';
import { gatherBookMaterials, useBookImageCompositionSession } from './bookImageCompositionSession';
import { toast } from 'sonner';
import { BookVideoStartButton } from "@/features/bookVideo/BookVideoStartButton";
import { useBookVideoSession } from '@/features/bookVideo/bookVideoSession';
import { mergeBookText } from "./mergeBookText";
import { INSERT_WAREHOUSE_BOOK, type WarehouseBookInsert } from "./warehouseBookInsert";
import { BookModuleConvert, type ModuleConversion } from "./BookModuleConvert";
import { readBookAudio } from "@shared/bookAudioBlock";
import { BookMusicInsert } from "./BookMusicInsert";
import { normalizeWritingColumns } from '@shared/bookWritingStyle';
import { useBookMediaSession } from "./bookMediaSession";
import { bookBlockNumbers } from "@shared/bookBlockNumbering";
import { storySpineStore } from "@/features/storyAgent/spine/storySpine";
import type { BookWritingStyle } from '@shared/bookWritingStyle';
import { blockAncestors, writingStyleOf, restoreStyledBlocks } from './chapterBlockTree';
import type { BookShotEditTarget } from "./BookShotDocument";
import { BookInlineImage } from "./BookImageCrop";
import { bookImageUrl, bookImageText, readBookImage } from "@shared/bookImageBlock";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject, type ReactNode } from 'react';
import { type TextPosition } from './moduleTextEditing';
import { writingBlockOffset, writingBlockPosition, splitWritingBlock, insertBlockText, blockBody, mergeWritingBlocks, restoreWritingBlocks, newWritingBlock, blockSubtreeEnd, isHeading, type WritingBlock } from './chapterBlockTree';
import { BookBlockCanvas } from './BookBlockCanvas';
import { deleteBookBlock } from './bookBlockLayout';
import { BookTextRangeOverlay, bookFieldStart, selectBookOffsets, syncBookTextScroll, useBookTextRange } from './useBookTextRange';
import { BookMathText } from './BookMathText';
import { BookDialogueText } from './BookDialogueText';
import { insideBookLatex, splitBookTextModules } from './bookLatex';
import { bookBlockContext, bookSelectionContext } from './bookBlockContext';
import { captureBookRewrite, applyBookRewrite } from './bookRewrite';
import { locateSentenceEdit, type SentenceEdit } from './sentenceEditTarget';
import { BookSentenceReview, reviewStillMatches, useBookSentenceReview } from './BookSentenceReview';
import type { BookRewriteTarget } from '@shared/bookRewrite';
import { textChanges } from './textChanges';
import { ChangedText, afterTextSlice, type WritingComparison } from './WritingComparison';
import type { LayoutModuleContext } from '@shared/layoutModuleContext';
import { BookImageImportBoundary } from './BookImageImportBoundary';
import { insertBookImages } from './bookImageInsert';

import { continuesShotHeading } from "./bookShotParagraph";
import { readShotField } from "@shared/bookShotFormat";
import { ShotSubtitlePreview } from "./ShotSubtitlePreview";
import { motionEditTarget, motionTextPrefix, readMotionDraft } from "./bookShotMotion";
import { requestsSilentTrack, shotActionHeading, shotOutputLabels, shotOutputSource, type ShotOutput } from "@shared/bookShotActions";

type Snapshot = TextPosition & { blocks: WritingBlock[] };
export function ChapterTextModules({ storyboard=false, showScenes, shotTarget, onShotFocused, reviewMedia, precedingShots, footerActions, importedChapterIds, prepareMedia, writingStyle, onFormattedChange, imageInsert, value, onChange, disabled, selection, formatScope, contextSource, onContextChange, comparison }: {
  storyboard?:boolean;
  showScenes?: boolean;
  reviewMedia?: boolean;
  shotTarget?: BookShotEditTarget | null; onShotFocused?(): void;
  precedingShots?: number;
  footerActions?: ReactNode;
  importedChapterIds?: readonly string[];
  prepareMedia?(): Promise<void>;
  writingStyle?: BookWritingStyle;
  onFormattedChange?(body:string,style:BookWritingStyle):void;
  imageInsert?: MutableRefObject<((url: string) => void) | null>;
  comparison?: WritingComparison;
  value: string; onChange(value: string): void; disabled: boolean;
  selection: MutableRefObject<TextPosition | null>; formatScope?: string;
  contextSource?: { storyId: number; scope: string; chapterId: string };
  onContextChange?(context: LayoutModuleContext | null): void;
}) {
  const _ui = useDesktopUiText();
  const sentenceReview = useBookSentenceReview(contextSource);
  const changes = useMemo(() => comparison ? textChanges(comparison.body, value) : [], [comparison?.body, value]);
  // An imported heading can be visually open even if its previously saved
  // collapsed flag is true. Splitting that visible heading must still insert
  // text under the heading, never as a sibling chapter.
  const editableBlocks = (id: string) => importedChapterIds?.includes(id)
    ? blocks.map(item => item.id === id && item.collapsed ? { ...item, collapsed: false } : item)
    : blocks;
  const key = formatScope ? `chapter-block-formats:${formatScope}` : null;
  const [blocks, setBlocks] = useState(() => {
    if (writingStyle) return restoreStyledBlocks(value,writingStyle);
    try { return restoreWritingBlocks(value, key ? JSON.parse(localStorage.getItem(key) || 'null') : null); }
    catch { return restoreWritingBlocks(value, null); }
  });
  const inlineReviews = !comparison && !disabled && sentenceReview
    ? new Map([...sentenceReview.pending].filter(([, review]) => reviewStillMatches(blocks, review.proposal)))
    : undefined;
  // Legacy plain-text chapters have no stable module IDs on the server yet.
  // Persist the same IDs rendered here before media preparation can quote them.
  useLayoutEffect(() => {
    if (!writingStyle && onFormattedChange && blockBody(blocks) === value)
      onFormattedChange(value, writingStyleOf(blocks));
  }, [writingStyle, value, blocks, onFormattedChange]);
  const [conversion,setConversion]=useState<ModuleConversion|null>(null);
  useEffect(()=>setConversion(null),[formatScope]);
  const motion = useRef<{id: string; prompt: string} | null>(null);
  const [editingHeading, setEditingHeading] = useState<string | null>(null);
  const pendingMotion = useRef(0);
  const [captions,setCaptions] = useState<{moduleId:string; title:string; text:string; heading:string; seconds:number}|null>(null);
  function editShotMenu(index:number, kind:ShotOutput) {
    if (kind !== "video" || bookImageUrl(blocks[index].text)) return produceShot(index,kind);
    const source = shotOutputSource(blocks,index,kind);
    if (!source || disabled) return;
    try {
      const target = motionEditTarget(blocks,source.owner.id,blocks[index].id);
      const at = target.blocks.findIndex(b => b.id === target.id);
      const heading = shotActionHeading(target.blocks[at].text);
      // A mixed legacy block may hold this cue further down its raw manuscript.
      setEditingHeading(heading && !motionTextPrefix(target.blocks[at].text) ? target.id : null);
      if (target.blocks !== blocks) commit(target.blocks,writingBlockOffset(target.blocks,at) + target.cursor,false);
      requestAnimationFrame(() => {
        const field = fields.current.find(el => el?.dataset.bookTextId === target.id);
        if (!field) return;
        field.focus(); selectBookOffsets(field,target.cursor); field.scrollIntoView({block:"nearest"});
      });
    } catch (error) { toast.error(error instanceof Error ? error.message : _ui("无法打开本镜。")); }
  }
  async function prepareShotVideo(shotId:string, selectedImage?:string) {
    const scope = mountedScope.current, request = ++pendingMotion.current;
    const latest = mediaLatest.current;
    if (!scope || latest.disabled || !latest.prepareMedia) return;
    const promptOf = (rows:WritingBlock[]) => readMotionDraft(rows,shotId).values.map(s=>s.trim()).filter(Boolean).join("\n\n");
    const prompt = promptOf(latest.blocks);
    const images = latest.blocks.filter(b => b.parentId === shotId && bookImageUrl(b.text));
    const image = selectedImage ? images.find(b=>b.id===selectedImage) : images.length===1 ? images[0] : undefined;
    if (!prompt) { toast.info(_ui("请补充运镜要求。")); return; }
    if (prompt.length > 2000) { toast.info(_ui("渲染一次最多使用 2000 字运镜要求。")); return; }
    if (!images.length) { toast.info(_ui("本镜还缺起始画面。请从「画面描述」生成一张图，或在本镜插入图片。")); return; }
    if (!image) { toast.info(_ui("请在要用作起始画面的图片菜单中选择「视频」。")); return; }
    await latest.prepareMedia();
    if (mountedScope.current !== scope || request !== pendingMotion.current || mediaLatest.current.disabled) return;
    const current = mediaLatest.current.blocks;
    if (promptOf(current) !== prompt || !current.some(b=>b.parentId===shotId && b.id===image.id && b.text===image.text)) {
      toast.info(_ui("本镜已变化，请重新选择。")); return;
    }
    motion.current={id:image.id,prompt}; setSelectedModuleIds([]); setActiveId(image.id); setMediaSelection(n=>n+1);
  }
  function produceShot(index:number,kind:ShotOutput) {
    const source=shotOutputSource(blocks,index,kind);
    if(!source)return;
    if(kind==="video") {
      void prepareShotVideo(source.owner.id,bookImageUrl(blocks[index].text)?blocks[index].id:undefined)
        .catch(error=>toast.error(error instanceof Error ? error.message : _ui("准备视频失败，请重试。")));
      return;
    }
    if(!source.prompt && kind !== "music") {toast.info(_ui("请先填写本镜的{0}",[_ui(shotOutputLabels[kind].name)]));return;}
    if(requestsSilentTrack(kind, source.prompt)) {toast.info(_ui("本镜已标明留白，可以直接继续。"));return;}
    if(kind==="subtitle") {
      const children=blocks.filter(b=>b.parentId===source.owner.id);
      const duration=children.map(b=>b.text.match(/^(?:时长[：:]\s*)?(\d+(?:\.\d+)?)\s*秒/)).find(Boolean);
      const lastSecond=Number(source.label.match(/第\s*(\d+(?:\.\d+)?)\s*秒(?:前)?\s*(?:收住|结束|停止)/)?.[1]);
      setCaptions({moduleId:source.moduleId,title:source.owner.text,text:source.prompt,heading:source.label,
        seconds:Number(duration?.[1])||Math.max(lastSecond||0,5)});return;
    }
    const parts=source.parts.map(({id,text})=>({id,text}));
    setConversion({...parts[0],kind,heading:_ui(shotOutputLabels[kind].name)+(shotActionHeading(source.label)?.detail ?? ""),prompt:source.prompt,...(parts.length>1?{parts}:{})});
  }
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedModuleIds, setSelectedModuleIds] = useState<string[]>([]);
  const textRange = useBookTextRange({ blocks, disabled: disabled || Boolean(comparison), scope: formatScope, selection, commit });
  const latestReview = inlineReviews && [...inlineReviews.values()].at(-1);
  const latestReviewId = latestReview?.id;
  const latestReviewBlock = latestReview?.proposal.target.parts[0].id;
  useLayoutEffect(() => {
    if (!latestReviewBlock) return;
    const frame = requestAnimationFrame(() => {
      const preview = textRange.root.current?.querySelector<HTMLElement>(
        `[data-book-sentence-review="${CSS.escape(latestReviewBlock)}"]`
      );
      preview?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [latestReviewId, latestReviewBlock, textRange.root]);
  const [mediaSelection, setMediaSelection] = useState(0);
  const module = useMemo(() => contextSource && blockBody(blocks) === value
    ? (selectedModuleIds.length > 1 ? bookSelectionContext(blocks, selectedModuleIds, contextSource) : bookBlockContext(blocks, activeId, contextSource)) : null,
    [blocks, activeId, selectedModuleIds, value, contextSource?.storyId, contextSource?.scope, contextSource?.chapterId]);
  useLayoutEffect(() => { onContextChange?.(module); }, [module, onContextChange]);
  const mediaLatest = useRef({ blocks, disabled, prepareMedia });
  mediaLatest.current = { blocks, disabled, prepareMedia };
  const commitLatest = useRef(commit); commitLatest.current = commit;
  const compositionSelection = useRef<string[]>([]);
  compositionSelection.current = selectedModuleIds.length ? selectedModuleIds : activeId ? [activeId] : [];
  const mountedScope = useRef(contextSource?.scope);
  mountedScope.current = contextSource?.scope;
  useEffect(() => () => { mountedScope.current = undefined; }, []);
  async function composeImage(instruction = '', requestedIds?: string[], resumeOnly = false) {
    if (!contextSource || !mediaLatest.current.prepareMedia || mediaLatest.current.disabled) throw new Error('请先打开可编辑的文章');
    const scope = contextSource.scope, spine = storySpineStore.getState();
    const sources = compositionSources(mediaLatest.current.blocks, requestedIds ?? compositionSelection.current);
    const assertSource = () => {
      const latest = mediaLatest.current, current = storySpineStore.getState();
      if (mountedScope.current !== scope || latest.disabled || current.accountId !== spine.accountId || current.storyScopeEpoch !== spine.storyScopeEpoch || sources.some(s => latest.blocks.find(b => b.id === s.id)?.text !== s.text))
        throw new Error('文章或所选模块已变化，请重新选择');
    };
    assertSource();
    await mediaLatest.current.prepareMedia();
    assertSource();
    gatherBookMaterials(sources.map(s => s.id));
    useBookMediaSession.getState().setSession(null);
    useBookVideoSession.getState().setSession(null);
    useBookImageCompositionSession.getState().setSession({
      key: crypto.randomUUID(), scope, accountId: spine.accountId, epoch: spine.storyScopeEpoch,
      createdAt:Date.now(),resumeOnly,
      storyId: contextSource.storyId, chapterId: Number(contextSource.chapterId), sources, instruction,
      prepare: async () => { assertSource(); await mediaLatest.current.prepareMedia!(); assertSource(); },
      insert: async (url, previousUrl) => {
        assertSource();
        const latest = mediaLatest.current.blocks;
        if (latest.some(b => bookImageUrl(b.text) === url)) return;
        const previousIndex = previousUrl ? latest.findIndex(b => bookImageUrl(b.text) === previousUrl) : -1;
        const anchor = Math.max(...sources.map(source => latest.findIndex(b => b.id === source.id)));
        const at = previousIndex >= 0 ? previousIndex : isHeading(latest[anchor]) ? blockSubtreeEnd(latest, anchor) : anchor + 1;
        let next = previousIndex >= 0 ? latest.map((b,i) => i === at ? { ...b, text: bookImageText(url) } : b)
          : [...latest.slice(0, at), newWritingBlock(bookImageText(url), latest[anchor].format === 'scene' || latest[anchor].format === 'shot' ? latest[anchor].id : latest[anchor].parentId), ...latest.slice(at)];
        if (previousIndex < 0 && (latest[anchor].format === 'scene' || latest[anchor].format === 'shot'))
          next = next.map(b => b.id === latest[anchor].id ? {...b, collapsed:false} : b);
        if (blockBody(next).length > 200000) throw new Error('文章已达到长度上限');
        commitLatest.current(next, writingBlockOffset(next, at), false);
        // Wait for the editor's state/save closure to see the inserted block.
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        if (mountedScope.current !== scope) throw new Error('已切换文章');
        await mediaLatest.current.prepareMedia!();
      },
    });
  }
  const composeLatest = useRef(composeImage); composeLatest.current = composeImage;
  const warehouseAnchor=useRef(activeId);warehouseAnchor.current=activeId;
  useLayoutEffect(() => {
    if (!contextSource || disabled || comparison || blockBody(blocks) !== value) return;
    const session = {
      scope: contextSource.scope, storyId: contextSource.storyId,
      chapterId:Number(contextSource.chapterId),
      chapterDocument: { body: value, blocks, chapterId: contextSource.chapterId },
      composeImage: (instruction?: string, ids?: string[]) => composeLatest.current(instruction, ids),
      resumeImageComposition: async (task: import('@shared/bookModuleImageTask').BookModuleImageTask) => {
        assertCurrent();
        if(task.chapterId!==Number(contextSource.chapterId) || !task.composition) throw new Error('请先打开此方案对应的文章');
        const expected=task.composition.sources;
        const actual=compositionSources(mediaLatest.current.blocks,expected.map(s=>s.id));
        if(JSON.stringify(actual)!==JSON.stringify(expected)) throw new Error('原素材已变化，请重新选择素材开始方案；旧版仍可查看');
        await composeLatest.current('',expected.map(s=>s.id),true);
      },
      modules: blocks.filter(block => !readBookImage(block.text) && !readBookAudio(block.text))
        .map(block => ({ id: block.id, text: block.text })),
      captureRewrite(module: LayoutModuleContext) {
        assertCurrent();
        if (module.storyId !== contextSource.storyId || module.scope !== contextSource.scope || module.kind !== 'text') return;
        const ids = module.selection?.ids ?? [module.moduleId];
        let range = textRange.getRange();
        if (!range && ids.length === 1 && selection.current && selection.current.end > selection.current.start) {
          const start = writingBlockPosition(blocks, selection.current.start), end = writingBlockPosition(blocks, selection.current.end);
          if (blocks[start.index]?.id === ids[0] && start.index === end.index)
            range = { anchor: { id: ids[0], offset: start.cursor }, focus: { id: ids[0], offset: end.cursor } };
        }
        return captureBookRewrite(blocks, ids, contextSource, range);
      },
      locateSentenceEdit(edit: SentenceEdit) {
        assertCurrent();
        return locateSentenceEdit(blocks, edit, contextSource);
      },
      replaceRewrite(target: BookRewriteTarget, text: string) {
        assertCurrent();
        if (target.storyId !== contextSource.storyId || target.scope !== contextSource.scope)
          throw new Error('请回到这次改写对应的文章。');
        const result = applyBookRewrite(blocks, target, text);
        textRange.clear();
        commitLatest.current(result.blocks, result.position, false);
        setSelectedModuleIds([]);
      },
      convert(id: string, kind: "image" | "music") {
        assertCurrent();
        const block = blocks.find(item => item.id === id);
        if (!block || readBookImage(block.text) || readBookAudio(block.text) || !mediaLatest.current.prepareMedia)
          throw new Error("当前模块无法转换，请重新选择文字模块。");
        setConversion({ id, text: block.text, kind });
      },
      merge(ids: string[]) {
        assertCurrent();
        if (ids.some(id => !session.modules.some(item => item.id === id)))
          throw new Error("模块已变化，请重新选择。");
        const next = mergeBookText(blocks, ids);
        const first = blocks.find(block => ids.includes(block.id));
        if (!first || next === blocks) throw new Error("请选择至少两个文字模块。");
        commitLatest.current(next, writingBlockOffset(next, next.findIndex(block => block.id === first.id)), false);
        setSelectedModuleIds([]); setActiveId(first.id);
      },
    };
    function assertCurrent() {
      if (useBookModuleActions.getState().session !== session || mediaLatest.current.disabled || mediaLatest.current.blocks !== blocks)
        throw new Error("文章已变化，请重新选择模块。");
    }
    useBookModuleActions.getState().setSession(session);
    return () => { if (useBookModuleActions.getState().session === session) useBookModuleActions.getState().setSession(null); };
  }, [contextSource?.scope, contextSource?.storyId, blocks, disabled, comparison, value]);

  useEffect(()=>{
    const insert=(event:Event)=>{
      const detail=(event as CustomEvent<WarehouseBookInsert>).detail,latest=mediaLatest.current;
      if(!contextSource || detail.storyId!==contextSource.storyId || detail.accepted || latest.disabled || comparison) return;
      const index=latest.blocks.findIndex(b=>b.id===warehouseAnchor.current),current=latest.blocks[index];
      const at=index<0?latest.blocks.length:isHeading(current)?blockSubtreeEnd(latest.blocks,index):index+1;
      const added=detail.text.split('\n').filter(t=>t.trim()).map(t=>newWritingBlock(t,current?.parentId??null));
      if(!added.length)return;
      const next=[...latest.blocks.slice(0,at),...added,...latest.blocks.slice(at)];
      if(blockBody(next).length>200000)return;
      commitLatest.current(next,writingBlockOffset(next,at),false);setActiveId(added[0].id);detail.accepted=true;
    };
    window.addEventListener(INSERT_WAREHOUSE_BOOK,insert);return ()=>window.removeEventListener(INSERT_WAREHOUSE_BOOK,insert);
  },[contextSource?.storyId,formatScope,comparison]);

  useLayoutEffect(() => {
    const block = blocks.find(item => item.id === activeId);
    const media = block && readBookImage(block.text);
    if (selectedModuleIds.length > 1 || !contextSource || !block || !media || !prepareMedia) {
      const current = useBookMediaSession.getState().session;
      if (current?.key.startsWith(`${formatScope}:`)) useBookMediaSession.getState().setSession(null);
      return;
    }
    const spine = storySpineStore.getState();
    const motionPrompt = motion.current?.id === block.id ? motion.current.prompt : undefined;
    const shotNumbers = bookBlockNumbers(writingStyleOf(blocks),precedingShots);
    const shotNo = blockAncestors(blocks,block.id).map(id=>shotNumbers.get(id)?.shotNumber).find(n=>n !== undefined);
    const key = `${formatScope}:${block.id}${motionPrompt ? ":motion:" + mediaSelection : ""}`;
    useBookMediaSession.getState().setSession({
      key, motionPrompt, shotNo, accountId: spine.accountId, epoch: spine.storyScopeEpoch,
      storyId: contextSource.storyId, chapterId: Number(contextSource.chapterId), moduleId: block.id, imageUrl: media.url,
      prepare: () => mediaLatest.current.prepareMedia!(),
      replace: async (sourceUrl, result) => {
        const latest = mediaLatest.current;
        const currentSpine = storySpineStore.getState();
        if (latest.disabled || currentSpine.accountId !== spine.accountId || currentSpine.storyScopeEpoch !== spine.storyScopeEpoch) return false;
        const index = latest.blocks.findIndex(item => item.id === block.id);
        const original = index >= 0 && readBookImage(latest.blocks[index].text);
        if (!original || original.url !== sourceUrl) return false;
        const next = latest.blocks.map((item, i) => i === index ? { ...item,
          text: result.cropped && result.imageUrl ? bookImageText(result.imageUrl,undefined,original.scale)
            : bookImageText(result.imageUrl ?? original.url, original.crop, original.scale, original.frame, result.videoUrl),
        } : item);
        commitLatest.current(next, writingBlockOffset(next, index), false);
        await mediaLatest.current.prepareMedia!();
        return true;
      },
    });
    return () => { if (useBookMediaSession.getState().session?.key === key) useBookMediaSession.getState().setSession(null); };
  }, [activeId, selectedModuleIds, mediaSelection, blocks, contextSource?.scope, formatScope, precedingShots]);
  const fields = useRef<Array<HTMLTextAreaElement | null>>([]);
  const focus = useRef<TextPosition | null>(null);
  const history = useRef<{ past: Snapshot[]; future: Snapshot[] }>({ past: [], future: [] });
  const [cacheError, setCacheError] = useState(false);
  useLayoutEffect(() => {
    if (!shotTarget || disabled || comparison) return;
    const index = blocks.findIndex(block => block.id === shotTarget.moduleId);
    if (index < 0) { onShotFocused?.(); return; }
    const open = new Set([...blockAncestors(blocks, shotTarget.moduleId), shotTarget.moduleId]);
    if (blocks.some(b => open.has(b.id) && b.collapsed)) {
      commit(blocks.map(b => open.has(b.id) ? { ...b, collapsed: false } : b), writingBlockOffset(blocks, index) + shotTarget.offset);
    } else {
      const field = fields.current[index];
      setActiveId(shotTarget.moduleId);
      field?.focus();
      if (field) selectBookOffsets(field,shotTarget.offset);
      field?.scrollIntoView({ block: "center" });
    }
    onShotFocused?.();
  }, [shotTarget, disabled, comparison]);
  // A different saved version must never inherit unrelated hierarchy by line number.
  const renderedBody = blockBody(blocks);
  useEffect(() => {
    if (renderedBody !== value) {
      setBlocks(writingStyle ? restoreStyledBlocks(value,writingStyle) : restoreWritingBlocks(value, null));
      history.current = { past: [], future: [] };
    }
  }, [value, renderedBody]);
  useEffect(() => {
    if (renderedBody !== value) return;
    try { if (key) localStorage.setItem(key, JSON.stringify({ body: value, blocks })); setCacheError(false); }
    catch { setCacheError(true); }
  }, [key, value, blocks, renderedBody]);
  useLayoutEffect(() => {
    if (focus.current) {
      const start = writingBlockPosition(blocks, focus.current.start), end = writingBlockPosition(blocks, focus.current.end);
      const field = fields.current[start.index];
      field?.focus(); if (field) selectBookOffsets(field,start.cursor, end.index === start.index ? end.cursor : start.cursor);
      focus.current = null;
    }
  }, [value, blocks]);
  function selected(index: number, field: HTMLTextAreaElement) {
    if (textRange.active()) return;
    setSelectedModuleIds([]);
    setActiveId(blocks[index].id);
    const offset = writingBlockOffset(blocks, index) + bookFieldStart(field);
    selection.current = { start: offset + field.selectionStart, end: offset + field.selectionEnd };
    window.dispatchEvent(new Event('dt:writing-selection-change'));
  }
  function snapshot(): Snapshot { return { blocks, ...(selection.current ?? { start: value.length, end: value.length }) }; }
  function commit(next: WritingBlock[], position: number, restoreFocus = true) {
    if (disabled || next === blocks || blockBody(next).length > 200000) return;
    next = normalizeWritingColumns(next);
    history.current.past.push(snapshot()); history.current.past = history.current.past.slice(-50); history.current.future = [];
    selection.current = { start: position, end: position };
    if (restoreFocus) focus.current = selection.current;
    setActiveId(next[writingBlockPosition(next, position).index]?.id ?? null);
    setBlocks(next);
    if (onFormattedChange) onFormattedChange(blockBody(next),writingStyleOf(next));
    else if (blockBody(next) !== value) onChange(blockBody(next));
  }
  useLayoutEffect(() => {
    if (!imageInsert) return;
    imageInsert.current = url => {
      if (disabled) return;
      const index = blocks.findIndex(block => block.id === activeId);
      const selected = blocks[index];
      const current = selected && importedChapterIds?.includes(selected.id) ? { ...selected, collapsed: false } : selected;
      const at = index < 0 ? blocks.length : isHeading(current) && current.collapsed ? blockSubtreeEnd(blocks,index) : index + 1;
      const parent = current ? isHeading(current) && !current.collapsed ? current.id : current.parentId : null;
      const image = newWritingBlock(bookImageText(url),parent);
      const next = [...blocks.slice(0,at),image,...blocks.slice(at)];
      commit(next,writingBlockOffset(next,at),false);
      setActiveId(image.id);
    };
    return () => {imageInsert.current = null;};
  });
  function travel(redo: boolean) {
    const source = redo ? history.current.future : history.current.past;
    const target = redo ? history.current.past : history.current.future;
    const previous = source.pop(); if (!previous) return;
    target.push(snapshot()); setBlocks(previous.blocks);
    selection.current = { start: previous.start, end: previous.end }; focus.current = selection.current;
    setActiveId(previous.blocks[writingBlockPosition(previous.blocks, previous.start).index]?.id ?? null);
    if (onFormattedChange) onFormattedChange(blockBody(previous.blocks),writingStyleOf(previous.blocks));
    else onChange(blockBody(previous.blocks));
  }
  function renderField(block: WritingBlock, index: number, style: CSSProperties) {
    const audio = readBookAudio(block.text);
    if (audio) return <div key={block.id} aria-label={_ui("{0}模块 {1}", [_ui(audio.label), index + 1])} onClick={() => setActiveId(block.id)} className="h-full w-full overflow-hidden">
      <p className="truncate text-sm">♫ {audio.title}</p><MediaPlayer kind="audio" aria-label={audio.title} controls preload="none" src={audio.url} className="h-10 w-full" />
    </div>;
    const imageUrl = bookImageUrl(block.text);
    if (imageUrl) return <div key={block.id} role="button" tabIndex={disabled ? -1 : 0} aria-label={_ui("图片模块 {0}", [index + 1])} data-book-inline-image={block.id} aria-keyshortcuts="Backspace Delete" aria-disabled={disabled} className="block h-full w-full text-left focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary" onKeyDown={event => {
      if(disabled || event.target !== event.currentTarget) return;
      if (comparison && ['Delete','Backspace'].includes(event.key) && !event.repeat && !event.defaultPrevented && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229 && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        const next = deleteBookBlock(blocks, block.id);
        commit(next, writingBlockOffset(next, Math.min(index, next.length - 1)));
        return;
      }
      if(event.key === 'Enter') { event.preventDefault(); const next = [...blocks]; next.splice(index+1,0,newWritingBlock('',block.parentId)); commit(next,writingBlockOffset(next,index+1)); }
    }} onClick={event => {
      if (disabled || (event.target as Element).closest('video')) return;
      event.currentTarget.focus({preventScroll:true});
      motion.current = null;
      setMediaSelection(value => value + 1);
      setActiveId(block.id);
      const start = writingBlockOffset(blocks,index); selection.current = {start,end:start};
      window.dispatchEvent(new Event('dt:writing-selection-change'));
    }}><BookInlineImage text={block.text}/></div>;
    const review = inlineReviews?.get(block.id);
    if (review) {
      return <BookSentenceReview style={style} proposal={review.proposal} onResolve={() => sentenceReview?.resolve(review.id)} />;
    }
    const range = textRange.byId.get(block.id);
    const hasShot = block.parentId && blocks.some(b => b.id === block.parentId && b.format === "shot");
    const parsed = !comparison && block.format === "text" && (storyboard || hasShot && contextSource && prepareMedia) && shotActionHeading(block.text);
    const heading = parsed && (block.videoRole !== "dialogue" || parsed.output === "narration") && parsed;
    const prefix = heading && editingHeading !== block.id
      ? storyboard ? heading.prefix : heading.output === "video" ? motionTextPrefix(block.text) : ""
      : "";
    const nextBlock = blocks[index + 1];
    const joinedHeading = storyboard && heading && continuesShotHeading(blocks[index - 1], block);
    const separateBody = storyboard && heading && !heading.inline && nextBlock?.parentId === block.parentId &&
      nextBlock.format === "text" && nextBlock.text.trim() && (!readShotField(nextBlock.text.split("\n", 1)[0]) || continuesShotHeading(block, nextBlock)) &&
      !readBookImage(nextBlock.text) && !readBookAudio(nextBlock.text) && (!nextBlock.videoRole || heading.output === "narration");
    const visibleText = block.text.slice(prefix.length);
    const field = <textarea ref={element => { fields.current[index] = element; }} rows={1} aria-label={prefix && heading && heading.output === "video" ? _ui("运镜要求") : _ui("文字模块 {0}", [index + 1])} value={visibleText}
              data-book-text-start={prefix ? Math.min(prefix.length,block.text.length) : undefined}
              data-book-text-id={comparison ? undefined : block.id}
              disabled={disabled} maxLength={200000} placeholder={_ui("写下这一段…")} style={{ ...style, overflowWrap: 'anywhere', ...(range ? { color: 'transparent', caretColor: 'transparent' } : {}) }}
              className={comparison ? "col-start-1 row-start-1 block h-full min-h-[1.6em] w-full resize-none overflow-hidden border-0 bg-transparent px-1 py-0 text-transparent caret-foreground outline-none selection:bg-blue-200/50" : "block h-full w-full resize-none overflow-auto border-0 bg-transparent px-1 py-0 outline-none"}
              onBlur={() => setEditingHeading(null)} onFocus={event => selected(index, event.currentTarget)} onSelect={event => {
                // Browsers can deliver a pending selection event after Escape/blank-page blur.
                // Only the focused field may establish a new writing target.
                if (event.currentTarget.ownerDocument.activeElement === event.currentTarget) selected(index, event.currentTarget);
              }}
              onScroll={event => syncBookTextScroll(event.currentTarget)}
              onChange={event => {
                const field = event.currentTarget;
                if (textRange.active()) {
                  const data = (event.nativeEvent as InputEvent).data;
                  let start = 0, end = 0;
                  while (start < visibleText.length && start < field.value.length && visibleText[start] === field.value[start]) start++;
                  while (end < visibleText.length - start && end < field.value.length - start && visibleText[visibleText.length - end - 1] === field.value[field.value.length - end - 1]) end++;
                  textRange.replace(data ?? field.value.slice(start, field.value.length - end));
                  return;
                }
                // Preserve the existing paste-to-modules behavior for ordinary single-line blocks.
                if(!prefix && !block.text.includes('\n') && field.value.includes('\n')) {
                  const result=insertBlockText(editableBlocks(block.id),index,field.value);
                  const pieces=splitBookTextModules(field.value);
                  let offset=field.value.slice(0,field.selectionStart).replace(/\r\n?/g,'\n').length, piece=0;
                  while(piece<pieces.length-1&&offset>pieces[piece].length){offset-=pieces[piece].length+1;piece++;}
                  const cursorIndex=piece?result.insertedIndex+piece-1:index;
                  commit(result.blocks,writingBlockOffset(result.blocks,cursorIndex)+offset,true);
                  return;
                }
                // Existing internal line breaks belong to this module; only Enter splits it.
                const next=blocks.map((item,i)=>i===index?{...item,text:prefix + field.value}:item);
                commit(next,writingBlockOffset(next,index)+prefix.length+field.selectionStart,false);
              }}
              onKeyDown={event => {
                if (textRange.onKeyDown(event)) return;
                if (disabled || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
                const field = event.currentTarget; selected(index, field);
                if ((event.metaKey || event.ctrlKey) && !event.altKey && ['z', 'y'].includes(event.key.toLowerCase())) {
                  event.preventDefault(); travel(event.shiftKey || event.key.toLowerCase() === 'y'); return;
                }
                const adjacent = field.selectionStart !== field.selectionEnd ? undefined
                  : event.key === 'Backspace' && field.selectionStart === 0 ? blocks[index - 1]
                  : event.key === 'Delete' && field.selectionEnd === visibleText.length ? blocks[index + 1] : undefined;
                const image = adjacent && readBookImage(adjacent.text);
                if (adjacent && image) {
                  event.preventDefault();
                  if (event.repeat || event.metaKey || event.ctrlKey || event.altKey || image.videoUrl) return;
                  // A shot boundary can sit between two visible neighbours. A collapsed shot's last image cannot.
                  if (adjacent.parentId !== block.parentId && !Array.from(
                    textRange.root.current?.querySelectorAll<HTMLElement>('[data-book-inline-image]') ?? []
                  ).some(node => node.dataset.bookInlineImage === adjacent.id)) return;
                  const next = deleteBookBlock(blocks, adjacent.id);
                  const start = writingBlockOffset(next, next.findIndex(item => item.id === block.id));
                  commit(next, start + prefix.length + field.selectionStart);
                  return;
                }
                if (event.key === 'Enter') {
                  if (prefix) return; // Keep multiline camera instructions in the same cue.
                  event.preventDefault();
                  if (insideBookLatex(block.text,field.selectionStart)) {
                    const text=block.text.slice(0,field.selectionStart)+'\n'+block.text.slice(field.selectionEnd);
                    commit(blocks.map((item,i)=>i===index?{...item,text}:item),writingBlockOffset(blocks,index)+field.selectionStart+1);
                    return;
                  }
                  const result = splitWritingBlock(editableBlocks(block.id),index,field.selectionStart,field.selectionEnd);
                  commit(result.blocks, writingBlockOffset(result.blocks, result.insertedIndex));
                } else if (event.key === 'Backspace' && !field.selectionStart && !field.selectionEnd && index > 0) {
                  event.preventDefault();
                  if (prefix) return;
                  if (bookImageUrl(blocks[index-1].text) || readBookAudio(blocks[index-1].text)) return;
                  const next = mergeWritingBlocks(blocks, index - 1);
                  commit(next, writingBlockOffset(blocks, index) - 1);
                } else if (!prefix && event.key === 'Delete' && field.selectionStart === block.text.length && field.selectionEnd === block.text.length && index < blocks.length - 1) {
                  event.preventDefault();
                  if (bookImageUrl(blocks[index+1].text) || readBookAudio(blocks[index+1].text)) return;
                  commit(mergeWritingBlocks(blocks, index), writingBlockOffset(blocks, index) + block.text.length);
                }
              }} />;
    if (heading && (block.videoRole!=="dialogue" || heading.kind==="voice") && editingHeading !== block.id) {
      const {name,hint}=shotOutputLabels[heading.output];
      return <div className="h-full overflow-auto"><div data-book-prompt-preview={block.id} className="break-words px-1">
      {!joinedHeading && <button type="button" disabled={disabled || !hasShot || !prepareMedia || !contextSource} aria-label={_ui(name)+heading.detail} aria-description={_ui(hint)}
        className="group/cue inline-flex max-w-full items-baseline rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:text-foreground"
        onClick={event=>{event.stopPropagation();produceShot(index,heading.output);}}>
        <span aria-hidden="true" className="inline-grid text-left">
          <span className="col-start-1 row-start-1 group-hover/cue:invisible group-focus-visible/cue:invisible">{_ui(name)}</span>
          <span className="invisible col-start-1 row-start-1 underline underline-offset-2 group-hover/cue:visible group-focus-visible/cue:visible">{_ui(hint)}</span>
        </span>{heading.detail}
      </button>}
      {separateBody ? null : prefix ? <div className="relative" style={style}>
        <div aria-hidden="true" className="invisible whitespace-pre-wrap break-words px-1">{visibleText + "\u200b"}</div>
        <div className="absolute inset-0">
          <BookTextRangeOverlay text={visibleText} range={range && {start:Math.max(0,range.start-prefix.length),end:Math.max(0,range.end-prefix.length)}} style={style}/>
          {field}
        </div>
      </div> : <>
        <button type="button" disabled={disabled} aria-label={_ui("编辑原文")} className="ml-2 text-xs text-muted-foreground opacity-0 hover:opacity-100 focus:opacity-100" onClick={() => { setEditingHeading(block.id); requestAnimationFrame(() => fields.current[index]?.focus()); }}>✎</button>
        {heading.inline && <div className="whitespace-pre-wrap" style={style} onClick={() => { setEditingHeading(block.id); requestAnimationFrame(() => fields.current[index]?.focus()); }}>{heading.inline}</div>}
      </>}
    </div></div>;
    }
    if (!comparison) return <BookDialogueText dialogue={block.videoRole === 'dialogue'} style={style}><BookMathText text={block.text} id={block.id} style={style} sourceVisible={textRange.dragging||textRange.byId.size>0}><div className="relative h-full w-full" style={style}>
      <BookTextRangeOverlay text={block.text} range={range} style={style} />
      {field}
    </div></BookMathText></BookDialogueText>;
    const start = writingBlockOffset(blocks, index);
    return <BookDialogueText key={block.id} dialogue={block.videoRole === 'dialogue'} style={style}><div className="grid" style={style}>
      <div aria-hidden="true" className="pointer-events-none col-start-1 row-start-1 min-h-[1.6em] whitespace-pre-wrap break-words px-1" style={{ overflowWrap: 'anywhere' }}>
        <ChangedText changes={afterTextSlice(changes, start, start + block.text.length)} side="after" />{!block.text || block.text.endsWith('\n') ? '\u200b' : ''}
      </div>
      {field}
    </div></BookDialogueText>;
  }
  const content = <section ref={textRange.root} aria-label={_ui("书正文")}
    onPointerDownCapture={textRange.onPointerDownCapture} onCopy={textRange.onCopy} onCut={textRange.onCut} onPaste={textRange.onPaste}
    onKeyDown={event => {
    if (event.key === 'Escape') textRange.clear();
    if (disabled || event.target instanceof HTMLTextAreaElement || !(event.metaKey || event.ctrlKey) || event.altKey) return;
    if (['z', 'y'].includes(event.key.toLowerCase())) { event.preventDefault(); travel(event.shiftKey || event.key.toLowerCase() === 'y'); }
  }}>
    {comparison ? <div className="overflow-x-auto" aria-label={_ui("版本文字对比")}>
      <div className="grid min-w-[560px] grid-cols-2 gap-5">
        <article className="min-w-0 select-text border-r pr-4" aria-label={_ui("所选版本原文")}>
          <h3 className="text-sm font-medium">{comparison.label} · {comparison.title}</h3>
          {comparison.editorName && <p className="text-xs text-muted-foreground">{comparison.editorName}</p>}
          {comparison.note && <p className="text-xs text-muted-foreground">{comparison.note}</p>}
          <div className="mt-3 whitespace-pre-wrap break-words text-base leading-[1.6]" aria-label={_ui("旧稿文字")}><ChangedText changes={changes} side="before" />{!comparison.body && _ui("（空白）")}</div>
        </article>
        <article className="min-w-0" aria-label={_ui("当前版本编辑")}>
          <h3 className="mb-3 text-sm font-medium">{_ui("当前稿 · 可直接编辑")}</h3>
          <div className="space-y-0">{blocks.map((block, index) => renderField(block, index, { fontSize: 16, lineHeight: 1.6, overflowWrap: 'anywhere' }))}</div>
        </article>
      </div>
    </div> : <BookBlockCanvas storyboard={storyboard} shotMenu={storyboard && contextSource && prepareMedia ? editShotMenu : undefined} inlineReviewKey={inlineReviews && [...inlineReviews.values()].map(review => review.id).join()} showScenes={showScenes} precedingShots={precedingShots} importedChapterIds={importedChapterIds} onConvertSelection={contextSource && prepareMedia ? (ids,kind) => {
      const parts = blocks.filter(block => ids.includes(block.id) && (kind !== 'narration' || (!bookImageUrl(block.text) && !readBookAudio(block.text) && block.text.trim()))).map(({id,text}) => ({id,text}));
      if(parts.length < (kind === 'narration' ? 1 : 2)) return;
      if(parts.some(part => readBookAudio(part.text))) { toast.error('音乐模块暂不支持转换，请选择文字或图片模块'); return; }
      setConversion({ ...parts[0], kind, ...(parts.length > 1 ? { parts } : {}) });
    } : undefined} onComposeImage={contextSource && prepareMedia ? ids => { void composeImage('', ids).catch(e => toast.error(e instanceof Error ? e.message : '未能整理素材')); } : undefined} onConvert={contextSource && prepareMedia ? (id,kind)=>{
      const block=blocks.find(b=>b.id===id);if(block)setConversion({id,text:block.text,kind});
    }:undefined} textSelectionIds={textRange.selectionRequest} onSelectionChange={setSelectedModuleIds} activeId={activeId} onSelect={id => {
      motion.current = null;
      if (!id) { selection.current = null; textRange.clear(); setSelectedModuleIds([]); }
      if (id && bookImageUrl(blocks.find(block => block.id === id)?.text ?? "")) setMediaSelection(value => value + 1);
      setActiveId(id);
      const index = blocks.findIndex(block => block.id === id);
      if (index >= 0 && id !== activeId) {
        const start = writingBlockOffset(blocks, index);
        selection.current = { start, end: start };
      }
    }} blocks={blocks} disabled={disabled} onCommit={(next, id, restoreFocus = true, cursorOffset = 0) => {
      commit(next, writingBlockOffset(next, Math.max(0, next.findIndex(block => block.id === id))) + cursorOffset, restoreFocus);
    }}>{renderField}
    </BookBlockCanvas>}
    {captions && contextSource && prepareMedia && <ShotSubtitlePreview {...captions} storyId={contextSource.storyId} chapterId={Number(contextSource.chapterId)} prepare={prepareMedia} close={()=>setCaptions(null)}/>}
    {conversion && contextSource && prepareMedia && <BookModuleConvert key={`${formatScope}:${conversion.id}:${conversion.kind}`} source={conversion} reviewMedia={reviewMedia} storyId={contextSource.storyId} chapterId={Number(contextSource.chapterId)} onClose={()=>setConversion(null)} prepare={async()=>{
      const assertSource=()=>{
        const latest=mediaLatest.current;
        if(latest.disabled || (conversion.parts ?? [conversion]).some(part=>latest.blocks.find(b=>b.id===part.id)?.text!==part.text))throw new Error('原模块已变化，请重新选择');
      };
      assertSource(); await mediaLatest.current.prepareMedia!(); assertSource();
    }} onInsert={text=>{
      const latest=mediaLatest.current, parts=conversion.parts ?? [conversion];
      const index=latest.blocks.findLastIndex(b=>parts.some(part=>part.id===b.id));
      const image = readBookImage(text);
      if (image && latest.blocks.some(block => readBookImage(block.text)?.url === image.url)) { setConversion(null); return; }
      if(latest.disabled || index<0 || parts.some(part=>latest.blocks.find(b=>b.id===part.id)?.text!==part.text))throw new Error('原模块已变化，结果仍保留，请重新选择插入位置');
      const current=latest.blocks[index], at=isHeading(current)?blockSubtreeEnd(latest.blocks,index):index+1;
      const container=current.format==='scene'||current.format==='shot';
      const added=newWritingBlock(text,container?current.id:current.parentId),next=[...latest.blocks.slice(0,at),added,...latest.blocks.slice(at)].map(b=>container&&b.id===current.id?{...b,collapsed:false}:b);
      if(blockBody(next).length>200000)throw new Error('文章过长，无法插入');
      commitLatest.current(next,writingBlockOffset(next,at),false);setActiveId(added.id);setConversion(null);
    }}/>}
    {contextSource && !comparison && <div className="flex flex-wrap items-center gap-3"><BookVideoStartButton storyId={contextSource.storyId} disabled={disabled} />{footerActions}<BookMusicInsert key={formatScope} storyId={contextSource.storyId} disabled={disabled} wholeBook={{ chapterId: Number(contextSource.chapterId), kind: blocks.some(block => block.format === "shot") ? "storyboard" : "text" }} prepare={prepareMedia} onInsert={text => {
      const audio=newWritingBlock(text), next=[audio,...blocks];
      commit(next,0,false);setActiveId(audio.id);
    }}/></div>}
    {cacheError && <p role="alert" className="text-xs text-destructive">{_ui("本机无法保存模块格式，请暂时不要关闭页面。")}</p>}
  </section>;
  return contextSource && !comparison ? <BookImageImportBoundary storyId={contextSource.storyId} scope={contextSource.scope}
    disabled={disabled} blocks={blocks} activeId={activeId} onInsert={(anchor, urls) => {
      const result = insertBookImages(blocks, anchor, urls);
      textRange.clear(); setSelectedModuleIds([]);
      commit(result.blocks, writingBlockOffset(result.blocks, result.blocks.findIndex(block => block.id === result.firstId)), false);
    }}>{content}</BookImageImportBoundary> : content;
}
