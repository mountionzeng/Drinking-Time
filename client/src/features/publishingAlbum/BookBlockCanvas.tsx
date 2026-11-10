import { useUiLanguage, useUiText as useDesktopUiText } from "@/features/uiLanguage/UiLanguage";
import { mergeBookText } from "./mergeBookText";
import { readBookAudio } from "@shared/bookAudioBlock";
import { intersectingBookIds, resizeBookColumn, moveBookSelection, resizeBookSelection, selectedBookIds, type SelectionBox } from './bookBlockSelection';
import { bookImageModule, transformBookImage } from "./bookImageTransform";
import { bookImageUrl, readBookImage } from "@shared/bookImageBlock";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { BOOK_BLOCK_INDENT, bookBaseFont, deleteBookBlock, deleteBookBlocks, findBookDrop, layoutBookBlocks, moveBookBlockByKey, resizeBookBlock, type BookDropTarget, type BookPlacement } from './bookBlockLayout';
import { blockAncestors, canSetBlockFormat, isHeading, setBlockFormat, type BlockFormat, type WritingBlock } from './chapterBlockTree';
import type { ImageModule, ModuleHandle } from './imagePackModules';
import { flushSync } from 'react-dom';
import { bindBookViewZoom } from './bookViewZoom';
import { bookBlockNumbers, bookBlockNumberLabel, chineseBookNumber } from '@shared/bookBlockNumbering';
import { bookOutlineSummaries, BOOK_SHOT_SUMMARY_HEIGHT, BOOK_SHOT_IMAGES_HEIGHT } from './bookOutlineSummary';

const formats: Array<[BlockFormat, string]> = [['text', '正文'], ['heading1', '转换成一章'], ['heading2', '转换成一节'], ['scene', '转换成一场'], ['shot', '转换成一个镜头']];
const corners = { nw: '-left-2 -top-2 cursor-nwse-resize', ne: '-right-2 -top-2 cursor-nesw-resize', sw: '-left-2 -bottom-2 cursor-nesw-resize', se: '-right-2 -bottom-2 cursor-nwse-resize' } as const;
const cornerEdges = { nw: 'border-l border-t', ne: 'border-r border-t', sw: 'border-l border-b', se: 'border-r border-b' };
const cornerNames = { nw: '左上角', ne: '右上角', sw: '左下角', se: '右下角' };

const action = 'min-h-11 w-full rounded px-3 py-2 text-left text-sm hover:bg-accent focus-visible:outline focus-visible:outline-2 disabled:opacity-40';

export function BookBlockCanvas({ importedChapterIds, blocks, disabled, onCommit, children, activeId, onSelect, onSelectionChange, onConvert, onConvertSelection, onComposeImage, textSelectionIds }: {
  onComposeImage?(ids: string[]): void;
  onConvertSelection?(ids: string[], kind: 'text' | 'music' | 'narration'): void;
  textSelectionIds?: string[];
  importedChapterIds?: readonly string[];
  blocks: WritingBlock[]; disabled: boolean;
  onConvert?(id:string,kind:"text"|"image"|"music"|"narration"|"translate-en"|"translate-zh"):void;
  onSelectionChange?(ids: string[]): void;
  activeId: string | null; onSelect(id: string | null): void;
  onCommit(next: WritingBlock[], focusId: string, focus?: boolean): void;
  children(block: WritingBlock, index: number, style: CSSProperties): ReactNode;
}) {
  const _ui = useDesktopUiText();
  const { language } = useUiLanguage();
  const root = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const [imageRatios, setImageRatios] = useState<Record<string,number>>({});
  const [formulaHeights,setFormulaHeights]=useState<Record<string,number>>({});
  const imageUrls = Array.from(new Set(blocks.map(block=>bookImageUrl(block.text)).filter((url): url is string=>Boolean(url)))).join('\n');
  useEffect(()=>{
    let cancelled=false;
    for (const url of imageUrls.split('\n').filter(Boolean)) {
      const image=new Image();
      image.onload=()=>{if(!cancelled && image.naturalHeight>0) setImageRatios(previous=>({...previous,[url]:image.naturalWidth/image.naturalHeight}));};
      image.src=url;
    }
    return ()=>{cancelled=true;};
  },[imageUrls]);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(900);
  const [matchTarget, setMatchTarget] = useState<string | null>(null);
  const [matchError, setMatchError] = useState(false);
  const [mergeMenu,setMergeMenu]=useState<{x:number;y:number}|null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [preview, setPreview] = useState<WritingBlock[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  useLayoutEffect(() => { if (textSelectionIds) setSelectedIds(textSelectionIds); }, [textSelectionIds]);
  const [selecting, setSelecting] = useState(false);
  const selected = selectedBookIds(blocks, selectedIds);
  const hasSelectedAudio = blocks.some(block => selected.has(block.id) && readBookAudio(block.text));
  const selectedTextBlocks = blocks.filter(block => selected.has(block.id) && !bookImageUrl(block.text) && !readBookAudio(block.text));
  const groupMenu = useRef<HTMLDivElement>(null);
  useEffect(() => { if (mergeMenu) groupMenu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus(); }, [mergeMenu]);
  function openGroupMenu(x: number, y: number) {
    setMenuId(null);
    setMergeMenu({x:Math.max(8,Math.min(x,window.innerWidth-208)),y:Math.max(8,Math.min(y,window.innerHeight-370))});
  }
  useLayoutEffect(() => { onSelectionChange?.([...selected]); }, [selectedIds, blocks, onSelectionChange]);
  const [marquee, setMarquee] = useState<SelectionBox | null>(null);
  const selectionGesture = useRef<{ pointer: number; x: number; y: number; initial: string[] } | null>(null);
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;
  useEffect(() => {
    if (activeId && !selectedIds.includes(activeId)) setSelectedIds([]);
  }, [activeId]);
  const [drop, setDrop] = useState<BookDropTarget | null>(null);
  const gesture = useRef<{ ids: string[]; source: WritingBlock[]; id: string; pointer: number; x: number; y: number; scale: number; handle: ModuleHandle; before: BookPlacement; next: WritingBlock[]; drop: BookDropTarget | null; image?: ImageModule; imageFactor?: number; columnWidth?: number; columnSign?: number } | null>(null);
  // Reflow narrow screens instead of shrinking body text below 16 CSS pixels.
  const pageWidth = Math.min(900, width / (2 / 3));
  const scale = width / pageWidth * zoom;
  useLayoutEffect(() => {
    if (!viewport.current) return;
    // The outside gutter keeps existing drag/fold controls reachable without narrowing the text.
    const update = () => setWidth(Math.max(1, (viewport.current?.clientWidth || 952) - 52));
    update(); const observer = new ResizeObserver(update); observer.observe(viewport.current);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const host = viewport.current;
    if (!host) return;
    let previous = 1;
    return bindBookViewZoom(host, (next, anchor) => {
      const canvas = root.current;
      if (!canvas) return;
      const before = canvas.getBoundingClientRect();
      let scroller = host.parentElement;
      while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
      const ratio = next / previous;
      previous = next;
      flushSync(() => setZoom(next));
      const after = canvas.getBoundingClientRect();
      host.scrollLeft += after.left + (anchor.x - before.left) * ratio - anchor.x;
      if (scroller) scroller.scrollTop += after.top + (anchor.y - before.top) * ratio - anchor.y;
    }, () => {
      selectionGesture.current = null; setMarquee(null);
      const current = gesture.current;
      if (!current) return;
      gesture.current = null;
      if (root.current?.hasPointerCapture(current.pointer)) root.current.releasePointerCapture(current.pointer);
      setPreview(null); setDrop(null);
    });
  }, []);
  useEffect(() => {
    if (disabled || !blocks.some(block => block.id === matchTarget)) setMatchTarget(null);
  }, [blocks, disabled, matchTarget]);
  // Import receipts identify chapter headings, not prose. Keep this view state
  // separate from the saved document so opening a book never rewrites it.
  const [openImportedChapters, setOpenImportedChapters] = useState<Set<string>>(() => new Set());
  const chapterIds = new Set(importedChapterIds ?? []);
  const numbers = bookBlockNumbers(preview ?? blocks);
  const displayed = (preview ?? blocks).map(block => chapterIds.has(block.id) && block.format === 'heading1'
    ? { ...block, collapsed: !openImportedChapters.has(block.id) }
    : block);
  const [audioDurations, setAudioDurations] = useState<Record<string, number>>({});
  const musicUrls = [...new Set(blocks.flatMap(block => {
    const audio = readBookAudio(block.text);
    return audio?.kind === 'music' ? [audio.url] : [];
  }))].join('\n');
  useEffect(() => {
    // Read metadata only; folding a shot must never start playback or generation.
    const audios = musicUrls.split('\n').filter(Boolean).map(url => {
      const audio = new Audio();
      audio.preload = 'metadata';
      audio.onloadedmetadata = () => {
        if (Number.isFinite(audio.duration) && audio.duration > 0)
          setAudioDurations(previous => ({ ...previous, [url]: audio.duration }));
      };
      audio.src = url;
      return audio;
    });
    return () => audios.forEach(audio => {
      audio.onloadedmetadata = null; audio.removeAttribute('src'); audio.load();
    });
  }, [musicUrls]);
  const summaries = useMemo(() => bookOutlineSummaries(preview ?? blocks, audioDurations), [preview, blocks, audioDurations]);
  const sceneCount = blocks.filter(block => block.format === 'scene').length;
  const shotCount = blocks.filter(block => block.format === 'shot').length;
  const layouts = layoutBookBlocks(displayed,imageRatios,pageWidth, chapterIds,formulaHeights);
  useLayoutEffect(()=>{
    const formulas=Array.from(root.current?.querySelectorAll<HTMLElement>('[data-book-math-preview]')??[]);
    let cancelled=false;
    const measure=()=>{
      if(cancelled)return;
      const next=Object.fromEntries(formulas.map(node=>[node.dataset.bookMathPreview!,Math.ceil(node.scrollHeight/scale)+4]));
      setFormulaHeights(previous=>Object.keys(previous).length===Object.keys(next).length&&Object.entries(next).every(([id,height])=>previous[id]===height)?previous:next);
    };
    measure();
    if(!formulas.length)return;
    const observer=new ResizeObserver(measure);formulas.forEach(node=>observer.observe(node));
    void document.fonts?.ready.then(measure);
    return()=>{cancelled=true;observer.disconnect();};
  },[blocks,preview,width,zoom,openImportedChapters]);
  // "After a heading" means after its entire visible group, not between the heading and its children.
  const dropMarkerId = drop?.position === 'after'
    ? layouts.filter(item => item.block.id === drop.id || blockAncestors(displayed, item.block.id).includes(drop.id)).at(-1)?.block.id
    : drop?.id;
  const pageCount = Math.max(1, ...layouts.map(item => item.placement.page + 1));
  function beginSelection(event: PointerEvent<HTMLDivElement>) {
    if (disabled || event.button !== 0 || event.pointerType === 'touch' || !root.current || (event.target as HTMLElement).closest('[data-book-block],button')) return;
    event.preventDefault(); onSelect(null); setMenuId(null); root.current.focus({preventScroll:true});
    const rect = root.current.getBoundingClientRect();
    selectionGesture.current = {pointer:event.pointerId,x:event.clientX-rect.left,y:event.clientY-rect.top,initial:event.shiftKey ? selectedIds : []};
    if (!event.shiftKey) setSelectedIds([]);
    root.current.setPointerCapture(event.pointerId);
  }
  function blockColumn(id: string) {
    const block = blocks.find(item => item.id === id);
    const row = layouts.filter(item => block?.columnGroup && item.block.columnGroup === block.columnGroup);
    if (row.length !== 2) return null;
    return {sign: row[0].block.id === id ? 1 : -1, width: row.reduce((n,item) => n + 900 * item.imageFactor, 0)};
  }
  const selectedLayouts = layouts.filter(item => selected.has(item.block.id));
  const groupBounds = selected.size > 1 && selectedLayouts.length ? {
    left: Math.min(...selectedLayouts.map(item=>item.placement.rect.x * scale)),
    right: Math.max(...selectedLayouts.map(item=>(item.placement.rect.x+item.placement.rect.width) * scale)),
    top: Math.min(...selectedLayouts.map(item=>item.placement.page*(1200*scale+20*zoom)+item.placement.rect.y*scale)),
    bottom: Math.max(...selectedLayouts.map(item=>item.placement.page*(1200*scale+20*zoom)+(item.placement.rect.y+item.placement.rect.height)*scale)),
  } : null;
  function apply(next: WritingBlock[], id: string, focus = true) {
    if (disabled || next === blocks) return;
    setMenuId(null); onCommit(next, id, focus);
  }
  function start(event: PointerEvent<HTMLButtonElement | HTMLDivElement>, id: string, placement: BookPlacement, handle: ModuleHandle, imageGesture = false) {
    if (disabled || event.button !== 0 || gesture.current) return;
    const explicitIds = selected.has(id) && selected.size > 1 ? [...selected] : [id];
    const ids = explicitIds;
    const column = ids.length === 1 && ['nw','ne','sw','se'].includes(handle) ? blockColumn(id) : null;
    setSelectedIds(ids);
    event.preventDefault(); event.stopPropagation(); if (ids.length === 1) onSelect(id); setMenuId(null);
    event.currentTarget.focus({ preventScroll: true }); (root.current ?? event.currentTarget).setPointerCapture(event.pointerId);
    const block = blocks.find(item=>item.id===id)!;
    const baseX = 24 + Math.min(blockAncestors(blocks,id).length,4)*BOOK_BLOCK_INDENT;
    const imageFactor = layouts.find(item => item.block.id === id)?.imageFactor ?? Math.min((884-baseX)/900,1104/1200);
    const image = imageGesture && ids.length === 1 && !column ? bookImageModule(block.text,imageFactor) ?? undefined : undefined;
    if (image && !readBookImage(block.text)?.frame) {
      const svg = event.currentTarget.closest('[data-book-block]')?.querySelector('svg[aria-label="文章插图"]');
      const view = svg?.getAttribute('viewBox')?.split(' ').map(Number);
      if (view && view[2] > 0 && view[3] > 0) {
        const aspect = view[2]/view[3];
        const width = Math.min(placement.rect.width,placement.rect.height*aspect);
        const height = width/aspect;
        image.rect = {x:(placement.rect.x - (layouts.find(item => item.block.id === id)?.imageOriginX ?? baseX))/imageFactor,y:(placement.rect.height-height)/2/imageFactor,width:width/imageFactor,height:height/imageFactor};
      }
    }
    gesture.current = { columnWidth: column ? column.width : undefined, columnSign: column ? column.sign * (handle.includes("w") ? -1 : 1) : undefined, ids, source: blocks, image, imageFactor, id, pointer: event.pointerId, x: event.clientX, y: event.clientY, scale, handle, before: placement, next: blocks, drop: null };
  }
  function move(event: PointerEvent) {
    const selection = selectionGesture.current;
    if (selection && selection.pointer === event.pointerId && root.current) {
      const rect = root.current.getBoundingClientRect();
      const x = event.clientX - rect.left, y = event.clientY - rect.top;
      const box = { left: Math.min(selection.x, x), top: Math.min(selection.y, y), right: Math.max(selection.x, x), bottom: Math.max(selection.y, y) };
      setMarquee(box);
      const items = Array.from(root.current.querySelectorAll<HTMLElement>('[data-book-block]')).map(element => {
        const bounds = element.getBoundingClientRect();
        return { id: element.dataset.bookBlock!, left: bounds.left - rect.left, right: bounds.right - rect.left, top: bounds.top - rect.top, bottom: bounds.bottom - rect.top };
      });
      setSelectedIds([...new Set([...selection.initial, ...intersectingBookIds(box, items)])]);
      return;
    }
    const current = gesture.current; if (!current || event.pointerId !== current.pointer) return;
    if (current.columnWidth) {
      current.next = resizeBookColumn(current.source, current.id, (event.clientX-current.x) / current.scale / current.columnWidth * current.columnSign!);
      setPreview(current.next);
    } else if (current.image) {
      if (Math.hypot(event.clientX-current.x,event.clientY-current.y)<2 && current.next === blocks) return;
      const factor = current.scale * current.imageFactor!;
      current.next = blocks.map(block=>block.id===current.id ? {...block,text:transformBookImage(block.text,current.image!,current.handle,(event.clientX-current.x)/factor,(event.clientY-current.y)/factor)} : block);
      setPreview(current.next);
    } else if (current.handle === 'move') {
      if (Math.hypot(event.clientX - current.x, event.clientY - current.y) < 4) return;
      const boxes = Array.from(root.current?.querySelectorAll<HTMLElement>('[data-book-block]') ?? []).map(element => {
        const rect = element.getBoundingClientRect();
        return { id: element.dataset.bookBlock!, top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
      });
      const moving = selectedBookIds(blocks, current.ids);
      const roots = blocks.filter(block => moving.has(block.id) && (!block.parentId || !moving.has(block.parentId)));
      current.drop = boxes.some(box => moving.has(box.id) && event.clientY >= box.top && event.clientY <= box.bottom && event.clientX >= box.left! && event.clientX <= box.right!)
        ? null : findBookDrop(blocks, current.id, boxes.filter(box => !moving.has(box.id)), event.clientY, event.clientX, roots.length === 1);
      setDrop(current.drop);
    } else {
      const dx = (event.clientX - current.x) / current.scale * (current.handle.includes('w') ? -1 : 1);
      const dy = (event.clientY - current.y) / current.scale * (current.handle.includes('n') ? -1 : 1);
      const delta = Math.abs(dx) > Math.abs(dy) ? dx : dy;
      current.next = current.ids.length > 1
        ? resizeBookSelection(current.source, current.ids, 1 + delta / 160, imageRatios)
        : resizeBookBlock(blocks, current.id, current.before.fontSize * (1 + delta / 160));
      setPreview(current.next);
    }
  }
  function end(event: PointerEvent, cancelled = false) {
    if (selectionGesture.current?.pointer === event.pointerId) {
      const initial = selectionGesture.current.initial;
      selectionGesture.current = null; setMarquee(null);
      if (cancelled) setSelectedIds(initial);
      return;
    }
    const current = gesture.current; if (!current || event.pointerId !== current.pointer) return;
    gesture.current = null; setPreview(null); setDrop(null);
    if (cancelled || current.source !== blocksRef.current) return;
    if (current.handle === 'move' && !current.image) {
      if (Math.hypot(event.clientX-current.x,event.clientY-current.y)<4 && !current.drop) {
        if(current.ids.length>1) openGroupMenu(event.clientX,event.clientY); else setMenuId(current.id);
        return;
      }
      if (current.drop) apply(moveBookSelection(blocks, current.ids, current.drop), current.id, false);
    } else apply(current.next, current.id, false);
  }

  return <>{selecting && <div className="sticky top-0 z-40 flex flex-wrap items-center gap-2 bg-background py-2 text-sm" data-stage-swipe="ignore">
    <span>{_ui("已选")}{" "}{selected.size} {_ui("个")}</span>
    <button type="button" className="min-h-11 px-2" onClick={() => {setSelecting(false);root.current?.focus({preventScroll:true});}}>{_ui("完成选择")}</button>
    {selected.size > 1 && mergeBookText(blocks,[...selected]) !== blocks && <button type="button" className="min-h-11 px-2" onClick={() => {const first=blocks.find(b=>selected.has(b.id));if(first) apply(mergeBookText(blocks,[...selected]),first.id);setSelectedIds([]);setSelecting(false);}}>{_ui("合并文字")}</button>}
  </div>}<div ref={viewport} aria-label={_ui("文章缩放视图")} data-book-zoom={zoom} onPointerDown={beginSelection} className="-ml-11 -mr-2 -mt-8 min-w-0 overflow-x-auto pl-11 pr-2 pt-8" style={{ touchAction: 'pan-x pan-y' }}>
  {sceneCount > 0 && <p data-book-outline-total className="px-6 text-sm text-muted-foreground">{_ui("{0} 场戏 · {1} 个镜头", [sceneCount, shotCount])}</p>}
  <div ref={root} data-book-selecting={selecting || undefined} onContextMenu={event=>{
    if(disabled || selected.size<2)return;
    event.preventDefault();openGroupMenu(event.clientX,event.clientY);
  }} aria-label={_ui("书页")} className="relative flex flex-col" tabIndex={-1} onKeyDown={event => {
    if (event.key === 'Escape') { setMergeMenu(null); setMatchTarget(null); selectionGesture.current = null; gesture.current = null; setMarquee(null); setSelectedIds([]); setPreview(null); setDrop(null); root.current?.focus({preventScroll:true}); onSelect(null); }
    if (!['Delete', 'Backspace'].includes(event.key) || disabled || event.defaultPrevented || event.repeat || event.nativeEvent.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement;
    if (target.closest('textarea,input,select,[role="textbox"]') || target.isContentEditable) return;
    const ids = selected.size ? [...selected] : activeId ? [activeId] : [];
    const first = blocks.findIndex(block => ids.includes(block.id));
    if (first < 0 || gesture.current || selectionGesture.current) return;
    event.preventDefault(); event.stopPropagation();
    const next = deleteBookBlocks(blocks, ids);
    setMergeMenu(null); setSelectedIds([]); setSelecting(false); onSelect(null);
    apply(next, next[Math.min(first, next.length - 1)].id, false);
    root.current?.focus({ preventScroll: true });
  }} style={{ width: width * zoom, gap: 20 * zoom }} onPointerMove={move} onPointerUp={end} onPointerCancel={event => end(event, true)} onLostPointerCapture={event => end(event, true)}>
    {Array.from({ length: pageCount }, (_, page) => <section key={page} aria-label={_ui("第 {0} 页", [page + 1])}
      className="relative"
      style={{ height: 1200 * scale }}
>
      {layouts.filter(item => item.placement.page === page).map(({ block, index, placement }) => {
        const number = numbers.get(block.id);
        const isImportedChapter = chapterIds.has(block.id) && block.format === 'heading1';
        const chapterLabel = !number ? '' : language === 'zh' ? chineseBookNumber(number.number) : number.number;
        const numberLabel = number ? bookBlockNumberLabel(number, language) : '';
        const summary = summaries.get(block.id)!;
        const summaryText = block.format === 'shot' ? [
          _ui("{0} 字", [summary.characters]), _ui("{0} 句台词", [summary.dialogue]), _ui("{0} 张图片", [summary.images.length]),
          !summary.music ? _ui("无音乐") : summary.unknownMusic
            ? _ui("{0} 段音乐 · 时长待读取", [summary.music]) : _ui("{0} 秒音乐", [Math.round(summary.musicSeconds * 10) / 10]),
          ...(summary.narration ? [_ui("{0} 段有声书", [summary.narration])] : []),
        ].join(' · ') : '';
        const toggleImportedChapter = () => {
          if (block.collapsed) {
            setOpenImportedChapters(previous => new Set(previous).add(block.id));
          } else {
            setOpenImportedChapters(previous => { const next = new Set(previous); next.delete(block.id); return next; });
            if (activeId && (activeId === block.id || blockAncestors(blocks, activeId).includes(block.id))) onSelect(null);
            setSelectedIds([]);
          }
        };
        const grouped = selected.size > 1 && selected.has(block.id);
        const active = activeId === block.id || menuId === block.id || grouped;
        const patch = (value: Partial<WritingBlock>) => apply(blocks.map(item => item.id === block.id ? { ...item, ...value } : item), block.id);
        return <div key={block.id} data-book-block={block.id} data-book-selected={selected.has(block.id) || undefined}
          onPointerDownCapture={event => {
            if (disabled || event.button !== 0) return;
            if (matchTarget) { event.preventDefault(); event.stopPropagation(); return; }
            if ((event.target as HTMLElement).closest('[data-book-handle]')) return;
            if (selecting || event.shiftKey && !(event.target as HTMLElement).closest('textarea')) {
              event.preventDefault(); event.stopPropagation();
              root.current?.focus({ preventScroll: true });
              setSelectedIds(previous => { const ids = previous.length ? previous : activeId ? [activeId] : []; return ids.includes(block.id) ? ids.filter(id => id !== block.id) : [...ids, block.id]; });
            } else if (!selected.has(block.id) || (event.target as HTMLElement).closest('textarea')) setSelectedIds([]);
          }} onClickCapture={event => {
            if ((event.target as HTMLElement).closest('[data-book-handle]')) return;
            if (selecting || event.shiftKey && !(event.target as HTMLElement).closest('textarea')) { event.preventDefault(); event.stopPropagation(); return; }
            if (!matchTarget || disabled) return;
            event.preventDefault(); event.stopPropagation();
            if (bookImageUrl(block.text) || block.id === matchTarget) return;
            const target = blocks.find(item => item.id === matchTarget);
            if (!target) { setMatchTarget(null); return; }
            if (placement.fontSize > bookBaseFont(target) * 2) { setMatchError(true); return; }
            apply(resizeBookBlock(blocks, matchTarget, placement.fontSize), matchTarget);
            setMatchTarget(null); setMatchError(false);
          }} onFocusCapture={() => { if (!grouped && !matchTarget) onSelect(block.id); }}
          className={`absolute group ${active ? 'z-10' : ''}`}
          style={{ left: placement.rect.x * scale, top: placement.rect.y * scale, width: placement.rect.width * scale, height: placement.rect.height * scale,
            outline: grouped ? '1px solid var(--nayin-accent)' : undefined, outlineOffset: grouped ? 3 : undefined,
            background: block.backdrop ? 'rgba(255,255,245,.6)' : undefined }}>
          {drop && dropMarkerId === block.id && <div aria-label={_ui("模块插入位置")} className={`pointer-events-none absolute z-30 border-[var(--nayin-accent)] ${drop.position === 'left' || drop.position === 'right' ? `top-0 bottom-0 border-l-2 ${drop.position === 'left' ? '-left-2' : '-right-2'}` : `left-0 right-0 border-t-2 ${drop.position === 'before' ? '-top-1' : '-bottom-1'}`}`}>
            {(drop.position === 'left' || drop.position === 'right') && <span className="absolute -top-6 right-0 whitespace-nowrap bg-[var(--nayin-surface)] px-1 text-xs text-muted-foreground">{_ui("并排")}</span>}
            {drop.position === 'inside' && <span className="absolute right-0 -top-5 bg-[var(--nayin-surface)] px-1 text-xs text-muted-foreground">{_ui("放入标题")}</span>}
          </div>}
          <div className={`absolute -top-8 left-0 flex items-center gap-1 ${active && !grouped ? '' : 'invisible [@media(pointer:coarse)]:visible'}`}>
            <Popover open={menuId === block.id} onOpenChange={open => setMenuId(open ? block.id : null)}>
              <PopoverTrigger asChild><button type="button" aria-label={_ui("模块 {0} 格式", [index + 1])} disabled={disabled}
                className="rounded border border-[var(--panel-border)] bg-[var(--nayin-surface)] px-2 py-1 text-xs shadow-sm [@media(pointer:coarse)]:min-h-8 [@media(pointer:coarse)]:min-w-20">
                {readBookAudio(block.text) ? (readBookAudio(block.text)?.kind==='narration'?_ui("有声书"):_ui("音乐")) : bookImageUrl(block.text) ? _ui("图片") : block.videoRole==='dialogue' ? _ui("台词/字幕") : block.format === 'text' ? _ui("正文") : block.format === 'scene' ? _ui("场") : block.format === 'shot' ? _ui("镜头") : block.format === 'heading1' ? _ui("章") : _ui("节")}<span className="hidden [@media(pointer:coarse)]:inline"> {_ui("· 操作")}</span> ▾
              </button></PopoverTrigger>
              <PopoverContent align="start" className="max-h-[var(--radix-popover-content-available-height)] w-48 overflow-y-auto p-1" onCloseAutoFocus={event => event.preventDefault()} aria-label={_ui("模块 {0} 设置", [index + 1])}>
                <p hidden={!bookImageUrl(block.text)} className="px-3 py-2 text-xs text-muted-foreground">{_ui("拖图片移动 · 四角缩放 · 四边裁切")}</p>
                <div hidden={Boolean(bookImageUrl(block.text) || readBookAudio(block.text))} role="group" aria-label={_ui("格式")}>{formats.map(([value, label]) => <button key={value} type="button" disabled={disabled || !canSetBlockFormat(blocks, index, value)} className={action}
                  aria-pressed={!block.videoRole && (block.format === value || block.format === 'heading3' && value === 'heading2')} onClick={() => apply(setBlockFormat(blocks, index, value), block.id)}>{!block.videoRole && (block.format === value || block.format === 'heading3' && value === 'heading2') ? '✓ ' : ''}{_ui(label)}</button>)}</div>
                {!bookImageUrl(block.text) && !readBookAudio(block.text) && <button type="button" className={action} disabled={disabled} aria-pressed={block.videoRole==='dialogue'} onClick={()=>{
                  const next=setBlockFormat(blocks,index,'text').map(item=>item.id===block.id?{...item,videoRole:'dialogue' as const}:item);
                  apply(next,block.id);
                }}>{block.videoRole==='dialogue'?'✓ ':''}{_ui("转换成台词/字幕")}</button>}
                {!bookImageUrl(block.text) && !readBookAudio(block.text) && <button type="button" className={action} disabled={disabled} onClick={() => { setMatchTarget(block.id); setMatchError(false); setMenuId(null); }}>{_ui("匹配文字大小")}</button>}
                {onConvert && !readBookAudio(block.text) && <div className="border-t py-1">
                  <button type="button" className={action} disabled={disabled} onClick={()=>{setMenuId(null);onConvert(block.id,bookImageUrl(block.text)?'text':'image');}}>{bookImageUrl(block.text)?_ui("生成一段文字"):_ui("生成一张图片")}</button>
                  <button type="button" className={action} disabled={disabled} onClick={()=>{setMenuId(null);onConvert(block.id,'music');}}>{_ui("生成一段音乐")}</button>
                  {!bookImageUrl(block.text) && ([['translate-en','翻译成英文'],['translate-zh','翻译成中文']] as const).filter(([kind]) => kind === 'translate-en' ? /\p{Script=Han}/u.test(block.text) : /[a-zA-Z]/.test(block.text)).map(([kind,label]) => <button type="button" key={kind} className={action} disabled={disabled} onClick={()=>{setMenuId(null);onConvert(block.id,kind);}}>{_ui(label)}</button>)}
                  {!bookImageUrl(block.text)&&<button type="button" className={action} disabled={disabled} onClick={()=>{setMenuId(null);onConvert(block.id,'narration');}}>{_ui("生成有声书")}</button>}
                </div>}
                <button type="button" className={action} onClick={() => { setSelecting(true); setSelectedIds([block.id]); setMenuId(null); root.current?.focus({preventScroll:true}); }}>{_ui("选择多个模块")}</button>
                <div className="my-1 border-t" />
                {(['normal', 'bright'] as const).map(value => <button type="button" key={value} disabled={disabled} className={action}
                  aria-pressed={(block.emphasis ?? 'normal') === value} onClick={() => patch({ emphasis: value })}>{(block.emphasis ?? 'normal') === value ? '✓ ' : ''}{value === 'normal' ? _ui("正常") : _ui("加粗提亮")}</button>)}
                <button type="button" disabled={disabled} className={action} aria-pressed={block.backdrop ?? false} onClick={() => patch({ backdrop: !block.backdrop })}>{block.backdrop ? '✓ ' : ''}{_ui("半透明底色")}</button>
                <div className="my-1 border-t" />
                <button type="button" disabled={disabled} className={`${action} text-destructive`} onClick={() => {
                  const next = deleteBookBlock(blocks, block.id); apply(next, next[Math.min(index, next.length - 1)].id);
                }}>{readBookAudio(block.text) ? _ui("删除音乐模块") : bookImageUrl(block.text) ? _ui("删除图片模块") : _ui("删除文字模块")}</button>
              </PopoverContent>
            </Popover>
          </div>
          <button type="button" data-book-handle disabled={disabled} aria-haspopup="menu" aria-label={_ui("拖动模块 {0}", [index + 1])} title={grouped ? _ui("点击处理所选模块，拖动移动整组") : _ui("拖到上下调整顺序，拖到左右并排；上下键排序，左右键调整归属")}
            className={`absolute ${block.columnGroup && blocks.find(item => item.columnGroup === block.columnGroup)?.id !== block.id ? '-left-3 px-0' : '-left-6 px-1'} top-1 touch-none cursor-grab rounded active:cursor-grabbing ${grouped ? 'bg-[var(--nayin-accent)] text-white shadow-sm' : `text-muted-foreground ${active ? '' : 'opacity-40'}`}`}
            onPointerDown={event => start(event, block.id, placement, 'move')}
            onKeyDown={event => {
              if (['Enter',' '].includes(event.key)) {
                event.preventDefault(); event.stopPropagation();
                if(grouped) { const rect=event.currentTarget.getBoundingClientRect(); openGroupMenu(rect.right,rect.bottom); }
                else {onSelect(block.id);setMenuId(block.id);} return;
              }
              if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key) || disabled) return;
              event.preventDefault();
              if (grouped) {
                const visible = layouts.map(item => item.block);
                const first = visible.findIndex(item => selected.has(item.id));
                const last = visible.findLastIndex(item => selected.has(item.id));
                const target = event.key === 'ArrowUp' || event.key === 'ArrowRight' ? visible[first - 1] : event.key === 'ArrowDown' ? visible[last + 1] : blocks.find(item => item.id === visible[first]?.parentId);
                if (target) apply(moveBookSelection(blocks, [...selected], { id: target.id, position: event.key === 'ArrowRight' ? 'inside' : event.key === 'ArrowUp' ? 'before' : 'after' }), block.id, false);
              } else apply(moveBookBlockByKey(blocks, block.id, event.key), block.id, false);
            }}>⠿</button>
          {isHeading(block) && !isImportedChapter && <button type="button" disabled={disabled} aria-label={_ui("{0}标题 {1}", [block.collapsed ? _ui("展开") : _ui("收起"), index + 1])} aria-expanded={!block.collapsed}
            className="absolute -left-11 top-1 rounded px-1 text-muted-foreground" onClick={() => patch({ collapsed: !block.collapsed })}>{block.collapsed ? '▸' : '▾'}</button>}
          {isImportedChapter && block.collapsed ? (
            <button type="button" aria-expanded={false} onClick={toggleImportedChapter}
              className="flex h-full w-full items-center gap-3 border-b border-[var(--nayin-border)] text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--nayin-accent)]">
              <span className="shrink-0 whitespace-nowrap text-[var(--nayin-accent)]" style={{ fontSize: 26 * scale }}>{_ui("第{0}章", [chapterLabel])}</span>
              <span className="min-w-0 flex-1 truncate" style={{ fontSize: Math.min(placement.fontSize, 32) * scale }}>{block.text || _ui("未命名章节")}</span>
              <span aria-hidden="true" className="text-muted-foreground" style={{ fontSize: 24 * scale }}>›</span>
            </button>
          ) : (
            <div className={isImportedChapter ? "flex h-full w-full items-start gap-3" : bookImageUrl(block.text) ? "h-full w-full touch-none cursor-grab active:cursor-grabbing" : "contents"} onPointerDown={bookImageUrl(block.text) ? event=>{
              if ((event.target as HTMLElement).closest('video')) { onSelect(block.id); return; }
              start(event,block.id,placement,'move',true);
            } : undefined}>
              {isImportedChapter && <button type="button" aria-expanded={true} onClick={toggleImportedChapter}
                aria-label={_ui("收起第{0}章", [chapterLabel])}
                className="shrink-0 whitespace-nowrap text-[var(--nayin-accent)] focus-visible:outline focus-visible:outline-2" style={{ fontSize: 26 * scale, lineHeight: 1.6 }}>
                {_ui("第{0}章", [chapterLabel])} ▾
              </button>}
              {isImportedChapter ? <div className="min-w-0 flex-1 h-full">{children(block, index, { fontSize: placement.fontSize * scale, lineHeight: 1.6, fontWeight: 650 })}</div> : number ?
              <div className="flex h-full w-full flex-col">
                <span className="shrink-0 select-none text-[var(--nayin-accent)]" style={{ fontSize: 18 * scale, height: 32 * scale, lineHeight: `${32 * scale}px` }}><span data-book-number={block.id} style={{ fontSize: (number.kind === 'scene' || number.kind === 'chapter' ? 26 : 18) * scale }}>{numberLabel}</span>{(block.format === 'scene' || block.format === 'heading1') && <span className="ml-3 text-muted-foreground">{block.format === 'scene' ? [_ui("{0} 个镜头", [summary.shots]), ...(summary.images.length ? [_ui("{0} 张图片", [summary.images.length])] : [])].join(' · ') : _ui("{0} 节", [summary.sections])}</span>}</span>
                <div className="min-h-0 flex-1">{children(block, index, { fontSize: placement.fontSize * scale, lineHeight: 1.6, fontWeight: 650,
                  color: block.emphasis === 'bright' ? 'var(--nayin-accent)' : undefined, textShadow: block.emphasis === 'bright' ? '0 0 6px rgba(255,255,255,.8)' : undefined })}</div>
                {summaryText && <p data-book-summary={block.id} className="shrink-0 text-muted-foreground" style={{ height: BOOK_SHOT_SUMMARY_HEIGHT * scale, fontSize: 18 * scale, lineHeight: `${28 * scale}px` }}>{summaryText}</p>}
                {block.format === 'shot' && !block.collapsed && summary.images.length > 0 && <div aria-label={_ui("镜头参考图")} className="flex shrink-0 gap-2 overflow-x-auto" style={{ height: BOOK_SHOT_IMAGES_HEIGHT * scale }}>
                  {summary.images.map((image, i) => <img key={image.id} src={image.url} alt={_ui("镜头参考图 {0}", [i + 1])} loading="lazy" className="shrink-0 rounded object-contain object-left" style={{ height: 92 * scale, maxWidth: 180 * scale }} />)}
                </div>}
              </div> :
              children(block, index, { fontSize: placement.fontSize * scale, lineHeight: 1.6, fontWeight: isHeading(block) || block.emphasis === 'bright' ? 650 : 400,
                color: block.emphasis === 'bright' ? 'var(--nayin-accent)' : undefined, textShadow: block.emphasis === 'bright' ? '0 0 6px rgba(255,255,255,.8)' : undefined })}
            </div>
          )}
          {active && !grouped && bookImageUrl(block.text) && Object.entries({left:'-left-1 top-2 bottom-2 w-2 cursor-ew-resize',right:'-right-1 top-2 bottom-2 w-2 cursor-ew-resize',top:'-top-1 left-2 right-2 h-2 cursor-ns-resize',bottom:'-bottom-1 left-2 right-2 h-2 cursor-ns-resize'}).map(([edge,position])=><button key={edge} type="button" disabled={disabled} aria-label={_ui("图片模块 {0} {1}边裁切", [index+1, ({left:_ui("左"),right:_ui("右"),top:_ui("上"),bottom:_ui("下")} as Record<string,string>)[edge]])} title={_ui("拖动边缘裁切")} className={`absolute z-20 touch-none border border-transparent hover:border-primary focus-visible:border-primary ${position}`} onPointerDown={event=>start(event,block.id,placement,edge as ModuleHandle,true)}/>)}
          {active && !grouped && !readBookAudio(block.text) && Object.entries(corners).map(([corner, position]) => <button type="button" key={corner} disabled={disabled}
            aria-label={_ui("模块 {0} {1}缩放", [index + 1, cornerNames[corner as keyof typeof corners]])} title={block.columnGroup ? _ui("调整两栏占比：一边变宽，另一边变窄") : bookImageUrl(block.text) ? _ui("拖动四角等比缩放") : _ui("最小为正文默认字号")}
            onKeyDown={event => {
              if (!disabled && ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(event.key)) {
                event.preventDefault();
                const column = blockColumn(block.id);
                if (column && !grouped) { apply(resizeBookColumn(blocks, block.id, column.sign * (['ArrowUp','ArrowRight'].includes(event.key) ? .05 : -.05)), block.id, false); return; }
                const resizeIds = grouped ? [...selected] : [block.id];
                if (resizeIds.length > 1) { apply(resizeBookSelection(blocks, resizeIds, ['ArrowUp','ArrowRight'].includes(event.key) ? 1.1 : 1 / 1.1, imageRatios), block.id, false); return; }
                const factor = layouts.find(item => item.block.id === block.id)!.imageFactor;
                const image = bookImageModule(block.text,factor);
                if (image) {
                  const delta = ['ArrowUp','ArrowRight'].includes(event.key) ? 10 : -10;
                  apply(blocks.map(item=>item.id===block.id?{...item,text:transformBookImage(item.text,image,corner as ModuleHandle,corner.includes('w')?-delta:delta,corner.includes('n')?-delta:delta)}:item),block.id,false);
                } else apply(resizeBookBlock(blocks, block.id, placement.fontSize + (['ArrowUp', 'ArrowRight'].includes(event.key) ? 2 : -2)), block.id, false);
              }
            }}
            className={`absolute z-20 flex h-5 w-5 touch-none items-center justify-center text-muted-foreground opacity-60 sm:opacity-0 group-hover:opacity-40 hover:!opacity-100 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-1 ${position}`}
            onPointerDown={event => start(event, block.id, placement, corner as ModuleHandle, Boolean(bookImageUrl(block.text)))}><span aria-hidden="true" className={`pointer-events-none h-1.5 w-1.5 ${cornerEdges[corner as keyof typeof corners]}`} /></button>)}
        </div>;
      })}
      <span className="pointer-events-none absolute bottom-2 left-0 w-full text-center text-xs text-muted-foreground">{page + 1}</span>
    </section>)}
    {mergeMenu && selected.size>1 && !disabled && <div className="fixed inset-0 z-50" onPointerDown={event=>{event.stopPropagation();setMergeMenu(null);}}><div ref={groupMenu} role="menu" aria-label={_ui("多选模块操作")} className="fixed max-h-[calc(100vh-16px)] w-48 overflow-y-auto rounded border bg-background p-1 shadow-lg" style={{left:mergeMenu.x,top:mergeMenu.y}} onPointerDown={event=>event.stopPropagation()} onKeyDown={event=>{
      if(event.key==='Escape') { event.preventDefault(); event.stopPropagation(); setMergeMenu(null); root.current?.focus({preventScroll:true}); }
      if(['ArrowUp','ArrowDown','Home','End'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        const items=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
        const index=items.indexOf(document.activeElement as HTMLButtonElement);
        const next=event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;
        items[next]?.focus();
      }
    }}>
      <p className="px-3 py-1 text-xs text-muted-foreground">{_ui("已选")}{" "}{selected.size} {_ui("个模块")}</p>
      <button type="button" role="menuitem" className={action} disabled={hasSelectedAudio || (!onConvertSelection && mergeBookText(blocks,[...selected])===blocks)} onClick={()=>{
        const next=mergeBookText(blocks,[...selected]),first=blocks.find(b=>selected.has(b.id));
        setMergeMenu(null);setSelecting(false);
        if(next!==blocks && first) {setSelectedIds([]);apply(next,first.id);}
        else onConvertSelection?.([...selected],'text');
      }}>{_ui("合并为文字")}</button>
      <button type="button" role="menuitem" className={action} disabled={hasSelectedAudio || !onConvertSelection} onClick={()=>{setMergeMenu(null);setSelecting(false);onConvertSelection?.([...selected],'music');}}>{_ui("合并为音乐")}</button>
      <button type="button" role="menuitem" className={action} disabled={hasSelectedAudio || !onComposeImage} onClick={()=>{setMergeMenu(null);setSelecting(false);onComposeImage?.([...selected]);}}>{_ui("合并为图像")}</button>
      <button type="button" role="menuitem" className={action} disabled={!onConvertSelection || !selectedTextBlocks.some(block=>block.text.trim())} onClick={()=>{
        setMergeMenu(null);setSelecting(false);onConvertSelection?.(selectedTextBlocks.filter(block=>block.text.trim()).map(block=>block.id),'narration');
      }}>{_ui("转为有声书")}</button>
      <button type="button" role="menuitem" className={action} disabled={!selectedTextBlocks.length} onClick={()=>{
        let next=blocks;
        for(const block of selectedTextBlocks) next=setBlockFormat(next,next.findIndex(item=>item.id===block.id),'text');
        const ids=new Set(selectedTextBlocks.map(block=>block.id));
        next=next.map(block=>ids.has(block.id)?{...block,videoRole:'dialogue' as const}:block);
        setMergeMenu(null);setSelecting(false);apply(next,selectedTextBlocks[0].id,false);root.current?.focus({preventScroll:true});
      }}>{_ui("转为台词/字幕")}</button>
      {hasSelectedAudio && <p className="px-3 py-1 text-xs text-muted-foreground">{_ui("音乐模块暂不支持转换")}</p>}
      <button type="button" role="menuitem" className={`${action} border-t text-destructive`} onClick={()=>{
        const first=blocks.findIndex(block=>selected.has(block.id)),next=deleteBookBlocks(blocks,[...selected]);
        setMergeMenu(null);setSelectedIds([]);setSelecting(false);onSelect(null);apply(next,next[Math.min(first,next.length-1)].id);
      }}>{_ui("删除所选模块")}</button>
    </div></div>}
    {matchTarget && <div role="status" className="sticky bottom-2 z-40 flex items-center gap-2 rounded bg-[var(--nayin-surface)] px-3 py-2 text-sm shadow-sm" onKeyDown={event => { if (event.key === 'Escape') setMatchTarget(null); }}>
      <span>{matchError ? _ui("这段字号超过当前模块上限，请选择另一段文字") : _ui("点击另一段文字，匹配它的大小")}</span>
      <button type="button" className="underline" onClick={() => setMatchTarget(null)}>{_ui("取消")}</button>
    </div>}
    {groupBounds && <div aria-label={_ui("多模块选区")} className="pointer-events-none absolute z-30 border border-[var(--nayin-accent)]" style={{left:groupBounds.left-5,top:groupBounds.top-5,width:groupBounds.right-groupBounds.left+10,height:groupBounds.bottom-groupBounds.top+10}}>
      {Object.entries(corners).map(([corner,position])=><button key={corner} type="button" disabled={disabled} aria-label={_ui("选中模块整体{0}缩放", [cornerNames[corner as keyof typeof corners]])} className={`pointer-events-auto absolute h-5 w-5 rounded-sm border border-[var(--nayin-accent)] bg-[var(--nayin-surface)] touch-none ${position}`} onPointerDown={event=>start(event,selectedLayouts[0].block.id,selectedLayouts[0].placement,corner as ModuleHandle)} onKeyDown={event=>{if(!disabled && ['ArrowUp','ArrowRight','ArrowDown','ArrowLeft'].includes(event.key)){event.preventDefault();apply(resizeBookSelection(blocks,[...selected],['ArrowUp','ArrowRight'].includes(event.key)?1.1:1/1.1,imageRatios),selectedLayouts[0].block.id,false);}}}/>)}
    </div>}
    {marquee && <div aria-hidden="true" className="pointer-events-none absolute z-40 border border-[var(--nayin-accent)] bg-primary/10" style={{ left: marquee.left, top: marquee.top, width: marquee.right - marquee.left, height: marquee.bottom - marquee.top }} />}
    {selected.size > 1 && <span role="status" className="pointer-events-none absolute -top-7 right-1 text-xs text-muted-foreground">{_ui("已选")}{" "}{selected.size} {_ui("个模块 · 拖把手移动，拖角标缩放")}</span>}
  </div></div>

  </>;
}
