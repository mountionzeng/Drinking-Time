export type CropEdge = "左" | "右" | "上" | "下" | "居中";
export type BookCrop = { edge?: CropEdge; ratio?: number; fraction?: number; pixels?: number };
const opposite = {左:"右",右:"左",上:"下",下:"上"} as const;

// Only discard a clause from the painting prompt if every word describes framing.
// Unfamiliar instructions stay verbatim for the user to review before purchase.
const framingWords = /不要重画|不用重绘|无需重新生成|请|帮我|我想|希望|把|将|先|然后|直接|再|只|要|给我|这张|这个|图片|图像|画面|照片|图|的|从|按|比例|改为|改成|变成|调整为|裁|剪|切|掉|去|成|正方形|方图|方形|居中|中心|中间|保留|留下|留|左|右|上|下|边|侧|面|方|部分|半|一|块|幅|张|段|像素|px|宽高比|\d+(?:\.\d+)?|[:：比%％]|\s/giu;
function isFramingClause(part: string) {
  return /裁|剪|切|正方形|方图|方形|保留|留|居中|中间|[:：比%％]|像素|px|一半|不要重画|不用重绘|无需重新生成/iu.test(part) &&
    part.replace(framingWords,"") === "";
}

export function bookImageEditSteps(instruction: string): {crop?: BookCrop; changes: string[]} {
  const changes: string[] = [];
  const framing: string[] = [];
  for (const sentence of instruction.trim().split(/[。；;！？!?\n]+/u).filter(Boolean)) {
    let remaining = "";
    for (const part of sentence.split(/([，,、]|(?=然后|再把|再将|并把|并将))/u)) {
      if (!part) continue;
      if (isFramingClause(part)) {
        framing.push(part);
        if (remaining.replace(/[，,、\s]/gu, "")) changes.push(remaining.trim().replace(/[，,、]+$/u,""));
        remaining = "";
      } else if (remaining || !/^[，,、]$/u.test(part)) remaining += part;
    }
    if (remaining.trim()) changes.push(remaining.trim());
  }
  const crop = bookCropIntent(framing.join("，"));
  if (crop && !changes.some(change => /(?:别|不(?:要|用|许|是)?)\s*(?:裁|剪|切)/u.test(change))) return {crop, changes};
  return {changes: instruction.trim().split(/[。；;！？!?\n]+/u).map(s=>s.trim()).filter(Boolean)};
}

/** Only handle framing. Painting an object out or extending the canvas requires a different operation. */
export function bookCropIntent(instruction: string): BookCrop | undefined {
  const text = instruction.toLowerCase().replace(/\s+/g,"").replace(/(?:不要|不用|无需|不必)(?:重新)?(?:重画|重绘|绘制|生成)/gu,"");
  if (!/(?:裁[剪切掉去成左右上下]|[左右上下边侧]裁|剪掉|切掉|正方形|方图|方形|1[:：]1)|(?:只留|只保留|只要)(?:图片|画面)?[左右上下]半/u.test(text)) return;
  if (/重画|重绘|补画|扩图|扩展|填充|换色|调色|提亮|变亮|清晰|擦除|去除人物|换(?:成)?.*(?:画风|背景)|画一|添加|加上|移到|挪到|放大|缩小|裁掉.*(?:人像|那个人|路人|水印|汽车)/u.test(text)) return;
  const edges = new Set<CropEdge>();
  for (const match of text.matchAll(/(?:保留|留下?|保住|只要)(?:图像?|画面|图片)?(?:的)?([左右上下])/gu))
    edges.add(opposite[match[1] as keyof typeof opposite]);
  for (const match of text.matchAll(/(?:裁掉?|裁去|裁剪掉?|去掉|剪掉|切掉|去除)(?:图片|图像|画面)?(?:的)?([左右上下])|([左右上下])(?:边|侧|面|方|半边|半)?(?:的)?(?:这|那)?(?:一)?(?:部分|半|块|段)?(?:直接|给我|给)?(?:裁掉|裁去|剪掉|切掉|去掉)/gu))
    edges.add((match[1] ?? match[2]) as CropEdge);
  if (/居中|中心裁|中间裁/u.test(text)) edges.add("居中");
  const aspect = text.match(/(\d+(?:\.\d+)?)[:：比](\d+(?:\.\d+)?)/u);
  const ratio = aspect && Number(aspect[1])>0 && Number(aspect[2])>0 ? Number(aspect[1])/Number(aspect[2]) :
    /正方形|方图|方形/u.test(text) ? 1 : undefined;
  const percentage = text.match(/(\d+(?:\.\d+)?)%/u);
  const amountPx=text.match(/(\d+)(?:像素|px)/u);
  const pixels=amountPx && !/(?:保留|留下?|只要).*?(?:像素|px)/u.test(text) && Number(amountPx[1])>0 ? Number(amountPx[1]) : undefined;
  const amount = percentage && Number(percentage[1])>0 && Number(percentage[1])<100 ? Number(percentage[1])/100 : undefined;
  const fraction = amount!==undefined ? /(?:保留|留下?|只要)[左右上下](?:边|侧|方|面|的|部分)*\d+(?:\.\d+)?%/u.test(text) ? 1-amount : amount :
    /一半|半边|半幅|半张|半部分|[左右上下]半/u.test(text) ? 0.5 : undefined;
  // Negation or conflicting directions must be resolved before offering a crop.
  const edge = edges.size===1 && !/不(?:要|是|用|许)?(?:裁|剪|切|留|保留|去掉)/u.test(text) ? [...edges][0] : undefined;
  return {edge,ratio,fraction,pixels};
}

export function bookCropRect(width:number,height:number,plan:BookCrop) {
  if (!width || !height || !plan.edge || (!plan.ratio && !plan.fraction && !plan.pixels)) return;
  const horizontal = plan.edge==="左" || plan.edge==="右";
  let w=width, h=height;
  if (plan.ratio) {
    w=Math.min(width,Math.max(1,Math.round(height*plan.ratio)));
    h=Math.min(height,Math.max(1,Math.round(width/plan.ratio)));
    if (plan.edge!=="居中" && (horizontal ? h<height : w<width)) return;
  } else {
    if (plan.edge==="居中") return;
    const side=horizontal ? width : height;
    const remaining=plan.pixels!==undefined ? side-plan.pixels : Math.round(side*(1-plan.fraction!));
    if(remaining<1 || remaining>=side)return;
    if (horizontal) w=remaining;
    else h=remaining;
  }
  return {x:plan.edge==="左"?width-w:plan.edge==="居中"?Math.floor((width-w)/2):0,
    y:plan.edge==="上"?height-h:plan.edge==="居中"?Math.floor((height-h)/2):0,width:w,height:h};
}

export function cropLabel(edge:CropEdge) {
  return edge==="居中" ? "居中裁切" : `裁${edge}，留${opposite[edge]}`;
}

export async function bookCropFile(image:HTMLImageElement,rect:NonNullable<ReturnType<typeof bookCropRect>>) {
  const canvas=document.createElement("canvas");
  canvas.width=rect.width;canvas.height=rect.height;
  const ctx=canvas.getContext("2d");
  if (!ctx) throw Error("当前浏览器无法裁切图片");
  ctx.drawImage(image,rect.x,rect.y,rect.width,rect.height,0,0,rect.width,rect.height);
  const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error("无法保存裁切图片")),"image/png"));
  return new File([blob],"裁切.png",{type:"image/png"});
}
