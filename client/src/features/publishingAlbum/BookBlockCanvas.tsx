import { bookImageModule, transformBookImage } from "./bookImageTransform";
import { bookImageUrl, readBookImage } from "./bookImageBlock";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { deleteBookBlock, findBookDrop, layoutBookBlocks, moveBookBlockByKey, resizeBookBlock, type BookDropTarget, type BookPlacement } from './bookBlockLayout';
import { blockAncestors, isHeading, moveWritingBlock, setBlockFormat, type BlockFormat, type WritingBlock } from './chapterBlockTree';
import type { ImageModule, ModuleHandle } from './imagePackModules';
import { flushSync } from 'react-dom';
import { bindBookViewZoom } from './bookViewZoom';

const formats: Array<[BlockFormat, string]> = [['text', '正文'], ['heading1', '标题 1'], ['heading2', '标题 2'], ['heading3', '标题 3']];
const corners = { nw: '-left-2 -top-2 cursor-nwse-resize', ne: '-right-2 -top-2 cursor-nesw-resize', sw: '-left-2 -bottom-2 cursor-nesw-resize', se: '-right-2 -bottom-2 cursor-nwse-resize' } as const;
const cornerEdges = { nw: 'border-l border-t', ne: 'border-r border-t', sw: 'border-l border-b', se: 'border-r border-b' };
const cornerNames = { nw: '左上角', ne: '右上角', sw: '左下角', se: '右下角' };
const action = 'w-full rounded px-3 py-2 text-left text-sm hover:bg-accent focus-visible:outline focus-visible:outline-2 disabled:opacity-40';

export function BookBlockCanvas({ blocks, disabled, onCommit, children, activeId, onSelect }: {
  blocks: WritingBlock[]; disabled: boolean;
  activeId: string | null; onSelect(id: string | null): void;
  onCommit(next: WritingBlock[], focusId: string, focus?: boolean): void;
  children(block: WritingBlock, index: number, style: CSSProperties): ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const [imageRatios, setImageRatios] = useState<Record<string,number>>({});
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
  const [menuId, setMenuId] = useState<string | null>(null);
  const [preview, setPreview] = useState<WritingBlock[] | null>(null);
  const [drop, setDrop] = useState<BookDropTarget | null>(null);
  const gesture = useRef<{ id: string; pointer: number; x: number; y: number; scale: number; handle: ModuleHandle; before: BookPlacement; next: WritingBlock[]; drop: BookDropTarget | null; image?: ImageModule; imageFactor?: number } | null>(null);
  const scale = width / 900 * zoom;
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
      const current = gesture.current;
      if (!current) return;
      gesture.current = null;
      if (root.current?.hasPointerCapture(current.pointer)) root.current.releasePointerCapture(current.pointer);
      setPreview(null); setDrop(null);
    });
  }, []);
  const displayed = preview ?? blocks;
  const layouts = layoutBookBlocks(displayed,imageRatios);
  // "After a heading" means after its entire visible group, not between the heading and its children.
  const dropMarkerId = drop?.position === 'after'
    ? layouts.filter(item => item.block.id === drop.id || blockAncestors(displayed, item.block.id).includes(drop.id)).at(-1)?.block.id
    : drop?.id;
  const pageCount = Math.max(1, ...layouts.map(item => item.placement.page + 1));
  function apply(next: WritingBlock[], id: string, focus = true) {
    if (disabled || next === blocks) return;
    setMenuId(null); onCommit(next, id, focus);
  }
  function start(event: PointerEvent<HTMLButtonElement | HTMLDivElement>, id: string, placement: BookPlacement, handle: ModuleHandle, imageGesture = false) {
    if (disabled || event.button !== 0 || gesture.current) return;
    event.preventDefault(); event.stopPropagation(); onSelect(id); setMenuId(null);
    event.currentTarget.focus(); (root.current ?? event.currentTarget).setPointerCapture(event.pointerId);
    const block = blocks.find(item=>item.id===id)!;
    const baseX = 24 + Math.min(blockAncestors(blocks,id).length,4)*12;
    const imageFactor = Math.min((884-baseX)/900,1104/1200);
    const image = imageGesture ? bookImageModule(block.text,imageFactor) ?? undefined : undefined;
    if (image && !readBookImage(block.text)?.frame) {
      const svg = event.currentTarget.closest('[data-book-block]')?.querySelector('svg[aria-label="文章插图"]');
      const view = svg?.getAttribute('viewBox')?.split(' ').map(Number);
      if (view && view[2] > 0 && view[3] > 0) {
        const aspect = view[2]/view[3];
        const width = Math.min(placement.rect.width,placement.rect.height*aspect);
        const height = width/aspect;
        image.rect = {x:0,y:(placement.rect.height-height)/2/imageFactor,width:width/imageFactor,height:height/imageFactor};
      }
    }
    gesture.current = { image, imageFactor, id, pointer: event.pointerId, x: event.clientX, y: event.clientY, scale, handle, before: placement, next: blocks, drop: null };
  }
  function move(event: PointerEvent) {
    const current = gesture.current; if (!current || event.pointerId !== current.pointer) return;
    if (current.image) {
      if (Math.hypot(event.clientX-current.x,event.clientY-current.y)<2 && current.next === blocks) return;
      const factor = current.scale * current.imageFactor!;
      current.next = blocks.map(block=>block.id===current.id ? {...block,text:transformBookImage(block.text,current.image!,current.handle,(event.clientX-current.x)/factor,(event.clientY-current.y)/factor)} : block);
      setPreview(current.next);
    } else if (current.handle === 'move') {
      if (Math.hypot(event.clientX - current.x, event.clientY - current.y) < 4) return;
      const boxes = Array.from(root.current?.querySelectorAll<HTMLElement>('[data-book-block]') ?? []).map(element => {
        const rect = element.getBoundingClientRect();
        return { id: element.dataset.bookBlock!, top: rect.top, bottom: rect.bottom };
      });
      current.drop = findBookDrop(blocks, current.id, boxes, event.clientY);
      setDrop(current.drop);
    } else {
      const dx = (event.clientX - current.x) / current.scale * (current.handle.includes('w') ? -1 : 1);
      const dy = (event.clientY - current.y) / current.scale * (current.handle.includes('n') ? -1 : 1);
      const delta = Math.abs(dx) > Math.abs(dy) ? dx : dy;
      current.next = resizeBookBlock(blocks, current.id, current.before.fontSize * (1 + delta / 160));
      setPreview(current.next);
    }
  }
  function end(event: PointerEvent, cancelled = false) {
    const current = gesture.current; if (!current || event.pointerId !== current.pointer) return;
    gesture.current = null; setPreview(null); setDrop(null);
    if (cancelled) return;
    if (current.handle === 'move' && !current.image) {
      if (current.drop) apply(moveWritingBlock(blocks, current.id, current.drop.id, current.drop.position), current.id, false);
    } else apply(current.next, current.id, false);
  }

  return <><div ref={viewport} aria-label="文章缩放视图" data-book-zoom={zoom} className="-ml-11 -mr-2 -mt-8 min-w-0 overflow-x-auto pl-11 pr-2 pt-8" style={{ touchAction: 'pan-x pan-y' }}>
  <div ref={root} aria-label="书页" className="flex flex-col" style={{ width: width * zoom, gap: 20 * zoom }} onPointerMove={move} onPointerUp={end} onPointerCancel={event => end(event, true)} onLostPointerCapture={event => end(event, true)}>
    {Array.from({ length: pageCount }, (_, page) => <section key={page} aria-label={`第 ${page + 1} 页`}
      className="relative"
      style={{ height: 1200 * scale }}
      onPointerDown={event => { if (event.target === event.currentTarget) { onSelect(null); setMenuId(null); } }}>
      {layouts.filter(item => item.placement.page === page).map(({ block, index, placement }) => {
        const active = activeId === block.id || menuId === block.id;
        const patch = (value: Partial<WritingBlock>) => apply(blocks.map(item => item.id === block.id ? { ...item, ...value } : item), block.id);
        return <div key={block.id} data-book-block={block.id} onFocusCapture={() => onSelect(block.id)}
          className={`absolute group ${active ? 'z-10' : ''}`}
          style={{ left: placement.rect.x * scale, top: placement.rect.y * scale, width: placement.rect.width * scale, height: placement.rect.height * scale,
            background: block.backdrop ? 'rgba(255,255,245,.6)' : undefined }}>
          {drop && dropMarkerId === block.id && <div aria-label="模块插入位置" className={`pointer-events-none absolute left-0 right-0 z-30 border-t-2 border-[var(--nayin-accent)] ${drop.position === 'before' ? '-top-1' : '-bottom-1'}`}>
            {drop.position === 'inside' && <span className="absolute right-0 -top-5 bg-[var(--nayin-surface)] px-1 text-xs text-muted-foreground">放入标题</span>}
          </div>}
          <div className={`absolute -top-8 left-0 flex items-center gap-1 ${active ? '' : 'invisible group-focus-within:visible'}`}>
            <Popover open={menuId === block.id} onOpenChange={open => setMenuId(open ? block.id : null)}>
              <PopoverTrigger asChild><button type="button" aria-label={`模块 ${index + 1} 格式`} disabled={disabled}
                className="rounded border border-[var(--panel-border)] bg-[var(--nayin-surface)] px-2 py-1 text-xs shadow-sm">
                {bookImageUrl(block.text) ? '图片' : formats.find(([value]) => value === block.format)?.[1]} ▾
              </button></PopoverTrigger>
              <PopoverContent align="start" className="w-48 p-1" onCloseAutoFocus={event => event.preventDefault()} aria-label={`模块 ${index + 1} 设置`}>
                <p hidden={!bookImageUrl(block.text)} className="px-3 py-2 text-xs text-muted-foreground">拖图片移动 · 四角缩放 · 四边裁切</p>
                <div hidden={Boolean(bookImageUrl(block.text))} role="group" aria-label="格式">{formats.map(([value, label]) => <button key={value} type="button" disabled={disabled} className={action}
                  aria-pressed={block.format === value} onClick={() => apply(setBlockFormat(blocks, index, value), block.id)}>{block.format === value ? '✓ ' : ''}{label}</button>)}</div>
                <div className="my-1 border-t" />
                {(['normal', 'bright'] as const).map(value => <button type="button" key={value} disabled={disabled} className={action}
                  aria-pressed={(block.emphasis ?? 'normal') === value} onClick={() => patch({ emphasis: value })}>{(block.emphasis ?? 'normal') === value ? '✓ ' : ''}{value === 'normal' ? '正常' : '加粗提亮'}</button>)}
                <button type="button" disabled={disabled} className={action} aria-pressed={block.backdrop ?? false} onClick={() => patch({ backdrop: !block.backdrop })}>{block.backdrop ? '✓ ' : ''}半透明底色</button>
                <div className="my-1 border-t" />
                <button type="button" disabled={disabled} className={`${action} text-destructive`} onClick={() => {
                  const next = deleteBookBlock(blocks, block.id); apply(next, next[Math.min(index, next.length - 1)].id);
                }}>{bookImageUrl(block.text) ? '删除图片模块' : '删除文字模块'}</button>
              </PopoverContent>
            </Popover>
          </div>
          <button type="button" disabled={disabled} aria-label={`拖动模块 ${index + 1}`} title="拖动调整顺序或放入标题；上下键排序，左右键调整归属"
            className={`absolute -left-6 top-1 touch-none cursor-grab rounded px-1 text-muted-foreground active:cursor-grabbing ${active ? '' : 'opacity-40'}`}
            onPointerDown={event => start(event, block.id, placement, 'move')}
            onKeyDown={event => {
              if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key) || disabled) return;
              event.preventDefault();
              apply(moveBookBlockByKey(blocks, block.id, event.key), block.id, false);
            }}>⠿</button>
          {isHeading(block) && <button type="button" disabled={disabled} aria-label={`${block.collapsed ? '展开' : '收起'}标题 ${index + 1}`} aria-expanded={!block.collapsed}
            className="absolute -left-11 top-1 rounded px-1 text-muted-foreground" onClick={() => patch({ collapsed: !block.collapsed })}>{block.collapsed ? '▸' : '▾'}</button>}
          <div className={bookImageUrl(block.text) ? "h-full w-full touch-none cursor-grab active:cursor-grabbing" : "contents"} onPointerDown={bookImageUrl(block.text) ? event=>start(event,block.id,placement,'move',true) : undefined}>
          {children(block, index, { fontSize: placement.fontSize * scale, lineHeight: 1.6, fontWeight: isHeading(block) || block.emphasis === 'bright' ? 650 : 400,
            color: block.emphasis === 'bright' ? 'var(--nayin-accent)' : undefined, textShadow: block.emphasis === 'bright' ? '0 0 6px rgba(255,255,255,.8)' : undefined })}</div>
          {active && bookImageUrl(block.text) && Object.entries({left:'-left-1 top-2 bottom-2 w-2 cursor-ew-resize',right:'-right-1 top-2 bottom-2 w-2 cursor-ew-resize',top:'-top-1 left-2 right-2 h-2 cursor-ns-resize',bottom:'-bottom-1 left-2 right-2 h-2 cursor-ns-resize'}).map(([edge,position])=><button key={edge} type="button" disabled={disabled} aria-label={`图片模块 ${index+1} ${({left:"左",right:"右",top:"上",bottom:"下"} as Record<string,string>)[edge]}边裁切`} title="拖动边缘裁切" className={`absolute z-20 touch-none border border-transparent hover:border-primary focus-visible:border-primary ${position}`} onPointerDown={event=>start(event,block.id,placement,edge as ModuleHandle,true)}/>)}
          {active && Object.entries(corners).map(([corner, position]) => <button type="button" key={corner} disabled={disabled}
            aria-label={`模块 ${index + 1} ${cornerNames[corner as keyof typeof corners]}缩放`} title={bookImageUrl(block.text) ? "拖动四角等比缩放" : "缩放范围：½–2 倍"}
            onKeyDown={event => {
              if (!disabled && ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(event.key)) {
                event.preventDefault();
                const factor = Math.min((884-(24+Math.min(blockAncestors(blocks,block.id).length,4)*12))/900,1104/1200);
                const image = bookImageModule(block.text,factor);
                if (image) {
                  const delta = ['ArrowUp','ArrowRight'].includes(event.key) ? 10 : -10;
                  apply(blocks.map(item=>item.id===block.id?{...item,text:transformBookImage(item.text,image,corner as ModuleHandle,corner.includes('w')?-delta:delta,corner.includes('n')?-delta:delta)}:item),block.id,false);
                } else apply(resizeBookBlock(blocks, block.id, placement.fontSize + (['ArrowUp', 'ArrowRight'].includes(event.key) ? 2 : -2)), block.id, false);
              }
            }}
            className={`absolute z-20 flex h-5 w-5 touch-none items-center justify-center text-muted-foreground opacity-0 group-hover:opacity-40 hover:!opacity-100 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-1 ${position}`}
            onPointerDown={event => start(event, block.id, placement, corner as ModuleHandle, Boolean(bookImageUrl(block.text)))}><span aria-hidden="true" className={`pointer-events-none h-1.5 w-1.5 ${cornerEdges[corner as keyof typeof corners]}`} /></button>)}
        </div>;
      })}
      <span className="pointer-events-none absolute bottom-2 left-0 w-full text-center text-xs text-muted-foreground">{page + 1}</span>
    </section>)}
  </div></div>

  </>;
}
