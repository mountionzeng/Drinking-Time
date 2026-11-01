export const ARTICLE_NATURES = {
  auto: "沿用聊天内容",
  factual: "真实经历",
  fiction: "虚构创作",
} as const;
export const ARTICLE_FORMS = {
  auto: "由内容决定",
  narrative: "叙事文章",
  essay: "散文随笔",
  diary: "日记",
  letter: "书信",
  social: "分享短文",
} as const;
export const ARTICLE_LENGTHS = {
  auto: "由内容决定",
  short: "短篇 · 约 300 字",
  medium: "中篇 · 约 800 字",
  long: "长篇 · 约 1500 字",
} as const;
export type ArticleGenerationOptions = {
  nature: keyof typeof ARTICLE_NATURES;
  form: keyof typeof ARTICLE_FORMS;
  length: keyof typeof ARTICLE_LENGTHS;
  requirements: string;
};
export const DEFAULT_ARTICLE_OPTIONS: ArticleGenerationOptions = {
  nature: "auto", form: "auto", length: "auto", requirements: "",
};
export function articleGenerationInstruction(options: ArticleGenerationOptions, chatInput: string): string {
  return [
    options.nature === "fiction" ? "内容性质：虚构创作，可以在现有素材基础上创作。" :
      options.nature === "factual" ? "内容性质：真实经历。只用用户提供的事实，不编造人物、事件或情绪。" :
        "内容性质沿用用户对话；未明确允许虚构时，不编造事实。",
    options.form !== "auto" ? `文章形式：${ARTICLE_FORMS[options.form]}。` : "优先沿用聊天中用户已明确的文章形式；未明确时，再根据素材选择。",
    options.length !== "auto" ? `篇幅：${ARTICLE_LENGTHS[options.length]}；事实不足时宁可短，不凑字数。` : "优先沿用聊天中用户已明确的篇幅；未明确时由素材决定，不凑字数。",
    "结合当前书稿（如有）和对话整理文稿，沿用用户已明确的受众、用途、语气和禁写范围；用户最新明确修正优先于旧稿与早期说法。助手建议或推测不作为用户事实或已认可偏好。不自动生成图片、排版或音乐。",
    options.requirements.trim() && `用户补充要求：${options.requirements.trim()}`,
    chatInput.trim() && `聊天输入框的补充：${chatInput.trim()}`,
  ].filter(Boolean).join("\n");
}
