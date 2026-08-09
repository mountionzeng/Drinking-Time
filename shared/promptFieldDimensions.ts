/**
 * 镜头字段 ↔ 提示词维度的映射，供任何需要读「镜头 old/new 对比」的地方共用
 * （目前：`evals/editSnapshotCorpus.ts` 的编辑率分析、`server/services/recurringEditSignal.ts`
 * 的重复修正检测）。单一事实来源——不要在第二处再抄一份，会跟这份表走岔。
 */

/**
 * 快照/编辑历史里的镜头字段是 camelCase（`styleRef`），服务端谱系维度键是 snake_case
 * （`style_reference`）。这份映射照抄 `promptLineageMigration.ts` 里
 * shared/dialogue/image/video 四组的字段→维度对应关系，保持单一事实来源的口径。
 * 不在映射表里的字段（如 `subject`/`action`/`mood`）本身就是维度键，原样返回。
 */
const FIELD_TO_DIMENSION: Record<string, string> = {
  timeLight: "time_light",
  styleRef: "style_reference",
  promptDraft: "image_prompt",
  negativePrompt: "negative_prompt",
  cameraMove: "camera_motion",
  videoPrompt: "video_prompt",
};

/**
 * 「真的是提示词维度」的白名单——不是「镜头上能编辑的字段」。
 *
 * `shared/shotDirector.ts` 的 `STORY_SHOT_EDITABLE_FIELDS` 有 30+ 个可编辑字段，
 * 但其中 `characterReference`/`wardrobeReference`/`hairReference`/`sceneReference`/
 * `textureReference`/`generationModel`/`generationParams` 是参考图绑定和出图配置，
 * 从来不会被编译进最终提示词文本，不算这里要追踪的「创作内容维度」。
 *
 * 这份白名单 = `promptLineageMigration.ts` 的字段→维度映射（服务端真实编译用的）
 * ∪ `client/.../promptTable/buildPromptTable.ts` 的 `CONTENT_DIMENSIONS`/`VIDEO_DIMENSIONS`
 * （客户端提示词表用的，键名口径不同）。两处都不认的字段，就不是提示词维度。
 */
const KNOWN_DIMENSION_FIELDS = new Set([
  // 服务端 shared 维度（scope: shot, modality: shared）
  "sceneTitle",
  "sceneArtBrief",
  "subject",
  "action",
  "intent",
  "rationale",
  "location",
  "timeLight",
  "mood",
  "styleRef",
  "beat",
  // 服务端 dialogue/image/video 维度
  "dialogue",
  "promptDraft",
  "negativePrompt",
  "cameraMove",
  "videoPrompt",
  "sound",
  // 只在客户端 buildPromptTable 里加权、服务端 shared 权重表里还没有的维度——
  // 属于真实提示词维度，只是两边覆盖范围不同步（见 weightTableSync.test.ts）。
  "shotType",
  "cameraAngle",
  "videoStart",
  "videoEnd",
  "transitionIn",
  "transitionOut",
]);

export function dimensionForField(field: string): string {
  return FIELD_TO_DIMENSION[field] ?? field;
}

export function isPromptDimensionField(field: string): boolean {
  return KNOWN_DIMENSION_FIELDS.has(field);
}
