import { readShotField } from "./bookShotFormat";

export const productionLabels = { image:"画面", video:"视频", music:"音乐", narration:"旁白" } as const;
export type ProductionKind = keyof typeof productionLabels;
export const productionKinds = Object.keys(productionLabels) as ProductionKind[];

// A timeline position or a subtitle interval does not specify a clip's length.
const numeral = "(\\d+(?:\\.\\d+)?|十|[一二两三四五六七八九])";
function seconds(raw: string) {
  return /^\d/u.test(raw) ? Number(raw) : raw === "两" ? 2 : "零一二三四五六七八九十".indexOf(raw);
}
export function readProductionSeconds(lines: readonly string[]) {
  const values = new Set<number>();
  let confirmed: number | undefined;
  for (const text of lines) for (const line of text.split("\n")) {
    const field = readShotField(line);
    const header = line.trim().replace(/\*\*/g,"").split(/[:：]/,1)[0];
    const duration = field?.kind === "motion" ? header.match(new RegExp("[｜|（(]\\s*(?:时长\\s*)?"+numeral+"\\s*秒(?:钟)?(?:[）)｜|]|$)","u")) :
      field?.kind === "timing" ? field.inline.match(new RegExp("^(?:本镜|视频)?(?:时长)?\\s*"+numeral+"\\s*秒(?:钟)?(?:[，,。；;\\s]|$)","u")) : null;
    if (duration) {
      const value = seconds(duration[1]);
      values.add(value);
      if (header==="已确认视频时长") confirmed=value;
    }
  }
  return confirmed ?? (values.size === 1 ? [...values][0] : undefined);
}
export function answeredSeconds(text: string) {
  const match = text.trim().match(new RegExp("^(?:就|用|做|要|时长|视频|本镜|设为|设置为|大约|约|\\s)*"+numeral+"\\s*(?:秒钟?|s)?(?:就好|即可|吧|就行)?[。.!！\\s]*$","iu"));
  const value = match && seconds(match[1]);
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 10 ? value : undefined;
}
export function productionTurnHint(messages: readonly {role:string;content:string}[],shotNo:number,kind:ProductionKind|"duration") {
  // Only an author's explicitly attributed single-shot direction can fill a missing cue.
  for (const turn of [...messages].reverse()) {
    if (turn.role !== "user") continue;
    const pattern = /^(?:我希望|我想|我想让|请把|把|给|请)?\s*第\s*0*(\d+|十|[一二两三四五六七八九])\s*镜(?:头)?(?:的)?[，,：:\s]*(画面描述|画面|视频时长|总时长|总长|时长|视频|运镜|音乐|配乐|旁白|台词)(?:要求)?\s*(?:[:：]|改成|设为|用|是|写成|写为)\s*(.+)$/u;
    const m = turn.content.trim().match(pattern);
    if (!m || seconds(m[1]) !== shotNo || /第\s*\d+\s*镜/u.test(m[3])) continue;
    const type = /时长|总长/u.test(m[2]) ? "duration" : /画面/u.test(m[2]) ? "image" : /视频|运镜/u.test(m[2]) ? "video" : /配乐|音乐/u.test(m[2]) ? "music" : "narration";
    if (type === kind) return m[3].trim();
  }
  return "";
}
