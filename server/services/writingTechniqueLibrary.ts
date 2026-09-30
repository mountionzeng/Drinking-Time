/** Human-maintained, versioned craft notes. Examples are original, not quotations.
 * Author associations are editorial interpretations, not verified textual analysis.
 */
export const WRITING_LIBRARY_VERSION = "2026-09-29.1";
export const WRITING_PROMPT_VERSION = "text-draft-two-pass.1";
export const WRITING_TECHNIQUES = [
  {
    id: "concrete-memory",
    author: "朱自清",
    work: "背影",
    provenance: "作品书目参照；技巧归纳为编辑解读，非引文",
    source: "https://zh.wikisource.org/wiki/背影",
    name: "用具体动作承载情感",
    instruction:
      "选择素材中真实存在的一个动作或物件，让感情从细节里出现，减少替读者解释情绪。",
    fits: "回忆、亲情、含蓄的个人叙述",
    avoid: "没有真实细节时不可补造；不适合必须先给结论的说明",
    example: "出门前，她把袋口又折了一次，说这样东西不会掉。",
    defaultStrength: "light",
  },
  {
    id: "plain-rhythm",
    author: "老舍",
    work: "济南的冬天",
    provenance: "作品书目参照；技巧归纳为编辑解读，非引文",
    source: "https://zh.wikisource.org/wiki/濟南的冬天",
    name: "自然口语与长短句交替",
    instruction:
      "沿用用户自己的常用词，长句交代关系，短句留下落点；朗读自然，不刻意模仿方言。",
    fits: "日常分享、口语叙述",
    avoid: "不能为了幽默改变事实或讽刺对象",
    example: "原想早点回去，走到楼下又停住了。灯还亮着。",
    defaultStrength: "light",
  },
  {
    id: "quiet-ending",
    author: "契诃夫",
    work: "带小狗的女人",
    provenance: "作品书目参照；技巧归纳为编辑解读，非引文",
    source: "https://www.gutenberg.org/ebooks/13415",
    name: "让结尾停在具体处境",
    instruction:
      "用输入中已有的动作、物件或未解决的问题收尾；允许未完成感，不补人生道理。",
    fits: "复杂感受、回忆、关系叙事",
    avoid: "明确要求行动步骤或结论的任务不使用留白",
    example: "杯子还放在桌边。我把它往里挪了一点。",
    defaultStrength: "light",
  },
  {
    id: "observed-contrast",
    author: "简·奥斯汀",
    work: "傲慢与偏见",
    provenance: "作品书目参照；技巧归纳为编辑解读，非引文",
    source: "https://www.gutenberg.org/ebooks/1342",
    name: "通过言行对照呈现轻微幽默",
    instruction:
      "仅在用户给出言行差异时并置两者，让反差自行成立；不新增讥讽、冲突或人物动机。",
    fits: "轻松叙述、已有反差的观察",
    avoid: "哀悼、严肃说明或原文没有反差时不使用",
    example: "他说只是顺路，手里的清单却写了整整一页。",
    defaultStrength: "light",
  },
] as const;
