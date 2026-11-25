import { stripExplicitScreenText } from "./bookScreenText";

/** Project a still frame, leaving spoken words and transitions in the source script. */
export function stillVisualDescription(value: string): string {
  return stripExplicitScreenText(value)
    .replace(/(?:画外音(?:继续)?|旁白(?:继续)?|对白|台词|声音建议|音效|配乐|voice[- ]?over|narration|dialogue|sound)(?:[（(][^）)\n]{0,30}[）)])?\s*[：:]\s*(?:「[^」\n]*」|“[^”\n]*”|"[^"\n]*"|『[^』\n]*』|[^\n]*?(?=(?:画面|visuals?)\s*[：:]|\n|$))/giu, "")
    .replace(/[,，]?\s*(?:与|和)[^，。；\n]{1,40}(?:叠化|交叉淡化)/gu, "")
    .replace(/(?:图片要求(?:（最高优先级）)?|画面动作|画面描述|开场画面|结束画面|画面|visuals?)[：:]/giu, "")
    .replace(/【[^】]+】/gu, "").replace(/\s+/gu, " ").trim();
}
