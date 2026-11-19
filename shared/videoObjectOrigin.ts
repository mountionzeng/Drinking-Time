import { z } from "zod";

export const videoOriginRect = z.object({
  x: z.number().min(0).max(1), y: z.number().min(0).max(1),
  w: z.number().min(.01).max(.95), h: z.number().min(.01).max(.95),
}).refine(r => r.x + r.w <= 1.000001 && r.y + r.h <= 1.000001, "选区超出首帧");
export const videoObjectOrigin = z.object({
  imageId: z.number().int().positive(), label: z.string().trim().min(1).max(90),
  rect: videoOriginRect,
});
export type ObjectOrigin = z.infer<typeof videoObjectOrigin>;
export type OriginRect = z.infer<typeof videoOriginRect>;

export function needsObjectOrigin(text: string) {
  return text.split(/[。！；\n，,]/).some(clause =>
    !/不要|禁止|不得|不能|不会|不再|不要把/.test(clause) &&
    /变成|变为|形变为|变形为|从.{0,28}(?:按钮|发送键|图标).{0,16}(?:起飞|飞出|脱离)|(?:按钮|发送键|图标).{0,24}(?:起飞|飞出|变[得的])|(?:transforms?|morphs?|turns?) into/i.test(clause)
  );
}
export function describeOrigin(origin: ObjectOrigin, width: number, height: number) {
  const { x,y,w,h } = origin.rect;
  const pixels = [x*width,y*height,(x+w)*width,(y+h)*height].map(Math.round);
  return `变化主体已核对：首帧 #${origin.imageId} 的「${origin.label}」，源尺寸 ${width}×${height}，源图矩形（左上至右下）${pixels.join(",")}。变化从框内这个原物体的位置连续开始。原物体本身变为目标，原位不留下副本。框外的其他物体不参与变形。坐标和方框只用来定位，不能画入成片。`;
}
