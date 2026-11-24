import { activeArtSystemRecipe, artSystemPrompt } from "../../shared/artSystem";
import { artRecipePrompt } from "../../shared/artDirection";
import { readBookWorkflow } from "../../shared/bookWorkflow";
import type { PreviewArtBasis } from "../../shared/artPreview";
import type { StoryMaterialState } from "../../shared/storyMaterial";
import { normalizePublishingDraftState } from "../../shared/publishingDraft";
import { resolvePublishingStoryboardCoverSource } from "./publishingStoryboardCoverSource";
import { extractPublishingCoverArtDirection } from "./publishingCoverArtDirection";
import { creationRecord as record } from "../repositories/textSourceLineage";

const text = (v: unknown) => typeof v === "string" ? v.trim() : "";
const rows = (v: unknown) => Array.isArray(v) ? v.map(record) : [];

export function previewArtBasis(body: Record<string, unknown>, material: StoryMaterialState, title: string): PreviewArtBasis {
  const recipe = activeArtSystemRecipe(body);
  const groupIds = new Set(rows(body.shots).map(s => record(s.publishingVideo).groupId).filter(Boolean));
  const video = rows(body.bookVideoRecords).find(r => r.status === "adopted" && groupIds.size === 1 &&
    groupIds.has(`publishing-group-${r.versionId}-${record(r.preview).previewId}`));
  const manuscriptId = record(video?.manuscriptSource).id;
  const manuscript = manuscriptId ? readBookWorkflow(body.bookWorkflow).versions.find(v => v.id === manuscriptId) : undefined;
  const keys = [...new Set(manuscript?.chapters.map(chapter => chapter.blocks.coverKey).filter((key): key is string => !!key))];
  const publishing = resolvePublishingStoryboardCoverSource(normalizePublishingDraftState(body.publishing));
  const available = (material.warehouseImages ?? []).filter(i => i.availability !== "missing" && i.status !== "rejected");
  const manuscriptCover = keys.length === 1 && available.find(i => i.imageKey === keys[0] || i.imageUrl === keys[0] || (
    /^chapters\/\d+\/[a-f0-9]{64}\.(?:jpg|png|webp)$/.test(keys[0]) &&
    i.imageUrl === `/api/wechat-import/media/${keys[0].split("/").at(-1)}`));
  const cover = manuscriptCover || available.find(i => i.id === publishing.cover?.assetId);
  const brief = record(video?.brief);
  const filmBrief = [brief.purpose, brief.audience, brief.platform, brief.tone, brief.duration, brief.narration, brief.music]
    .map(text).filter(v => v && v !== "待确认").join("；");
  const source = [title, manuscript && `${manuscript.kind === "storyboard" ? "分镜稿" : "文字稿"} V${manuscript.number}`,
    video?.videoVersion && `视频 V${video.videoVersion}`].filter(Boolean).join(" · ");
  const coverRules = extractPublishingCoverArtDirection(cover?.prompt);
  return {
    source, filmBrief, coverImageId: cover?.id ?? null,
    coverNote: cover ? `${manuscriptCover ? "书稿封面" : "已采用的出版封面"} #${cover.id}` :
      keys.length > 1 ? "源稿含多张章节封面" : keys.length || publishing.cover ? "源稿封面尚未关联可用图片" : "",
    styleName: recipe?.system ? `${recipe.system.name} V${recipe.version}` : "",
    rules: [artRecipePrompt(recipe), ...(recipe?.system?.continuityRules ?? [])].filter(Boolean).join("\n") || coverRules || artSystemPrompt(body),
    direction: [artSystemPrompt(body), coverRules].filter(Boolean).join("\n"),
  };
}
