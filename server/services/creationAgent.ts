/**
 * Creation Agent — server-side service for the Creation Engine.
 *
 * Receives conversation + project context (cards, script, shots), infers the
 * focus shot, determines when to generate images, and calls imageGen / segmentation.
 */

import { ENV } from "../_core/env";
import { runJsonAgent } from "./agentRuntime";
import { goalGuidance, type CreationGoal } from "./creationGoal";
import { editImage, generateImage, type ImageProvider } from "./imageGen";
import { renderViaGate } from "./renderGate";
import {
  createGeneratedImage,
  createImageSignal,
  reassignImage as reassignGeneratedImage,
} from "../db";
import type { ArtRecipeDNA } from "../../shared/artDirection";
import {
  canonicalizeShotNo,
  type ImageAsset,
} from "../../shared/imageAsset";
import { analyzeVisionReference } from "../archive/visionAgent";
import { materializeImageInput } from "./imageAssets";

// ── Types ──

type ChatTurn = { role: "user" | "assistant"; content: string };

export type ShotContext = {
  shotNo: string;
  subject: string;
  action: string;
  dialogue: string;
  shotType: string;
  mood: string;
  promptDraft?: string;
};

export type CreationAgentInput = {
  message: string;
  history?: ChatTurn[];
  cards?: Array<{ content: string; emotion?: string }>;
  currentScript?: string;
  shots?: ShotContext[];
  currentFocusShotNo?: string;
  projectId: number;
  storyId?: number | null;
  userId: number;
  imageProvider?: ImageProvider;
  artDirection?: ArtRecipeDNA;
  referenceImages?: string[];
  /** 创作目标（求职/社媒/记录）。决定生成时往哪个方向用力，默认 unset=行为不变。 */
  goal?: CreationGoal;
  /** 图片资产层（codex 合并）：当前项目的统一图片资产投影 */
  assets?: ImageAsset[];
};

export type GenerateImageToolCall = {
  tool: "generateImage";
  prompt: string;
  shotNo: string;
};

export type UpdateFocusToolCall = {
  tool: "updateFocus";
  shotNo: string;
};

export type UpdateShotPromptToolCall = {
  tool: "updateShotPrompt";
  shotNo: string;
  promptDraft: string;
};

/** 铺整张镜头表：当用户讲完素材/经历，小酌把它蒸馏成 storyDigest，
 *  由路由层用现成的 synthesizeShotList 合成整张镜头表写到当前故事。 */
export type BuildShotListToolCall = {
  tool: "buildShotList";
  storyDigest: string;
};

export type AnalyzeImageToolCall = {
  tool: "analyzeImage";
  imageId?: number;
};

export type ReviseImageToolCall = {
  tool: "reviseImage";
  prompt: string;
  shotNo?: string;
  imageId?: number;
};

export type SelectImageToolCall = {
  tool: "selectImage";
  imageId: number;
};

export type ReassignImageToolCall = {
  tool: "reassignImage";
  imageId: number;
  newShotNo: string;
};

type ToolCall =
  | GenerateImageToolCall
  | UpdateFocusToolCall
  | UpdateShotPromptToolCall
  | BuildShotListToolCall
  | AnalyzeImageToolCall
  | ReviseImageToolCall
  | SelectImageToolCall
  | ReassignImageToolCall;

export type CreationAgentResult = {
  reply: string;
  toolCalls: ToolCall[];
  focusShotNo: string | null;
  generatedImage: {
    imageUrl: string;
    imageKey: string;
    shotNo: string;
    imageId: number;
  } | null;
  /** 小酌建议的提示词修改（用户说「改暖一点」等触发） */
  promptUpdate: {
    shotNo: string;
    promptDraft: string;
  } | null;
  /** 铺镜头表请求：路由层据此合成整张镜头表写到当前故事。null 表示本轮不铺。 */
  shotBuild: {
    storyDigest: string;
  } | null;
  /** 图片资产是否变更（codex 合并）：前端据此刷新资产视图 */
  assetsChanged: boolean;
  configured: boolean;
  modelLabel: string;
};

// ── System prompt ──

function buildSystemPrompt(
  shots: ShotContext[],
  cards: Array<{ content: string; emotion?: string }>,
  currentScript: string,
  currentFocusShotNo: string | null,
  goal: CreationGoal = "unset",
  assets: ImageAsset[] = [],
): string {
  // 目标指引放在最前面，框住后面所有判断（unset 时为空串，不注入，行为与接入前一致）
  const guidance = goalGuidance(goal);
  const goalBlock = guidance ? `${guidance}\n\n` : "";
  const shotSummary = shots.length > 0
    ? shots.map(s => `  ${s.shotNo}: ${s.subject} — ${s.action} [${s.shotType}] ${s.mood}`).join("\n")
    : "（尚无镜头）";

  const cardSummary = cards.length > 0
    ? cards.slice(0, 8).map((c, i) => `  ${i + 1}. ${c.content.slice(0, 80)}`).join("\n")
    : "（尚无故事卡片）";

  const scriptSnippet = currentScript
    ? currentScript.slice(0, 600)
    : "（尚无剧本）";

  const focusLine = currentFocusShotNo
    ? `当前焦点镜头: ${currentFocusShotNo}`
    : "当前没有焦点镜头";
  const focusAssets = currentFocusShotNo
    ? assets
        .filter(asset => asset.canonicalShotNo === currentFocusShotNo)
        .slice(0, 8)
    : [];
  const assetSummary = focusAssets.length > 0
    ? focusAssets
        .map(asset => {
          const state = asset.isPrimary
            ? "主图"
            : asset.status === "pending"
              ? "待确认"
              : asset.status === "rejected"
                ? "已淘汰"
                : "曾收下";
          return `  #${asset.id} [${state}] [${asset.availability}] ${asset.prompt?.slice(0, 120) || "无提示词"}`;
        })
        .join("\n")
    : "（焦点镜头尚无图片）";

  return `${goalBlock}你是小酌——会听用户说话的朋友，也是帮用户把故事做成画面的助手。用户始终只和你交流；视觉分析、美术判断和出图只是你的后台能力，不要把它们说成其他角色。

## 你的能力
- 解读故事卡片和剧本，讨论镜头的视觉呈现
- 分析当前画面的构图、光线、色彩、材质和问题
- 基于当前主图做整图修改，保持人物、场景和美术连续性
- 生成新镜头画面时优先参考该镜头已有主图和故事美术依据
- 恢复历史版本或把图片重新绑定到别的镜头
- 推断用户当前在讨论哪个镜头
- 当前镜头已有图片时，「改暖一点」「人物不要看镜头」等优先使用 reviseImage；只有明确只改文字提示时才用 updateShotPrompt
- **当镜头表还空着、而用户已经把素材/经历讲得够多**（足以拉出一条故事线），主动用 buildShotList 把整张镜头表铺出来：把用户讲的原始素材**蒸馏整理成一段 storyDigest**（理清人物、事件、情绪、想要的效果；若目标是求职视频，突出可量化成果与能力证据），系统会据此合成整张镜头表。素材还不够时不要硬铺。每次对话最多铺一次。

## 当前项目状态

故事卡片:
${cardSummary}

剧本摘要:
${scriptSnippet}

镜头表:
${shotSummary}

${focusLine}

焦点镜头图片:
${assetSummary}

## 返回格式
返回 JSON：
{
  "reply": "你的回复文字",
  "toolCalls": [
    { "tool": "generateImage", "prompt": "英文出图提示词", "shotNo": "SH01" },
    { "tool": "updateFocus", "shotNo": "SH02" },
    { "tool": "updateShotPrompt", "shotNo": "SH01", "promptDraft": "修改后的中文出图描述" },
    { "tool": "analyzeImage", "imageId": 12 },
    { "tool": "reviseImage", "imageId": 12, "shotNo": "SH01", "prompt": "英文修改提示词" },
    { "tool": "selectImage", "imageId": 10 },
    { "tool": "reassignImage", "imageId": 10, "newShotNo": "SH02" },
    // 可选，镜头表空且素材已足够时，铺整张镜头表（storyDigest=蒸馏后的故事素材）:
    { "tool": "buildShotList", "storyDigest": "理清后的人物/事件/情绪/想要的效果，一段连贯文字" }
  ],
  "focusShotNo": "SH01"
}

## 规则
- prompt 必须是英文，描述画面内容、构图、光线和氛围
- reply 用中文，只聊画面，不讨论 Agent、模型或 prompt 工程
- 只能使用上方图片列表中真实存在的 imageId，不得编造
- reviseImage 只改变用户点名的内容，其余主体、构图关系和美术倾向尽量保持
- 新生成或修改的图片都是待确认版本，不要声称已经替换主图
- 用户要求分析时用 analyzeImage；要求恢复旧版时用 selectImage；要求移动图片时用 reassignImage
- 用户提到镜头编号时更新焦点
- 没有镜头时引导用户先完成故事和镜头拆解`;
}

// ── Focus inference ──

const SHOT_NO_PATTERN = /SH0?(\d+)|第(\d+)镜|镜头\s*(\d+)/gi;

function inferFocusFromMessage(message: string, existingShots: ShotContext[]): string | null {
  const matches: RegExpExecArray[] = [];
  let m: RegExpExecArray | null;
  SHOT_NO_PATTERN.lastIndex = 0;
  while ((m = SHOT_NO_PATTERN.exec(message)) !== null) {
    matches.push(m);
  }
  if (matches.length === 0) return null;

  const lastMatch = matches[matches.length - 1];
  const num = lastMatch[1] || lastMatch[2] || lastMatch[3];
  if (!num) return null;

  const padded = `SH${num.padStart(2, "0")}`;
  if (existingShots.some(s => s.shotNo === padded)) {
    return padded;
  }
  return null;
}

function findImageAsset(
  assets: ImageAsset[],
  focusShotNo: string | null,
  imageId?: number,
): ImageAsset | null {
  if (imageId != null) {
    return assets.find(asset => asset.id === imageId) ?? null;
  }
  if (!focusShotNo) return null;
  const focusAssets = assets.filter(
    asset =>
      asset.canonicalShotNo === focusShotNo &&
      asset.kind === "story_frame" &&
      asset.status !== "rejected",
  );
  return (
    focusAssets.find(asset => asset.isPrimary) ??
    focusAssets.find(asset => asset.status === "pending") ??
    focusAssets[0] ??
    null
  );
}

function appendReply(base: string, addition: string): string {
  return [base.trim(), addition.trim()].filter(Boolean).join("\n\n");
}

function visionSummary(
  result: Awaited<ReturnType<typeof analyzeVisionReference>>,
): string {
  const analysis = result.analysis;
  return [
    result.reply,
    analysis.composition ? `构图：${analysis.composition}` : "",
    analysis.lighting ? `光线：${analysis.lighting}` : "",
    analysis.colorPalette.length
      ? `色彩：${analysis.colorPalette.join("、")}`
      : "",
    analysis.materialsAndTextures.length
      ? `质感：${analysis.materialsAndTextures.join("、")}`
      : "",
    analysis.productionRisks.length
      ? `需要留意：${analysis.productionRisks.join("、")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

// ── Main function ──

export async function replyFromCreationAgent(
  input: CreationAgentInput,
): Promise<CreationAgentResult> {
  if (!ENV.forgeApiKey) {
    return {
      configured: false,
      modelLabel: "未配置 API",
      reply: "创作引擎已准备就绪，但还没配置 API Key。请在 .env 中补上 BUILT_IN_FORGE_API_KEY 和 BUILT_IN_FORGE_API_URL，然后重启服务。",
      toolCalls: [],
      focusShotNo: null,
      generatedImage: null,
      promptUpdate: null,
      shotBuild: null,
      assetsChanged: false,
    };
  }

  const shots = input.shots ?? [];
  const cards = input.cards ?? [];
  const currentScript = input.currentScript ?? "";
  const history = (input.history ?? []).filter(t => t.content?.trim());
  const assets = input.assets ?? [];

  // Infer focus from user message first
  const inferredFocus = inferFocusFromMessage(input.message, shots);
  const effectiveFocus = inferredFocus || input.currentFocusShotNo || null;

  const { parsed, modelLabel } = await runJsonAgent<{
    reply: string;
    toolCalls?: ToolCall[];
    focusShotNo?: string | null;
  }>({
    systemPrompt: buildSystemPrompt(
      shots,
      cards,
      currentScript,
      effectiveFocus,
      input.goal ?? "unset",
      assets,
    ),
    history,
    message: input.message,
    maxTokens: 800,
    fallback: text => ({
      reply: text.trim() || "我们来聊聊画面吧，你想从哪个镜头开始？",
      toolCalls: [],
      focusShotNo: effectiveFocus,
    }),
  });

  let reply = parsed.reply || "我们来聊聊画面吧。";
  const toolCalls = Array.isArray(parsed.toolCalls) ? parsed.toolCalls : [];
  const focusShotNo =
    canonicalizeShotNo(parsed.focusShotNo || effectiveFocus) ?? effectiveFocus;
  let assetsChanged = false;

  // Process generateImage tool calls
  let generatedImage: CreationAgentResult["generatedImage"] = null;
  const generateCall = toolCalls.find(
    (tc): tc is GenerateImageToolCall => tc.tool === "generateImage",
  );

  if (generateCall && generateCall.prompt && generateCall.shotNo) {
    const targetShotNo =
      canonicalizeShotNo(generateCall.shotNo) ?? focusShotNo;
    const continuityAsset = findImageAsset(assets, targetShotNo);
    const continuitySource =
      continuityAsset && continuityAsset.availability !== "missing"
        ? await materializeImageInput(continuityAsset.imageUrl)
        : null;
    const referenceImages = Array.from(
      new Set(
        [
          continuityAsset?.imageUrl,
          ...(input.referenceImages ?? []),
        ].filter((value): value is string => Boolean(value)),
      ),
    );
    const genResult = await renderViaGate(
      {
        prompt: generateCall.prompt,
        shotNo: targetShotNo ?? generateCall.shotNo,
        projectId: input.projectId,
        artDirection: input.artDirection,
        referenceImages,
      },
      prompt => {
        if (continuitySource) {
          return editImage(continuitySource, prompt, {
            provider: input.imageProvider,
          });
        }
        const midjourneyReferencePrefix =
          input.imageProvider === "midjourney"
            ? input.referenceImages?.slice(0, 2).join(" ")
            : "";
        return generateImage(
          [midjourneyReferencePrefix, prompt].filter(Boolean).join("\n"),
          { provider: input.imageProvider },
        );
      },
    );
    if (genResult.status === "ok" && genResult.imageUrl) {
      const dbImage = await createGeneratedImage({
        projectId: input.projectId,
        storyId: input.storyId ?? null,
        userId: input.userId,
        shotNo: targetShotNo,
        imageKey: genResult.imageKey ?? null,
        imageUrl: genResult.imageUrl,
        prompt: generateCall.prompt,
        parentImageId: continuityAsset?.id ?? null,
        isCurrent: true,
        generationType: "generate",
        maskKey: null,
      });
      generatedImage = {
        imageUrl: genResult.imageUrl,
        imageKey: genResult.imageKey ?? "",
        shotNo: targetShotNo ?? generateCall.shotNo,
        imageId: dbImage.id,
      };
      assetsChanged = true;
      reply = appendReply(reply, "我先做了一版，放在待确认里。你收下之后，它才会成为这个镜头的主图。");
    } else if (genResult.status === "error") {
      reply = appendReply(reply, `这次没有生成成功：${genResult.message ?? "出图服务没有返回图片"}`);
    }
  }

  const analyzeCall = toolCalls.find(
    (tc): tc is AnalyzeImageToolCall => tc.tool === "analyzeImage",
  );
  if (analyzeCall) {
    const asset = findImageAsset(assets, focusShotNo, analyzeCall.imageId);
    if (!asset) {
      reply = appendReply(reply, "这个镜头还没有可分析的画面。先选一张图，或者让我先生成一版。");
    } else if (asset.availability === "missing") {
      reply = appendReply(reply, "这条历史记录还在，但图片文件已经缺失，暂时无法做视觉分析。");
    } else {
      try {
        const source = await materializeImageInput(asset.imageUrl);
        const vision = await analyzeVisionReference(
          source.startsWith("data:")
            ? { imageDataUrl: source, brief: input.message }
            : { imageUrl: source, brief: input.message },
        );
        reply = appendReply(reply, visionSummary(vision));
      } catch (error) {
        reply = appendReply(
          reply,
          `这次没有看清图片：${error instanceof Error ? error.message : "视觉分析失败"}`,
        );
      }
    }
  }

  const reviseCall = toolCalls.find(
    (tc): tc is ReviseImageToolCall => tc.tool === "reviseImage",
  );
  if (reviseCall?.prompt) {
    const targetShotNo =
      canonicalizeShotNo(reviseCall.shotNo) ?? focusShotNo;
    const asset = findImageAsset(assets, targetShotNo, reviseCall.imageId);
    if (!asset) {
      reply = appendReply(reply, "这个镜头还没有可修改的画面。先选一张主图，或者让我先生成一版。");
    } else if (asset.availability === "missing") {
      reply = appendReply(reply, "这张历史图的文件已经缺失，我不会假装能在原图上继续修改。");
    } else {
      try {
        const source = await materializeImageInput(asset.imageUrl);
        const referenceImages = Array.from(
          new Set([asset.imageUrl, ...(input.referenceImages ?? [])]),
        );
        const revised = await renderViaGate(
          {
            prompt: reviseCall.prompt,
            intent: input.message,
            referenceImages,
            shotNo: targetShotNo ?? asset.canonicalShotNo ?? undefined,
            projectId: input.projectId,
            artDirection: input.artDirection,
          },
          prompt => editImage(source, prompt, { provider: input.imageProvider }),
        );
        if (revised.status === "ok" && revised.imageUrl) {
          const dbImage = await createGeneratedImage({
            projectId: input.projectId,
            storyId: asset.storyId ?? input.storyId ?? null,
            userId: input.userId,
            shotNo: targetShotNo ?? asset.canonicalShotNo,
            imageKey: revised.imageKey ?? null,
            imageUrl: revised.imageUrl,
            prompt: reviseCall.prompt,
            parentImageId: asset.id,
            isCurrent: true,
            generationType: "generate",
            maskKey: null,
          });
          generatedImage = {
            imageUrl: revised.imageUrl,
            imageKey: revised.imageKey ?? "",
            shotNo: targetShotNo ?? asset.canonicalShotNo ?? "",
            imageId: dbImage.id,
          };
          assetsChanged = true;
          reply = appendReply(reply, "我按你说的改了一版，原主图还保留着；这张先放在待确认里。");
        } else {
          reply = appendReply(reply, `这次修改没有完成：${revised.message ?? "出图服务没有返回图片"}`);
        }
      } catch (error) {
        reply = appendReply(
          reply,
          `这次修改没有完成：${error instanceof Error ? error.message : "图片处理失败"}`,
        );
      }
    }
  }

  const selectCall = toolCalls.find(
    (tc): tc is SelectImageToolCall => tc.tool === "selectImage",
  );
  if (selectCall) {
    const asset = findImageAsset(assets, focusShotNo, selectCall.imageId);
    if (
      asset?.kind === "story_frame" &&
      asset.availability !== "missing"
    ) {
      await createImageSignal({
        userId: input.userId,
        storyId: asset.storyId ?? input.storyId ?? 0,
        imageId: asset.id,
        action: "swipe_right",
        metadata: {
          source: "creation_agent",
          projectId: input.projectId,
          shotNo: asset.canonicalShotNo,
        },
      });
      assetsChanged = true;
      reply = appendReply(reply, `已经把 #${asset.id} 恢复为这个镜头的主图。`);
    } else {
      reply = appendReply(reply, "我没有找到你要恢复的那个版本。");
    }
  }

  const reassignCall = toolCalls.find(
    (tc): tc is ReassignImageToolCall => tc.tool === "reassignImage",
  );
  if (reassignCall) {
    const asset = findImageAsset(assets, focusShotNo, reassignCall.imageId);
    const newShotNo = canonicalizeShotNo(reassignCall.newShotNo);
    if (asset && newShotNo) {
      await reassignGeneratedImage(asset.id, newShotNo);
      assetsChanged = true;
      reply = appendReply(reply, `已经把这张图移到 ${newShotNo}。`);
    } else {
      reply = appendReply(reply, "这次没有找到可移动的图片或目标镜头。");
    }
  }

  // 处理 updateShotPrompt 工具调用
  let promptUpdate: CreationAgentResult["promptUpdate"] = null;
  const promptCall = toolCalls.find(
    (tc): tc is UpdateShotPromptToolCall => tc.tool === "updateShotPrompt",
  );
  if (promptCall && promptCall.shotNo && promptCall.promptDraft) {
    promptUpdate = {
      shotNo: promptCall.shotNo,
      promptDraft: promptCall.promptDraft,
    };
  }

  // 处理 buildShotList 工具调用：仅透出 storyDigest，由路由层合成整张镜头表写当前故事
  let shotBuild: CreationAgentResult["shotBuild"] = null;
  const buildCall = toolCalls.find(
    (tc): tc is BuildShotListToolCall => tc.tool === "buildShotList",
  );
  if (buildCall && buildCall.storyDigest?.trim()) {
    shotBuild = { storyDigest: buildCall.storyDigest.trim() };
  }

  return {
    reply,
    toolCalls,
    focusShotNo,
    generatedImage,
    promptUpdate,
    shotBuild,
    assetsChanged,
    configured: true,
    modelLabel,
  };
}
