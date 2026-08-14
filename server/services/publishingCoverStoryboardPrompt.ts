import { invokeAgent } from "../_core/agentChannel";

export const PUBLISHING_COVER_PAINTING_SUFFIX =
  "Handcrafted tempera and gouache painting, visible paper grain and brush marks, one continuous vertical scene, quiet empty space near the top, plain unmarked surfaces throughout.";

const COVER_PROMPT_COMPILER_SYSTEM =
  "Compile the supplied Chinese art brief into ONE English visual prompt describing a single vertical painted scene. Keep the confirmed story facts: who is present, how they relate, the setting, and what is happening. HIGHEST PRIORITY: the 【用户持续要求】 block is the user's own binding art direction — carry EVERY concrete detail in it through literally (subject gender, age, hair, clothing, season, palette, light, mood), even when compressing. Appearance the source text never states is NOT a story fact; it is the user's to decide, so never soften or drop such a direction on the grounds that it might alter the story — obey it. If a direction says the two people are women, both figures are unambiguously women. Losing one of these details is a failure; sacrifice background description instead. Drop only section headers, policy sentences, and rules — describe what is visibly in the picture. Write purely affirmative description: state what IS there, never what is absent, forbidden or avoided. This is a standalone painting, NOT a cover, poster, magazine, layout or publication — never use those words. Never write the words text, letters, words, writing, title, headline, sign, label, logo, watermark, signature, book, newspaper, screen, or clock, not even to forbid them, and never describe any surface that would carry writing. Do not quote or transliterate source words. Output English only, one paragraph, under 140 words.";

export async function compilePublishingCoverStoryboardPrompt(input: {
  prompt: string;
  provider: string | undefined;
}): Promise<string> {
  if (input.provider === "gpt-image") return input.prompt.trim();

  const compiled = await invokeAgent(
    [
      { role: "system", content: COVER_PROMPT_COMPILER_SYSTEM },
      { role: "user", content: input.prompt },
    ],
    400
  );
  const text = compiled.text.trim();
  if (!text) {
    throw new Error(
      "正式封面美术提示词编译失败，本次未提交图片生成，以免回退成写实画面。"
    );
  }
  return `${text} ${PUBLISHING_COVER_PAINTING_SUFFIX}`;
}
