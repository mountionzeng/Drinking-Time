import sharp from "sharp";
import { materializeImageInput } from "./imageAssets";

export class SourceFrameReadError extends Error {}

type Boundary = { axis: "row" | "column"; position: number; coverage: number };
export type FrameReading = { width: number; height: number; tones: number[]; boundaries: Boundary[] };

/** Long, coherent transitions are candidates for inspection. Text strokes and isolated gradients
 * must not become a mask or a direction to blur an intentional silhouette. */
export async function readFramePixels(bytes: Uint8Array): Promise<FrameReading> {
  const source = sharp(bytes, { limitInputPixels: 64 * 1024 * 1024 });
  const meta = await source.metadata();
  if (!meta.width || !meta.height || (meta.pages ?? 1) !== 1) throw Error("需要单张可读取的原画面");
  const rotated = [5, 6, 7, 8].includes(meta.orientation ?? 1);
  const {data, info} = await source.rotate().flatten({background: "#fff"}).toColourspace("srgb")
    .resize({width:128,height:128,fit:"inside",withoutEnlargement:true}).removeAlpha().raw().toBuffer({resolveWithObject:true});
  const w = info.width, h = info.height;
  const tones = [0,0,0,0], counts = [0,0,0,0];
  const rows = Array<number>(h).fill(0), columns = Array<number>(w).fill(0);
  const distance = (a:number,b:number) => Math.max(Math.abs(data[a]-data[b]),Math.abs(data[a+1]-data[b+1]),Math.abs(data[a+2]-data[b+2]));
  for (let y=0; y<h; y++) for (let x=0; x<w; x++) {
    const p=(y*w+x)*info.channels, quadrant=Number(x>=w/2)+2*Number(y>=h/2);
    tones[quadrant] += .2126*data[p]+.7152*data[p+1]+.0722*data[p+2]; counts[quadrant]++;
    if (y && distance(p,p-w*info.channels)>=12) rows[y]++;
    if (x && distance(p,p-info.channels)>=12) columns[x]++;
  }
  const lines = (values:number[],span:number,axis:Boundary["axis"]) => values.map((count,pos)=>({
    axis, position:Math.round(100*pos/values.length), coverage:Math.round(100*count/span),
  })).filter(line=>line.coverage>=38 && line.position>0);
  const boundaries: Boundary[]=[];
  for (const line of [...lines(rows,w,"row"),...lines(columns,h,"column")].sort((a,b)=>b.coverage-a.coverage)) {
    if (boundaries.every(b=>b.axis!==line.axis || Math.abs(b.position-line.position)>8)) boundaries.push(line);
    if (boundaries.length===2) break;
  }
  return {width:rotated?meta.height:meta.width,height:rotated?meta.width:meta.height,
    tones:tones.map((sum,i)=>Math.round(sum/Math.max(1,counts[i]))),boundaries};
}

export async function inspectSourceFrame(url:string, userId?:number):Promise<FrameReading> {
  try {
    const source = url.startsWith("data:image/") ? url : await materializeImageInput(url,userId);
    const inline = /^data:image\/[a-z0-9.+-]+;base64,/i.exec(source);
    const encoded = inline ? source.slice(inline[0].length) : null;
    if (encoded && encoded.length>56*1024*1024) throw Error("原图超过可读取大小");
    const bytes = encoded!==null ? Buffer.from(encoded,"base64") : (await (await import("./editingTransitionWorkflow")).imageBytesForAsset(source,40*1024*1024)).bytes;
    return await readFramePixels(bytes);
  } catch {
    throw new SourceFrameReadError("原画面无法读取或解码，本次未提交生成。请重新选择可打开的原图。");
  }
}

export function frameReadingSummary(frame:FrameReading) {
  const positions=frame.boundaries.map(b=>(b.axis==="row"?"纵向位置":"横向位置")+b.position+"% 的"+(b.axis==="row"?"横":"竖")+"向交界");
  const direction = frame.boundaries.length && frame.boundaries.every(b=>b.position<16 || b.position>84)
    ? "先检查画幅外沿的材质和受光衔接，保留主体轮廓。"
    : "先辨认画内的设计轮廓，保留文字和控件的锐度，只调整突兀的材质交界。";
  return frame.width+"×"+frame.height+" · 四区亮度 "+frame.tones.join("/")+"（左上、右上、左下、右下） · "+
    (positions.length?"复核"+positions.join("、")+"，区分材质接缝与有意保留的轮廓":"未检测到横贯大片画面的直线突变，保留局部轮廓")+"。"+direction;
}

export async function renderSourceDirection(urls:readonly string[],userId?:number) {
  const facts:string[]=[];
  for (const url of new Set(urls)) {
    const frame=await inspectSourceFrame(url,userId);
    const lines=frame.boundaries.map(b=>(b.axis==="row"?"y":"x")+"="+b.position+"%").join(",");
    facts.push("ref"+(facts.length+1)+" "+frame.width+"x"+frame.height+" luma(TL/TR/BL/BR)="+frame.tones.join("/")+(lines ? " broad transitions "+lines+(frame.boundaries.every(b=>b.position<16 || b.position>84)
      ? " (check perimeter material joins; retain subject outlines)" : " (check for designed interior contours before changing any edge)")
      : "; no broad linear transition detected; retain the native edge treatment"));
  }
  return facts.length ? "Source observations: "+facts.join("; ")+". Inspect joins in the supplied images. In the requested edit region match nearby material, texture, bounce light and contact shadows. Preserve intentional silhouettes, lettering and controls. Use each reference only for its assigned role." : "";
}
