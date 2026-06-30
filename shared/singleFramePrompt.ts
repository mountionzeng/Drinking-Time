const MULTI_FRAME_INTENT_PATTERNS = [
  /拼接/gi,
  /拼贴/gi,
  /多镜头/gi,
  /多个镜头/gi,
  /几个镜头/gi,
  /多画面/gi,
  /多帧/gi,
  /分屏/gi,
  /四宫格/gi,
  /九宫格/gi,
  /连环画/gi,
  /漫画分格/gi,
  /\bcollage\b/gi,
  /\bcontact sheet\b/gi,
  /\bstoryboard grid\b/gi,
  /\bmulti[-\s]?shot\b/gi,
  /\bmulti[-\s]?frame\b/gi,
  /\bmulti[-\s]?panel\b/gi,
  /\bmultiple panels\b/gi,
  /\bfour[-\s]?panel\b/gi,
  /\bside[-\s]?by[-\s]?side\b/gi,
  /\bbefore[-\s]?and[-\s]?after\b/gi,
  /\bdiptych\b/gi,
  /\btriptych\b/gi,
  /\bquadriptych\b/gi,
  /\bsplit[-\s]?screen\b/gi,
];

const NEGATING_PREFIX_PATTERN =
  /\b(no|not|avoid|without|never|do not|don't|dont)\b|不要|禁止|避免|不是|不能|无/i;
const MIDJOURNEY_PARAM_PATTERN = /\s--[a-z][a-z0-9-]*(?:\s|$)/i;

export const SINGLE_FRAME_PROMPT_CONSTRAINT =
  'Single-frame rule: compose one uninterrupted cinematic camera frame only, a single continuous shot frame, not a storyboard sheet. Show one moment from one camera angle; no collage, no contact sheet, no inset thumbnails, no split-screen, no side-by-side layout, no storyboard grid, no comic panel, no poster board, no multiple moments in one image.';

export const SINGLE_FRAME_HARD_CONSTRAINT =
  `${SINGLE_FRAME_PROMPT_CONSTRAINT} No captions, no readable text, no UI, no watermark. No black borders, no letterbox, no frame borders, no decorative frame. Absolutely no text of any language.`;

export const SINGLE_FRAME_NEGATIVE_TERMS = [
  'collage',
  'contactsheet',
  'splitscreen',
  'panels',
  'insets',
  'thumbnails',
  'grid',
  'storyboard',
  'comic',
  'frames',
  'poster',
  'watermark',
];

function hasNegatingPrefix(value: string, index: number): boolean {
  const prefix = value.slice(Math.max(0, index - 48), index);
  return NEGATING_PREFIX_PATTERN.test(prefix);
}

export function allowsMultiFrameComposition(prompt: string): boolean {
  const normalized = prompt.replace(/\s+/g, ' ');
  for (const pattern of MULTI_FRAME_INTENT_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(normalized))) {
      if (!hasNegatingPrefix(normalized, match.index)) return true;
    }
  }
  return false;
}

export function withSingleFramePromptConstraint(prompt: string): string {
  const cleanPrompt = prompt.trim();
  if (
    !cleanPrompt ||
    cleanPrompt.includes('Single-frame rule:') ||
    allowsMultiFrameComposition(cleanPrompt)
  ) {
    return cleanPrompt;
  }
  const paramMatch = MIDJOURNEY_PARAM_PATTERN.exec(cleanPrompt);
  if (!paramMatch) {
    return `${cleanPrompt}\n${SINGLE_FRAME_PROMPT_CONSTRAINT}`;
  }

  const promptBody = cleanPrompt.slice(0, paramMatch.index).trim();
  const promptParams = cleanPrompt.slice(paramMatch.index).trim();
  if (!promptBody) {
    return `${SINGLE_FRAME_PROMPT_CONSTRAINT} ${promptParams}`;
  }
  return `${promptBody}\n${SINGLE_FRAME_PROMPT_CONSTRAINT} ${promptParams}`;
}

export function singleFrameNegativeTermsForPrompt(prompt: string): string[] {
  return allowsMultiFrameComposition(prompt) ? [] : [...SINGLE_FRAME_NEGATIVE_TERMS];
}
