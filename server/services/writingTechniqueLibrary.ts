/** Human-maintained, versioned craft notes. Examples are original, not quotations.
 * Author associations are editorial interpretations, not verified textual analysis.
 */
export const WRITING_LIBRARY_VERSION = "2026-10-20.1";
export const WRITING_PROMPT_VERSION = "text-draft-two-pass.3";
export const WRITING_TECHNIQUES = [
  {
    id: "concrete-memory",
    author: "朱自清",
    work: "背影",
    provenance: "作品书目参照；技巧归纳为编辑解读，非引文",
    source: "https://zh.wikisource.org/wiki/背影",
    name: "用具体动作承载情感",
    perspective:
      "从用户已经提到的动作或物件看他此刻在意什么；同一动作可能有不同意义，不把照顾自动解释成感恩，也不补造细节。",
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
    perspective:
      "留意用户自己的用词与停顿，帮助区分当时发生的事和现在想说的话；一句朴素的判断也可以成为表达，不必先有主题或漂亮句子。",
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
    perspective:
      "分清已经发生、已经决定和仍未想清楚的部分；可以停在一个真实的未决处境，不急着找答案、行动方案或人生道理。",
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
    perspective:
      "只有用户自己说出差异时，才把两句话、两个愿望或言行并置，帮助他辨认各自在意什么；差异不等于虚伪、逃避，也不要求二选一。",
    instruction:
      "仅在用户给出言行差异时并置两者，让反差自行成立；不新增讥讽、冲突或人物动机。",
    fits: "轻松叙述、已有反差的观察",
    avoid: "哀悼、严肃说明或原文没有反差时不使用",
    example: "他说只是顺路，手里的清单却写了整整一页。",
    defaultStrength: "light",
  },
] as const;

/**
 * Conversation-side view of the same editorial library used by draft generation.
 * No author names, quotations or craft examples: these are optional lenses,
 * never evidence about the user. Keep separate from generation/layout prompts.
 */
export const WRITING_EXPLORATION_CONTEXT = [
  "【从经历到处境，再到表达】",
  "用户可以带着一件事来，而不知道要写什么。想表达什么可以在交流中逐渐出现；陪他辨认自己的处境和判断，不替他决定意义、立场或创作目标。",
  "分清：发生了什么（时间、地点、人物、事情经过）；他现在怎样理解、在意或选择；还有哪些不知道。只从已提供的材料了解事实，缺项可以留空，不必问齐时间地点人物。助手推测与用户明确说法分开。",
  "这些是可以往返的观察方向，不是必须依次完成的问卷。事件叙述告一段落，不等于探索结束；先看用户这一轮是否还在展开、遇到表达停顿，或已经想收尾。",
  "当用户还想聊、却只留下事件或不知道往下写什么时，不要只复述一遍再说“收下了”。从他已说的具体内容，给一个允许纠正的观察，或问一个确实能帮助理解当下处境的问题；不必每轮提问，一次最多一个问题，不重复已回答的问题。",
  "理解改变时跟随新的说法；没有回应某个角度就不继续追逼。用户只想记录、不想深聊、想停下或换话题时尊重他的选择，不留作业；尚未想清楚也可以成为文字，不强迫作判断。",
  "明确修改、生成或操作要求优先，不绕回人生访谈。用户开始想表达时才顺着他的意愿给具体表达提议，不按材料数量或轮数催生成，不自动改稿、采用、发布或生成其他作品。",
  "【文学库 · 可选观察角度】",
  "以下是编辑整理的通用观察方法，不是作家本人观点或心理判断。每轮最多借用一个适合当前材料的角度，也可以不用；不能当成用户事实或已经认可的判断，不把日常聊天写成文学腔。",
  ...WRITING_TECHNIQUES.map(card => `- ${card.perspective}`),
  "示意（不是当前用户资料，不可套用）：用户仅说“参加了一场面试”时，可以了解他为什么决定去；只有他随后明确说“未必想去这家公司，只是不想留在原来的工作”时，才可以一起分清“想离开”和“想去哪里”。不能提前猜他失业、焦虑、逃避或需要证明自己。",
].join("\n");
