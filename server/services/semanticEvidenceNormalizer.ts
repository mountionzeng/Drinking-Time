import { createHash } from "node:crypto";
import {
  SEMANTIC_ART_NORMALIZER_VERSION,
  type NormalizedSemanticArtEvidence,
  type SemanticArtEvidence,
} from "../../shared/semanticArtDirection";

export type SemanticEvidenceInput = {
  explicitDirection?: string;
  /** 仅限本轮明确情绪；不得传入长期画像或历史情绪摘要。 */
  currentEmotion?: string;
  storyText?: string;
  shotText?: string;
};

const CONCEPTS: Array<[string, RegExp]> = [
  ["quiet-grief-memory", /失去|离别|哀悼|悼念|逝去|bereave|grief/i],
  [
    "dream-dissolve",
    /消散的梦|梦(?:境)?般.*(?:消散|褪去)|朦胧.*梦|dissolv(?:e|ing).*dream/i,
  ],
  [
    "sparse-negative-space",
    /大片留白|大面积留白|空旷.*克制|稀疏.*留白|minimal.*negative space/i,
  ],
  ["colored-pencil", /彩铅|colored pencil/i],
  ["memory", /回忆|记忆|怀旧|memory|nostalgia/i],
  ["intimate-interior", /私密|亲密|旧厨房|卧室|家庭内部/i],
  ["motion", /奔跑|疾跑|追逐|眩晕|失重|快速掠过|running|vertigo/i],
  ["diffusion", /弥散|扩散|拖影|动态模糊|motion blur|diffus/i],
  [
    "modernist-lines",
    /常玉|Georges\s+Seurat|Seurat|修拉|吴冠中|书法性线条|平面色块|点彩.*留白|东方线性.*现代主义/i,
  ],
  ["quiet-reflection", /释然|清醒|松弛|平静地看待|从繁复中抽离|重新整理自己/i],
  [
    "life-transition",
    /毕业|离开校园|初次离家|转行|搬家|重新开始|重新出发|关系松动|人生转折/i,
  ],
  ["anxiety-pressure", /焦虑|压迫|规训|愤怒|窒息/i],
  ["mythic-nature", /神话|森林|星空|月亮|寓言/i],
  ["abstract-structure", /抽象结构|循环|宇宙|机制|几何秩序/i],
];

const NEGATION =
  /(?:不要|并非|不是|不想|不再|并不|没有|避免|拒绝|禁止|不|without|not|no)\s*[^，。！？\n]{0,18}$/i;
const OTHER_SUBJECT =
  /(?:他说|她说|角色说|对白|台词|墙上写着|书中写道|参考图中的人)[：:“\"]?\s*[^。！？\n]{0,24}$/;

function ranges(text: string): Array<[number, number]> {
  const result: Array<[number, number]> = [];
  const pairs: Array<[string, string]> = [
    ["“", "”"],
    ['"', '"'],
    ["‘", "’"],
  ];
  for (const [open, close] of pairs) {
    let start = text.indexOf(open);
    while (start >= 0) {
      const end = text.indexOf(close, start + open.length);
      if (end < 0) break;
      result.push([start, end + close.length]);
      start = text.indexOf(open, end + close.length);
    }
  }
  return result;
}

function collect(
  text: string,
  source: SemanticArtEvidence["source"]
): SemanticArtEvidence[] {
  const quoteRanges = ranges(text);
  const evidence: SemanticArtEvidence[] = [];
  for (const [concept, pattern] of CONCEPTS) {
    const match = pattern.exec(text);
    if (!match || match.index == null) continue;
    const prefix = text.slice(Math.max(0, match.index - 28), match.index);
    const quoted = quoteRanges.some(
      ([start, end]) => match.index! >= start && match.index! < end
    );
    const otherSubject = OTHER_SUBJECT.test(prefix);
    const negative = NEGATION.test(prefix);
    evidence.push({
      concept,
      weight:
        source === "explicit-direction"
          ? 3
          : source === "current-emotion" || source === "shot"
            ? 2
            : 1,
      source,
      polarity: negative
        ? "negative"
        : quoted || otherSubject
          ? "unknown"
          : "positive",
      quoted,
      subject:
        source === "explicit-direction"
          ? "visual-direction"
          : source === "current-emotion"
            ? "current-user-state"
            : otherSubject
              ? "other-subject"
              : "story-subject",
    });
  }
  return evidence;
}

export function normalizeSemanticArtEvidence(
  input: SemanticEvidenceInput
): NormalizedSemanticArtEvidence {
  const canonical = {
    explicitDirection: input.explicitDirection?.trim() ?? "",
    currentEmotion: input.currentEmotion?.trim() ?? "",
    storyText: input.storyText?.trim() ?? "",
    shotText: input.shotText?.trim() ?? "",
  };
  return {
    version: SEMANTIC_ART_NORMALIZER_VERSION,
    inputFingerprint: createHash("sha256")
      .update(JSON.stringify(canonical))
      .digest("hex"),
    evidence: [
      ...collect(canonical.explicitDirection, "explicit-direction"),
      ...collect(canonical.currentEmotion, "current-emotion"),
      ...collect(canonical.storyText, "story"),
      ...collect(canonical.shotText, "shot"),
    ],
  };
}
