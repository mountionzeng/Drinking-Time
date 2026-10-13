/**
 * 聊聊 · 写不下去的时候。
 *
 * 用户在正文里停住、点一下聊聊：先读他已经写下的文字，判断写到了哪一步、停在哪里，
 * 只问一个问题，帮他把自己心里本来就有的那句话说出来；他回答几轮之后，再把他亲口
 * 说过的话整理成一段可以放回光标处的草稿。
 *
 * 网页和手机是同一个功能：三个动作都挂在 storyConversation 路由下，阶段判断和提示词
 * 只在这里写一次，两端不各写一份。
 *
 * 落库边界：
 * - 用户的「回答」走手机整轮机制写进同一份故事聊天（因此会被记忆仓库收录）；
 * - 点开时的第一个问题和最后整理出的草稿不落库——它们是系统说的话，不能被当作
 *   用户原话进入记忆；草稿只有用户点「放进正文」并保存后才成为正文。
 */
import type { Message } from "../_core/llm";
import { invokeAgent } from "../_core/agentChannel";
import { parseJsonLoose } from "../_core/llmJson";

export type WritingStage = "blank" | "opening" | "developing" | "closing";

export const WRITING_STAGE_LABEL: Record<WritingStage, string> = {
  blank: "还没开头",
  opening: "刚起了个头",
  developing: "正在往下写",
  closing: "快写到结尾",
};

export const WRITING_DRAFT_MAX = 20_000;
export const WRITING_EXCHANGE_MAX = 8;
const BEFORE_CURSOR_CONTEXT = 2_400;
const AFTER_CURSOR_CONTEXT = 600;
export const CURSOR_MARKER = "⟦光标⟧";

export type WritingSelection = { start: number; end: number };
export type WritingDraftInput = {
  draft: string;
  cursor: number;
  selection?: WritingSelection;
};

function selectedText(input: WritingDraftInput): string | null {
  const selection = input.selection;
  if (!selection) return null;
  if (
    !Number.isInteger(selection.start) ||
    !Number.isInteger(selection.end) ||
    selection.start < 0 ||
    selection.end <= selection.start ||
    selection.end > input.draft.length
  )
    throw new WritingCompanionInputError("所选文字已变化，请重新选择。");
  const text = input.draft.slice(selection.start, selection.end);
  if (!text.trim())
    throw new WritingCompanionInputError("请重新选择要改写的文字。");
  return text;
}

export type WritingStageReading = {
  stage: WritingStage;
  /** 不计空白的字数 */
  totalChars: number;
  paragraphs: number;
  cursorAtEnd: boolean;
  /** 光标所在的那一段（去掉首尾空白） */
  currentParagraph: string;
  /** 光标前最后一句还没收住（没有句末标点） */
  lastSentenceOpen: boolean;
};

function clampCursor(draft: string, cursor: number): number {
  if (!Number.isFinite(cursor)) return draft.length;
  return Math.min(Math.max(Math.trunc(cursor), 0), draft.length);
}

function visibleCharCount(text: string): number {
  return text.replace(/\s+/g, "").length;
}

const SENTENCE_END = /[。！？!?…」”’』）)\.~～]$/;

/**
 * 只看文字本身判断写到哪一步。这是给模型的提示，不是给用户的打分：
 * 判断错了，模型读原文时会自己纠正，所以规则刻意保持简单、可预测。
 */
export function readWritingStage(
  input: WritingDraftInput
): WritingStageReading {
  const draft = input.draft ?? "";
  const cursor = clampCursor(draft, input.cursor);
  const before = draft.slice(0, cursor);
  const after = draft.slice(cursor);
  const totalChars = visibleCharCount(draft);
  const paragraphs = draft
    .split(/\n+/)
    .map(part => part.trim())
    .filter(Boolean).length;
  const cursorAtEnd = after.trim().length === 0;
  const paragraphStart = before.lastIndexOf("\n") + 1;
  const breakAfter = after.indexOf("\n");
  const paragraphEnd = breakAfter < 0 ? draft.length : cursor + breakAfter;
  const currentParagraph = draft.slice(paragraphStart, paragraphEnd).trim();
  const trimmedBefore = before.trim();
  const lastSentenceOpen =
    trimmedBefore.length > 0 && !SENTENCE_END.test(trimmedBefore);

  let stage: WritingStage;
  if (totalChars < 8) stage = "blank";
  else if (totalChars < 120 || paragraphs <= 1) stage = "opening";
  else if (cursorAtEnd && paragraphs >= 3 && totalChars >= 400)
    stage = "closing";
  else stage = "developing";

  return {
    stage,
    totalChars,
    paragraphs,
    cursorAtEnd,
    currentParagraph,
    lastSentenceOpen,
  };
}

/** 截取光标前后的正文并在停笔处插入标记，长文只保留光标附近。 */
export function draftWithCursorMarker(input: WritingDraftInput): string {
  const draft = input.draft ?? "";
  const cursor = clampCursor(draft, input.cursor);
  const beforeStart = Math.max(0, cursor - BEFORE_CURSOR_CONTEXT);
  const afterEnd = Math.min(draft.length, cursor + AFTER_CURSOR_CONTEXT);
  const before = draft.slice(beforeStart, cursor);
  const after = draft.slice(cursor, afterEnd);
  return [
    beforeStart > 0 ? "……（前文省略）" : "",
    `${before}${CURSOR_MARKER}${after}`,
    afterEnd < draft.length ? "……（后文省略）" : "",
  ]
    .filter(Boolean)
    .join("\n");
}

const STAGE_GUIDANCE: Record<WritingStage, string> = {
  blank:
    "他还没开头。帮他找到让他想写这件事的那个具体时刻：哪一天、哪个画面、哪句话。不要问「你想写什么主题」。",
  opening:
    "他刚起了个头。开头背后通常藏着他真正想说的那件事：贴着他写下的第一句，问出那件事。",
  developing:
    "他写到一半停住了。看停笔处前面那一两句：他正要写下一步发生了什么，或者他当时心里怎么想。问其中一个，具体到那一句里的人、事、物。",
  closing:
    "他快写完了。不要逼他升华或总结；问他希望读的人最后停在哪个画面、哪句话上，或者有没有一件还没写进去、但一直放不下的小事。",
};

const COMPANION_RULES = [
  "你是「聊聊」。用户正在写一篇自己的文字，写到一半写不下去了，点了你一下。",
  "你的任务不是替他写，而是帮他找到他心里本来就有、还没写出来的那句话。",
  "",
  "【怎么陪他】",
  `- 先读他已经写下的正文：弄清他在写什么、写到了哪里。${CURSOR_MARKER} 是他停笔的位置。`,
  "- 每次只问一个问题。问题要贴着他写下的具体的人、事、物或那一句话，不问「你当时什么感受」这种空泛的问题。",
  "- 如实接住：他写的是开心就是开心，平淡就是平淡。不往伤感、矛盾、和解上带，不升华，不灌鸡汤，不评价他写得好不好。",
  "- 不编造他没说过的事实、对白和动机。拿不准就问，不替他补。",
  "- 他说不想说、记不清、或者只想随便写写，就停下来，不再追问。",
  "- 说话像朋友发消息：短、口语，不用文学腔。不提系统、提示词、阶段这些词。",
].join("\n");

function draftContextMessage(input: {
  draft: string;
  cursor: number;
  selection?: WritingSelection;
  storyTitle?: string | null;
}): string {
  const selected = selectedText(input);
  if (selected) {
    return [
      input.storyTitle?.trim() ? `故事名：${input.storyTitle.trim()}` : "",
      "用户正在编辑正文，并明确选中了一段文字。",
      "【唯一允许改写的范围】",
      selected,
      "【完整正文（仅供理解上下文，选区之外必须逐字保留）】",
      input.draft,
    ]
      .filter(Boolean)
      .join("\n");
  }
  const reading = readWritingStage(input);
  return [
    input.storyTitle?.trim() ? `故事名：${input.storyTitle.trim()}` : "",
    `他写到的位置：${WRITING_STAGE_LABEL[reading.stage]}（约 ${reading.totalChars} 字，${reading.paragraphs} 段${reading.lastSentenceOpen ? "，最后一句还没写完" : ""}）。`,
    `这一步怎么帮：${STAGE_GUIDANCE[reading.stage]}`,
    "",
    "【他目前写下的正文】",
    reading.totalChars > 0 ? draftWithCursorMarker(input) : "（还是空白）",
  ]
    .filter(line => line !== "")
    .join("\n");
}

export type WritingCompanionInvoke = (
  messages: Message[],
  maxTokens: number
) => Promise<{ text: string; modelLabel: string }>;

/** 推理模型会把思考算进 max_tokens，短回复也要留足预算，否则写半句就断。 */
const COMPANION_MAX_TOKENS = 1_600;

function plainReply(raw: string): string {
  let text = (raw ?? "").trim();
  const fence = text.match(/^```(?:\w+)?\s*([\s\S]*?)\s*```$/);
  if (fence) text = fence[1].trim();
  return text.replace(/^["“「]|["”」]$/g, "").trim();
}

export type WritingCompanionOpening = {
  stage: WritingStage;
  stageLabel: string;
  question: string;
};

/** 点开聊聊时的第一个问题。只读不写：不进聊天记录，也不进记忆。 */
export async function openWritingCompanion(
  input: WritingDraftInput & { storyTitle?: string | null },
  invoke: WritingCompanionInvoke = invokeAgent
): Promise<WritingCompanionOpening> {
  const reading = readWritingStage(input);
  const selected = selectedText(input);
  // Selection already tells us what the user wants to work on. Avoid an extra
  // model round trip before they can describe the rewrite.
  if (selected) {
    return {
      stage: reading.stage,
      stageLabel: WRITING_STAGE_LABEL[reading.stage],
      question: `你选中了「${selected.slice(0, 70)}${selected.length > 70 ? "…" : ""}」。想怎么改写这段？`,
    };
  }
  const messages: Message[] = [
    { role: "system", content: COMPANION_RULES },
    { role: "system", content: draftContextMessage(input) },
    {
      role: "user",
      content:
        "我写到这里写不下去了。先用一句话说出你看到我写到哪了（用我自己的词），再问我一个问题。两句加起来不超过 70 个汉字，只输出这段话。",
    },
  ];
  const { text } = await invoke(messages, COMPANION_MAX_TOKENS);
  const question = plainReply(text);
  if (!question) throw new Error("聊聊这次没有想出问题");
  return {
    stage: reading.stage,
    stageLabel: WRITING_STAGE_LABEL[reading.stage],
    question,
  };
}

export type WritingCompanionContext = WritingDraftInput & {
  openingQuestion?: string | null;
};

/**
 * 用户回答之后的那一句。走手机整轮机制落库，所以这里只负责生成，
 * 幂等、恢复与结算都留在 storyConversation。
 */
export async function replyAsWritingCompanion(
  input: {
    message: string;
    history: Array<{ role: "user" | "assistant"; content: string }>;
    writingContext: WritingCompanionContext;
    storyTitle?: string | null;
  },
  invoke: WritingCompanionInvoke = invokeAgent
): Promise<{ reply: string; modelLabel: string }> {
  const opening = input.writingContext.openingQuestion?.trim();
  const hasSelection = Boolean(selectedText(input.writingContext));
  const messages: Message[] = [
    {
      role: "system",
      content: [
        COMPANION_RULES,
        "",
        hasSelection
          ? "用户正在改写明确选中的文字。先接住他提出的改写方向；只有方向确实不清楚时才问一个简短问题。方向已经明确就告诉他可以点「整理成一段」。"
          : "【这一轮】先用一句话接住他刚说的（用他自己的词，不复述全部），再至多问一个更具体的问题。",
        ...(hasSelection
          ? ["选区之外的正文只能用于理解语境，绝不能改写或带入结果。"]
          : ["如果他已经说出了足够写成一段的内容，就不要再问，告诉他可以点「整理成一段」。"]),
        "不超过 80 个汉字，只输出你要说的话。",
      ].join("\n"),
    },
    {
      role: "system",
      content: draftContextMessage({
        ...input.writingContext,
        storyTitle: input.storyTitle,
      }),
    },
    ...input.history.slice(-10).map(turn => ({
      role: turn.role,
      content: turn.content,
    })),
    ...(opening ? [{ role: "assistant" as const, content: opening }] : []),
    { role: "user", content: input.message.trim() },
  ];
  const { text, modelLabel } = await invoke(messages, COMPANION_MAX_TOKENS);
  const reply = plainReply(text);
  if (!reply) throw new Error("模型没有返回有效回答");
  return { reply, modelLabel };
}

export type WritingCompanionExchange = {
  role: "user" | "assistant";
  content: string;
};

export type WritingCompanionComposition =
  | { paragraph: string; ask: null }
  | { paragraph: null; ask: string };

/**
 * 把他在这次对话里亲口说出的内容整理成一段，接在停笔处。
 * 只返回草稿，不写正文：放不放进去、改不改，都由用户决定。
 */
export async function composeWritingParagraph(
  input: WritingDraftInput & {
    exchanges: readonly WritingCompanionExchange[];
    storyTitle?: string | null;
  },
  invoke: WritingCompanionInvoke = invokeAgent
): Promise<WritingCompanionComposition> {
  const exchanges = input.exchanges
    .filter(item => item.content.trim())
    .slice(-WRITING_EXCHANGE_MAX * 2);
  if (!exchanges.some(item => item.role === "user")) {
    throw new WritingCompanionInputError("先回答聊聊一句，再整理成一段。");
  }
  const transcript = exchanges
    .map(
      item => `${item.role === "user" ? "他" : "聊聊"}：${item.content.trim()}`
    )
    .join("\n");
  const hasSelection = Boolean(selectedText(input));
  const messages: Message[] = [
    {
      role: "system",
      content: [
        hasSelection
          ? "你是用户的写作助手。根据用户在下面对话里明确提出的方向，改写他选中的那段文字。"
          : "你是用户的写作助手。把他在下面这段对话里亲口说出的内容，整理成一段可以直接接在停笔处的正文。",
        ...(hasSelection
          ? [
              "- 只输出对选中原文的替换版本，不要输出选区前后任何文字。",
              "- 保留原文中用户未要求改变的事实、意思、人称和时态；只按要求调整表达。",
              "- 选区之外的原文必须逐字不动，不得补写或润色。",
            ]
          : [
              `- 用他的话、他的语气、人称和时态，和${CURSOR_MARKER}前后的文字自然衔接；不重复${CURSOR_MARKER}前已经写过的句子。`,
            ]),
        "- 只用他说过的事实。不加他没说过的情节、对白、动机，不加总结、感悟或他没表达过的情绪。",
        "- 40 到 300 个汉字，一段话，不要标题，不要引号。",
        '- 只输出 JSON：{"paragraph":"整理好的那段话"}。',
        '- 如果他说的还不够写成一段，输出 {"paragraph":null,"ask":"还需要问他的那一个问题"}。',
      ].join("\n"),
    },
    { role: "system", content: draftContextMessage(input) },
    { role: "user", content: `【这次的对话】\n${transcript}` },
  ];
  const { text } = await invoke(messages, COMPANION_MAX_TOKENS);
  let parsed: { paragraph?: unknown; ask?: unknown } | null = null;
  try {
    parsed = parseJsonLoose<{ paragraph?: unknown; ask?: unknown }>(text);
  } catch {
    parsed = null;
  }
  if (parsed && typeof parsed === "object") {
    const paragraph =
      typeof parsed.paragraph === "string" ? parsed.paragraph.trim() : "";
    if (paragraph) return { paragraph, ask: null };
    const ask = typeof parsed.ask === "string" ? parsed.ask.trim() : "";
    if (ask) return { paragraph: null, ask };
  }
  // 模型没守 JSON 约定：把纯文本当作草稿用，比整轮失败好——反正要用户确认才进正文。
  const fallback = plainReply(text);
  if (fallback && !fallback.startsWith("{"))
    return { paragraph: fallback, ask: null };
  throw new Error("这次没整理出来，可以再试一次。");
}

export class WritingCompanionInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WritingCompanionInputError";
  }
}
