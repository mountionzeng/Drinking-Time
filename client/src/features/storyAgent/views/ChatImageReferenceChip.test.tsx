import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({ open:false, setOpen:vi.fn(), button:{} as any, content:{} as any }));
vi.mock("react", async load=>({...await load<typeof import("react")>(), useState:()=>[m.open,m.setOpen]}));
vi.mock("@/features/uiLanguage/UiLanguage",()=>({useUiLanguage:()=>({language:"zh"})}));
vi.mock("@/components/ui/popover",()=>({
 Popover:({children}:any)=>children,
 PopoverTrigger:({children}:any)=>{m.button=children.props;return children;},
 PopoverContent:(props:any)=>{m.content=props;return m.open ? <div>{props.children}</div> : null;},
}));
import { ChatImageReferenceChip } from "./ChatImageReferenceChip";
const render=()=>renderToStaticMarkup(<ChatImageReferenceChip imageId={2110} imageUrl="/api/images/original.png"/>);
beforeEach(()=>{vi.stubGlobal("React",React);vi.useFakeTimers();m.open=false;m.setOpen.mockClear();});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
it("shows a real thumbnail with the exact image identity before preview is opened",()=>{
 const html=render();expect(html).toContain('src="/api/images/original.png"');expect(html).toContain("图片 #2110");expect(html.match(/<img/g)).toHaveLength(1);
 expect(html).not.toContain("<details");
});
it("opens on mouse hover or keyboard focus and keeps the preview open while the pointer enters it",()=>{
 render();m.button.onPointerEnter({pointerType:"touch"});expect(m.setOpen).not.toHaveBeenCalled();
 m.button.onPointerEnter({pointerType:"mouse"});expect(m.setOpen).toHaveBeenLastCalledWith(true);
 m.button.onPointerLeave();m.content.onPointerEnter();vi.advanceTimersByTime(150);expect(m.setOpen).not.toHaveBeenCalledWith(false);
 m.content.onPointerLeave();vi.advanceTimersByTime(150);expect(m.setOpen).toHaveBeenLastCalledWith(false);
 m.button.onFocus();expect(m.setOpen).toHaveBeenLastCalledWith(true);
});
it("previews the full original without taking keyboard focus from the draft",()=>{
 m.open=true;const html=render();expect(html.match(/src="\/api\/images\/original.png"/g)).toHaveLength(2);
 expect(html).toContain("object-contain");const event={preventDefault:vi.fn()};m.content.onOpenAutoFocus(event);m.content.onCloseAutoFocus(event);expect(event.preventDefault).toHaveBeenCalledTimes(2);
});
