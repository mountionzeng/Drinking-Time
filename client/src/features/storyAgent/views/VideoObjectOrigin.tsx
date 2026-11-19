import { useRef, useState } from "react";
import { videoObjectOrigin, type ObjectOrigin, type OriginRect } from "@shared/videoObjectOrigin";

type Props = {imageId:number;url:string;value?:ObjectOrigin; disabled?:boolean;onChange:(origin?:ObjectOrigin)=>void};
const clamp=(n:number)=>Math.min(1,Math.max(0,n));
export function VideoObjectOrigin({imageId,url,value,disabled,onChange}: Props) {
  const [label,setLabel]=useState(value?.label ?? "");
  const [rect,setRect]=useState<OriginRect|undefined>(value?.rect);
  const start=useRef<{x:number;y:number}|null>(null);
  function point(e:React.PointerEvent<HTMLDivElement>) {
    const b=e.currentTarget.getBoundingClientRect();return {x:clamp((e.clientX-b.left)/b.width),y:clamp((e.clientY-b.top)/b.height)};
  }
  function change(r:OriginRect|undefined,name:string) {
    setRect(r);setLabel(name);
    if(value) onChange(undefined);
  }
  const parsed=videoObjectOrigin.safeParse({imageId,label,rect});
  return <fieldset className="space-y-1 rounded border p-2"><legend>哪一个物体发生变化？</legend>
    <p>在首帧上框住原来的物体，核对局部图。渲染从这个位置开始。</p>
    <div className="relative w-full max-w-72 touch-none select-none" onPointerDown={e=>{
      if(disabled || e.button!==0)return; start.current=point(e); e.currentTarget.setPointerCapture(e.pointerId);
    }} onPointerMove={e=>{
      if(disabled || !start.current)return; const a=start.current,b=point(e);
      change({x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),w:Math.abs(a.x-b.x),h:Math.abs(a.y-b.y)},label);
    }} onPointerUp={()=>{start.current=null;}} onPointerCancel={()=>{start.current=null;}}>
      <img src={url} alt={"圈选首帧 #"+imageId+" 的变形主体"} draggable={false} className="block w-full"/>
      {rect && <span aria-hidden className="pointer-events-none absolute border-2 border-sky-500" style={{left:rect.x*100+"%",top:rect.y*100+"%",width:rect.w*100+"%",height:rect.h*100+"%"}}/>}
    </div>
    <details><summary>按百分比精确定位</summary><div className="flex flex-wrap gap-1">{(["x","y","w","h"] as const).map((field,i)=><label key={field}>{["左","上","宽","高"][i]} <input type="number" min={0} max={100} step=".1" className="w-14 rounded border" aria-label={"主体范围"+["左","上","宽","高"][i]+"百分比"} disabled={disabled}
      value={rect ? Number((rect[field]*100).toFixed(2)) : ""} onChange={e=>change({...{x:0,y:0,w:0,h:0},...rect,[field]:Number(e.target.value)/100},label)}/>%</label>)}</div></details>
    <label className="block">变化主体 <input aria-label="变化主体名称" className="w-full rounded border px-1" placeholder="写出方框里实际看到的物体" maxLength={90} value={label} disabled={disabled} onChange={e=>change(rect,e.target.value)}/></label>
    {rect && rect.w>=.01 && rect.h>=.01 && <div className="flex items-center gap-2"><div role="img" aria-label="圈选主体放大图" className="w-24 shrink-0 rounded border" style={{aspectRatio:rect.w/rect.h, maxHeight:"9rem",backgroundImage:`url("${url}")`,backgroundSize:`${100/rect.w}% ${100/rect.h}%`,backgroundPosition:`${100*rect.x/Math.max(.00001,1-rect.w)}% ${100*rect.y/Math.max(.00001,1-rect.h)}%`}}/>
      <button type="button" className="rounded border px-2 py-1" disabled={disabled || !parsed.success || Boolean(value)} onClick={()=>{if(parsed.success)onChange(parsed.data);}}>{value?"已锁定主体":"锁定图中这个物体"}</button></div>}
  </fieldset>;
}
