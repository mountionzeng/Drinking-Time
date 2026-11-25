export const feedbackTrackNames = { visual: "画面", music: "音乐", narration: "旁白" } as const;
export type FeedbackTrack = keyof typeof feedbackTrackNames;

const terms: Record<FeedbackTrack, RegExp> = {
  music: /背景音(?:乐)?|音乐|配乐|伴奏|节拍|\bmusic\b|\bbgm\b/iu,
  narration: /旁白|人声|语音|说话声|台词|配音|对白|解说|语速|朗读|\b(?:narration|voiceover|voice-over)\b/iu,
  visual: /画面|视频|图片|图像|镜头运动|运镜|构图|镜头|\b(?:picture|visuals?|video)\b/iu,
};
const tracksIn = (text: string) => (Object.keys(terms) as FeedbackTrack[]).filter(key => terms[key].test(text));

const targetWord = Object.values(terms).map(re => re.source).join("|");
export function feedbackEditTargets(text: string) {
  // Remove reference clauses on either side of the requested change.
  const action = text
    .replace(/[“「"][^”」"]+[”」"]/gu, "")
    .replace(/(?:随着|伴随|跟着|配合|参照|参考|按照|跟随|跟|随)(?:这句|这段|当前|背景|原有|原来的|的|\s)*(?:旁白|台词|音乐|配乐|画面)(?:的)?(?:节奏|节拍|速度|出现)?/gu, "")
    .replace(/(?:旁白|台词|音乐|画面)(?:响起|出现|开始|结束|说完|说到)(?:的)?(?:时候|时)/gu, "")
    .replace(new RegExp("(?:别|不要|不用|不必|不)(?:再)?(?:动|改|调|是)(?:的|原来的|原有|背景|这段)*(" + targetWord + ")", "giu"), "")
    .replace(new RegExp("(" + targetWord + ")(?:保持不变|保持原样|照旧|不变|不动|别动|不改|不用改|不要改)", "giu"), "")
    .replace(/(?:第\s*)?[\d零一二两三四五六七八九十]+\s*镜(?:头)?|镜头\s*\d+/gu, "");
  return tracksIn(action);
}
