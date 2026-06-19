import { invokeAgent } from "../_core/agentChannel";
import { parseJsonLoose } from "../_core/llmJson";
import {
  sceneAnalysisSchema,
  type SceneAnalysis,
} from "../../shared/sceneAnalysis";

type ChatTurn = { role: "user" | "assistant"; content: string };

type SceneAnalysisInvoker = (messages: Array<{
  role: "system" | "user" | "assistant";
  content: string;
}>) => Promise<unknown>;

export type AnalyzeSceneInput = {
  history?: ChatTurn[];
  cardHint?: string;
  story?: { title?: string | null; body?: unknown } | null;
  invoker?: SceneAnalysisInvoker;
};

function buildSystemPrompt(): string {
  return [
    "你是画面分析器，只返回 JSON，不写解释。",
    "任务：从最近对话、选中卡片和故事上下文中判断“这一刻应该画什么”。",
    "输出必须符合这个 TypeScript 形状：",
    "{",
    '  "subjectDescription": "画面主体，一句话",',
    '  "isPerson": true,',
    '  "recurringCharacter": {"key":"稳定角色标识","name":"可选名字"} 或 null,',
    '  "action": "动作或状态",',
    '  "emotion": "情绪",',
    '  "keyElements": ["关键物件/场景/光线"],',
    '  "needsCharacterAnchor": true,',
    '  "confidence": 0 | 25 | 50 | 75 | 100',
    "}",
    "判定规则：",
    "- needsCharacterAnchor 只有在主体是反复出镜的具体人物时才为 true。",
    "- 环境、物件、空镜、一次性路人都不需要人物锚点。",
    "- 内容模糊或人物是否固定不确定时，confidence 用 25 或 50。",
    "- 不要为了画面好看凭空造人物。",
  ].join("\n");
}

function summarizeInput(input: AnalyzeSceneInput): string {
  const history = (input.history ?? [])
    .filter(turn => turn.content.trim())
    .slice(-16)
    .map(turn => `${turn.role}: ${turn.content.trim()}`)
    .join("\n");

  return [
    `选中卡片: ${input.cardHint?.trim() || "（无）"}`,
    `故事标题: ${input.story?.title?.trim() || "（无）"}`,
    "最近对话:",
    history || "（无）",
  ].join("\n");
}

function parseAnalysisPayload(raw: unknown): SceneAnalysis {
  const candidate =
    typeof raw === "string"
      ? parseJsonLoose<unknown>(raw)
      : raw;
  const parsed = sceneAnalysisSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new Error(`SceneAnalysis schema mismatch: ${parsed.error.message}`);
  }
  return parsed.data;
}

async function defaultInvoker(messages: Array<{
  role: "system" | "user" | "assistant";
  content: string;
}>): Promise<unknown> {
  const { text } = await invokeAgent(messages, 700);
  return text;
}

export async function analyzeScene(input: AnalyzeSceneInput): Promise<SceneAnalysis> {
  const invoker = input.invoker ?? defaultInvoker;
  const raw = await invoker([
    { role: "system", content: buildSystemPrompt() },
    { role: "user", content: summarizeInput(input) },
  ]);
  return parseAnalysisPayload(raw);
}

