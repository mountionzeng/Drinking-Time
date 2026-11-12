import { TRPCError } from "@trpc/server";
import { artSystemDraftSchema, type ArtSystemDraft } from "../../shared/artSystem";
import { normalizeStoryArtDirection, type StoryArtRecipe } from "../../shared/artDirection";
import { ownedCreationStory, creationFingerprint } from "../repositories/textSourceLineage";
import { getGeneratedImageById } from "../repositories/images";
import { prepareStoryBody } from "./storySync";
import { persistPreparedStoryBody, StoryBodyRevisionConflictError } from "./storyBodyPersistence";
import { runJsonAgent } from "./agentRuntime";

type Input = { storyId: number; userId: number; editorName: string; instruction: string; operationToken: string;
  action: "draft" | "confirm" | "copy"; referenceImageIds: number[]; imageId?: number; sourceStoryId?: number; expectedVersion: number; recipeVersion?: number };
export async function writeArtSystem(input: Input) {
  const { body, revision, story } = await ownedCreationStory(input);
  const direction = normalizeStoryArtDirection(body.artDirection);
  const receiptHash = creationFingerprint({ ...input, editorName: undefined });
  const receipts = body.artSystemReceipts && typeof body.artSystemReceipts === "object"
    ? body.artSystemReceipts as Record<string, { hash: string; version: number }> : {};
  const prior = receipts[input.operationToken];
  if (prior) {
    if (prior.hash !== receiptHash) throw new TRPCError({ code: "CONFLICT", message: "操作标识已被另一项修改使用" });
    return { direction, version: prior.version, revision, replayed: true };
  }
  if (Object.keys(receipts).length >= 500) throw new Error("美术体系版本记录已满");
  if ((direction.recipe?.version ?? 0) !== input.expectedVersion) throw new TRPCError({ code: "CONFLICT", message: "美术体系已更新，请重新载入后确认当前版本" });
  const referenceIds = [...new Set([...input.referenceImageIds, ...(input.imageId ? [input.imageId] : [])])];
  for (const id of referenceIds) {
    const image = await getGeneratedImageById(id);
    if (!image || image.storyId !== input.storyId || image.userId !== input.userId)
      throw new TRPCError({ code: "BAD_REQUEST", message: "参考图片不属于当前故事" });
  }
  let recipe: StoryArtRecipe;
  const version = Math.max(0, ...direction.recipeVersions.map(r => r.version), direction.recipe?.version ?? 0) + 1;
  const now = Date.now();
  if (input.action === "confirm") {
    const selected = input.recipeVersion ? direction.recipeVersions.find(r => r.version === input.recipeVersion) : direction.recipe;
    if (!selected?.system) throw new Error("没有找到要确认的美术体系版本，请先在对话里建立并查看版本");
    recipe = { ...selected, version, updatedAt: now, system: { ...selected.system,
      intent: input.instruction, editorId: input.userId, editorName: input.editorName, operationToken: input.operationToken,
      confirmedAt: now, ...(input.imageId ? { confirmedImageId: input.imageId } : {}),
      referenceImageIds: [...new Set([...selected.system.referenceImageIds, ...referenceIds])],
    } };
  } else if (input.action === "copy") {
    if (!input.sourceStoryId || input.sourceStoryId === input.storyId) throw new Error("请指定另一个自己的故事编号");
    const source = await ownedCreationStory({ storyId: input.sourceStoryId, userId: input.userId });
    const sourceDirection = normalizeStoryArtDirection(source.body.artDirection);
    const sourceRecipe = input.recipeVersion ? sourceDirection.recipeVersions.find(r => r.version === input.recipeVersion) : sourceDirection.recipe;
    if (!sourceRecipe?.system) throw new Error("该故事没有已保存的美术体系");
    const { confirmedImageId: _image, confirmedAt: _confirmed, ...system } = sourceRecipe.system;
    recipe = { ...sourceRecipe, version, updatedAt: now, sourceCandidateIds: [], system: { ...system,
      referenceImageIds: [], sourceStoryId: input.sourceStoryId, sourceVersion: sourceRecipe.version,
      intent: input.instruction, editorId: input.userId, editorName: input.editorName, operationToken: input.operationToken,
    } };
  } else {
    const result = await runJsonAgent<ArtSystemDraft>({
      systemPrompt: "你是美术体系整理师。把用户对话要求整理为可跨镜头复用的视觉规则，必须遵守最新要求，不固定任何风格、色板或媒介。不把抽象隐喻变成额外人物或真实场景。参考图片ID仅代表素材来源，你未实际看图时不得假装分析图片。已有体系保留未要求修改的规则。name 用简短的美术名称，不包含故事名、版本号或待确认等状态。各规则和英文提示词只描述视觉事实，不写待确认、保存仓库、生成流程等操作状态；具体色板未确定时该维度留空。输出JSON：name、style、palette、light、composition、material、negative、objectRules、motionRules、continuityRules（后九项为字符串数组），englishPrompt（一段简洁英文视觉规范，1800字符内）。不足的维度可为空，不虚构用户已经确认。体系决定呈现方式，故事决定内容。仅输出数据，不能输出代码或工具指令。",
      message: JSON.stringify({ storyTitle: story.title, existing: direction.recipe ?? null, instruction: input.instruction, referenceImageIds: referenceIds }),
      history: Array.isArray(body.messages) ? body.messages.slice(-16).flatMap(item => {
        if (!item || typeof item !== "object") return [];
        const message = item as Record<string, unknown>;
        return (message.role === "user" || message.role === "assistant") && typeof message.content === "string"
          ? [{ role: message.role, content: message.content.slice(0, 3000) }] : [];
      }) : [],
      maxTokens: 2400,
      fallback: () => { throw new Error("未能整理完整的美术体系，请稍后重试；原版本未变"); },
    });
    const parsed = artSystemDraftSchema.safeParse(result.parsed);
    if (!parsed.success) throw new Error("美术规则整理不完整，请补充或重试；原版本未变");
    const draft = parsed.data;
    recipe = { style: draft.style, palette: draft.palette, light: draft.light, composition: draft.composition,
      material: draft.material, negative: draft.negative, version, sourceCandidateIds: [], updatedAt: now,
      system: { name: draft.name, englishPrompt: draft.englishPrompt, objectRules: draft.objectRules,
        motionRules: draft.motionRules, continuityRules: draft.continuityRules,
        referenceImageIds: referenceIds.length ? referenceIds : direction.recipe?.system?.referenceImageIds ?? [],
        // Keep the selected baseline through textual refinements, without confirming the new rules.
        ...(direction.recipe?.system?.confirmedImageId ? { confirmedImageId: direction.recipe.system.confirmedImageId } : {}),
        intent: input.instruction, editorId: input.userId, editorName: input.editorName, operationToken: input.operationToken,
      } };
  }
  const history = direction.recipeVersions.some(r => r.version === direction.recipe?.version) || !direction.recipe
    ? direction.recipeVersions : [...direction.recipeVersions, direction.recipe];
  const nextDirection = { ...direction, phase: input.action === "confirm" ? "locked" as const : "recipe-review" as const,
    recipe, recipeVersions: [...history, recipe], updatedAt: now };
  // Inference may outlive an unrelated chat/autosave. Rebase only this owned
  // slice, without repeating inference or overwriting another art edit.
  const originalArt = creationFingerprint(body.artDirection ?? null);
  for (let attempt = 0; attempt < 5; attempt++) {
    const latest = await ownedCreationStory(input);
    const currentDirection = normalizeStoryArtDirection(latest.body.artDirection);
    const currentReceipts = latest.body.artSystemReceipts && typeof latest.body.artSystemReceipts === "object"
      ? latest.body.artSystemReceipts as Record<string, { hash: string; version: number }> : {};
    const completed = currentReceipts[input.operationToken];
    if (completed) {
      if (completed.hash !== receiptHash) throw new TRPCError({ code: "CONFLICT", message: "操作标识已被另一项修改使用" });
      return { direction: currentDirection, version: completed.version, revision: latest.revision, replayed: true };
    }
    if (creationFingerprint(latest.body.artDirection ?? null) !== originalArt) throw new TRPCError({ code: "CONFLICT", message: "美术体系已更新，请重新载入后确认当前版本" });
    const next = { ...latest.body, artDirection: nextDirection,
      artSystemReceipts: { ...currentReceipts, [input.operationToken]: { hash: receiptHash, version } } };
    try {
      await persistPreparedStoryBody({ ...input, expectedRevision: latest.revision,
        body: prepareStoryBody(next, latest.revision + 1, next) });
      return { direction: nextDirection, version, revision: latest.revision + 1, replayed: false };
    } catch (error) {
      if (!(error instanceof StoryBodyRevisionConflictError) || attempt === 4) throw error;
    }
  }
  throw new Error("保存繁忙，请重试；原美术版本保留");
}
