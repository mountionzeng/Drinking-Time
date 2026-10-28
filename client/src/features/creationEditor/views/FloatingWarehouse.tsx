import { useEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';

/** A non-modal palette: the manuscript remains usable behind it. Position is UI-only. */
export function FloatingWarehouse({ expanded, compact = false, children }: { expanded: boolean; compact?: boolean; children: ReactNode }) {
  const panel = useRef<HTMLElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const drag = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(null);
  useEffect(() => {
    const keepVisible = () => {
      if (expanded) return;
      const rect = panel.current?.getBoundingClientRect();
      if (!rect) return;
      setPosition(current => current ? {
        left: Math.max(8, Math.min(current.left, window.innerWidth - rect.width - 8)),
        top: Math.max(8, Math.min(current.top, window.innerHeight - rect.height - 8)),
      } : null);
    };
    window.addEventListener('resize',keepVisible);
    return () => window.removeEventListener('resize',keepVisible);
  },[expanded]);
  function move(left: number, top: number) {
    const rect = panel.current?.getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(left, window.innerWidth - (rect?.width ?? 320) - 8)),
      top: Math.max(8, Math.min(top, window.innerHeight - (rect?.height ?? 300) - 8)) });
  }
  const style: CSSProperties = compact
    ? { width: expanded ? 'calc(100vw - 24px)' : 'min(620px, calc(100vw - 24px))', height: 'auto',
        maxHeight: 'calc(100dvh - 24px)',
        ...(expanded ? {left:12, bottom:12} : position ? {left:position.left,top:position.top} : {right:16,bottom:16}) }
    : expanded
    ? { inset: 12 }
    : { width: 'min(620px, calc(100vw - 24px))', height: 'auto',
        minWidth: 'min(320px, calc(100vw - 24px))', minHeight: 'min(140px, calc(100dvh - 24px))',
        maxWidth: 'calc(100vw - 24px)', maxHeight: 'min(540px, calc(100dvh - 100px))', resize: 'both',
        ...(position ? {left:position.left,top:position.top} : {right:16,top:84}) };
  const content = <section ref={panel} id="editing-material-warehouse" aria-label="素材仓库悬浮窗"
    data-testid="material-warehouse-drawer" style={style}
    className="fixed z-40 flex flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl"
    onPointerDown={event => {
      if (expanded || event.button !== 0 || !(event.target as Element).closest('[data-warehouse-handle]')) return;
      const rect = event.currentTarget.getBoundingClientRect();
      drag.current={id:event.pointerId,x:event.clientX,y:event.clientY,left:rect.left,top:rect.top};
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    }}
    onPointerMove={event => {
      const start=drag.current;
      if(start?.id===event.pointerId) move(start.left+event.clientX-start.x,start.top+event.clientY-start.y);
    }}
    onPointerUp={event => {
      drag.current=null;
      if(event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }}
    onPointerCancel={()=>{drag.current=null;}}
    onLostPointerCapture={()=>{drag.current=null;}}
    onKeyDown={event => {
      if(expanded || !(event.target as Element).closest('[data-warehouse-handle]')) return;
      const step={ArrowLeft:[-20,0],ArrowRight:[20,0],ArrowUp:[0,-20],ArrowDown:[0,20]}[event.key];
      const rect=panel.current?.getBoundingClientRect();
      if(step && rect){ event.preventDefault(); move(rect.left+step[0],rect.top+step[1]); }
    }}>
    {children}
  </section>;
  return typeof document === 'undefined' ? content : createPortal(content,document.body);
}
