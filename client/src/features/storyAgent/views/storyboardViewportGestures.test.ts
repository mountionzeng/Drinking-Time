import { describe, expect, it, vi } from "vitest";
import { bindStoryboardViewportGestures, type StoryboardGestureView } from "./storyboardViewportGestures";
import { storyboardZoomViewport } from "./StoryboardTimelineRuler";

function setup() {
  let view: StoryboardGestureView = {scale:20,scrollLeft:100,totalMs:60000,availableWidth:500};
  let editor = false, blocked = false;
  const element = Object.assign(new EventTarget(), {
    clientWidth: 660,
    getBoundingClientRect: () => ({left:100}),
    closest: () => editor ? {} : null,
  });
  const change = vi.fn((next: {scale:number;scrollLeft:number}) => {view={...view,...next};});
  const interaction = vi.fn();
  const dispose = bindStoryboardViewportGestures(element as unknown as HTMLElement, {
    headerWidth:160, read:()=>view, change, onInteraction:interaction, blocked:()=>blocked,
  });
  const send = (type:string, values:Record<string,unknown>={}) => {
    const event = Object.assign(new Event(type,{cancelable:true}), {deltaX:0,deltaY:0,deltaMode:0,clientX:460}, values);
    element.dispatchEvent(event);return event;
  };
  return {send,change,interaction,dispose,view:()=>view,editor:()=>{editor=true;},block:()=>{blocked=true;}};
}
describe("Storyboard trackpad navigation",()=>{
  it("pinches around the pointer time beyond the fixed label column and composes rapid input",()=>{
    const s=setup();const initialTime=(100+200)/20;
    expect(s.send("wheel",{ctrlKey:true,deltaY:-40}).defaultPrevented).toBe(true);
    expect(s.view().scale).toBeCloseTo(20*Math.exp(.2));
    expect((s.view().scrollLeft+200)/s.view().scale).toBeCloseTo(initialTime);
    s.send("wheel",{ctrlKey:true,deltaY:-40});
    expect(s.view().scale).toBeCloseTo(20*Math.exp(.4));
    s.send("wheel",{ctrlKey:true,deltaY:80});
    expect(s.view()).toMatchObject({scale:expect.closeTo(20),scrollLeft:expect.closeTo(100)});
  });
  it("pans horizontally without zooming or consuming ordinary vertical scroll",()=>{
    const s=setup();
    expect(s.send("wheel",{deltaX:90,deltaY:2}).defaultPrevented).toBe(true);
    expect(s.view()).toMatchObject({scale:20,scrollLeft:190});
    expect(s.send("wheel",{deltaX:2,deltaY:90}).defaultPrevented).toBe(false);
    expect(s.change).toHaveBeenCalledTimes(1);
    s.send("wheel",{deltaX:-500}); expect(s.view().scrollLeft).toBe(0);
    s.send("wheel",{shiftKey:true,deltaY:5,deltaMode:1});expect(s.view().scrollLeft).toBe(80);
    expect(s.interaction).toHaveBeenCalledTimes(3);
  });
  it("normalizes page/line wheels and clamps zoom to the existing slider limits",()=>{
    const s=setup();
    s.send("wheel",{deltaX:1,deltaMode:2});expect(s.view().scrollLeft).toBe(600);
    for(let i=0;i<10;i++)s.send("wheel",{ctrlKey:true,deltaY:-1000});
    expect(s.view().scale).toBe(storyboardZoomViewport(60000,500,100).scale);
    for(let i=0;i<20;i++)s.send("wheel",{ctrlKey:true,deltaY:1000});
    expect(s.view().scale).toBe(storyboardZoomViewport(60000,500,0).scale);
    expect(s.view().scrollLeft).toBeGreaterThanOrEqual(0);
  });
  it("supports Safari cumulative gestures, including a moving center, without double wheel zoom",()=>{
    const s=setup();s.send("gesturestart");
    s.send("gesturechange",{scale:1.5,clientX:480});
    expect(s.view()).toMatchObject({scale:30,scrollLeft:230}); // 15s remains under center x220.
    s.send("wheel",{ctrlKey:true,deltaY:-100});expect(s.change).toHaveBeenCalledOnce();
    s.send("gesturechange",{scale:2,clientX:480});expect(s.view().scale).toBe(40);
    s.send("gestureend");s.send("wheel",{deltaX:50});expect(s.view().scrollLeft).toBe(430);
  });
  it("keeps text editors, clip drags and unrelated gestures alone",()=>{
    const editor=setup();editor.editor();
    expect(editor.send("wheel",{ctrlKey:true,deltaY:-40}).defaultPrevented).toBe(false);
    expect(editor.send("gesturestart").defaultPrevented).toBe(false);
    expect(editor.change).not.toHaveBeenCalled();
    const drag=setup();drag.block();drag.send("wheel",{ctrlKey:true,deltaY:-40});
    expect(drag.change).not.toHaveBeenCalled();
    const pointer=setup();pointer.send("wheel",{ctrlKey:true,deltaY:-40,buttons:1});
    pointer.send("gesturechange",{scale:2});expect(pointer.change).not.toHaveBeenCalled();
  });
  it("removes listeners and never consumes gestures after disposal",()=>{
    const s=setup();s.dispose();
    expect(s.send("wheel",{ctrlKey:true,deltaY:-40}).defaultPrevented).toBe(false);
    s.send("gesturestart");s.send("gesturechange",{scale:2});
    expect(s.change).not.toHaveBeenCalled();expect(s.interaction).not.toHaveBeenCalled();
  });
});
