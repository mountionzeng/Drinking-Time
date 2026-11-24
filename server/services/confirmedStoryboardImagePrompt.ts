import { stripExplicitScreenText } from "../../shared/bookScreenText";
import { confirmedShotScene, shotSceneFacts } from "../../shared/shotSceneDirection";
import { SCENE_OBJECT_DIRECTION, STILL_EDGE_INTEGRATION } from "../../shared/sceneObjectDirection";
import { artSystemPrompt } from "../../shared/artSystem";
import { activeArtSystemRecipe } from "../../shared/artSystem";
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}
function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
/** Project a still frame, leaving spoken words and transitions in the source script. */
export function stillVisualDescription(value: string): string {
  return stripExplicitScreenText(value)
    .replace(/(?:画外音(?:继续)?|旁白(?:继续)?|对白|台词|声音建议|音效|配乐|voice[- ]?over|narration|dialogue|sound)(?:[（(][^）)\n]{0,30}[）)])?\s*[：:]\s*(?:「[^」\n]*」|“[^”\n]*”|"[^"\n]*"|『[^』\n]*』|[^\n]*?(?=(?:画面|visuals?)\s*[：:]|\n|$))/giu, "")
    .replace(/[,，]?\s*(?:与|和)[^，。；\n]{1,40}(?:叠化|交叉淡化)/gu, "")
    .replace(/(?:图片要求(?:（最高优先级）)?|画面动作|画面描述|开场画面|结束画面|画面|visuals?)[：:]/giu, "")
    .replace(/【[^】]+】/gu, "").replace(/\s+/gu, " ").trim();
}

/** With a confirmed recipe and no images, feed MJ visual prose, not the
 * editorial document (headings and prohibitions can become printed artwork). */
export function unreferencedArtFramePrompt(input: {
  body: Record<string, unknown>;
  shot: Record<string, unknown> | undefined;
  instruction?: string;
}): string | null {
  const recipe = activeArtSystemRecipe(input.body);
  if (!recipe?.system || !input.shot) return null;
  const scene = stillVisualDescription(text(input.instruction) || text(input.shot.promptDraft));
  if (!scene) return null;
  return [
    shotSceneFacts(input.body, input.shot),
    recipe.system.englishPrompt,
    (!confirmedShotScene(input.body, input.shot) || input.instruction) && scene,
    ...[!confirmedShotScene(input.body, input.shot) && input.shot.subject, input.shot.location, input.shot.timeLight, input.shot.colorPalette, input.shot.materialTexture]
      .map(value => stillVisualDescription(text(value))).filter(value => value && !scene.includes(value)),
    // There is no selected content image on this path. Instructions about its
    // unseen objects can otherwise introduce exactly the objects they forbid.
    ...[...recipe.system.objectRules, ...recipe.system.continuityRules]
      .filter(rule => !/(?:基准|参考)(?:图|图片)|所选人物|未显示|当前镜头需要/u.test(rule)),
    "One continuous illustration filling the entire canvas edge to edge. Plain unmarked surfaces.",
    SCENE_OBJECT_DIRECTION,
    STILL_EDGE_INTEGRATION,
  ].filter(Boolean).join(" ");
}

/** Adopted storyboard requirements already describe the picture. Do not ask a
 * second director to invent a setting, lighting or medium for the same shot. */
export function confirmedStoryboardImagePrompt(input: {
  body: Record<string, unknown>;
  shot: Record<string, unknown> | undefined;
  title: string;
  instruction?: string;
}): string | null {
  const shot = input.shot;
  const provenance = record(shot?.publishingVideo);
  const systemPrompt = artSystemPrompt(input.body);
  if (!shot) return null;
  const staging = shotSceneFacts(input.body, shot);
  const confirmed = confirmedShotScene(input.body, shot);
  if (!staging && !systemPrompt && (!text(provenance.groupId) || !text(provenance.draftShotId))) return null;
  const requirement = stripExplicitScreenText(text(input.instruction) || text(shot.promptDraft));
  if (!requirement && !staging) return null;
  const shots = Array.isArray(input.body.shots) ? input.body.shots.map(record) : [];
  const index = shots.findIndex(s => s.stableShotId === shot.stableShotId && s.shotNo === shot.shotNo);
  const records = Array.isArray(input.body.bookVideoRecords) ? input.body.bookVideoRecords.map(record) : [];
  const source = records.find(r => r.status === "adopted" &&
    `publishing-group-${r.versionId}-${record(r.preview).previewId}` === provenance.groupId);
  const brief = record(source?.brief);
  const direction = [brief.purpose, brief.audience, brief.tone].map(text).filter(Boolean).join("；");
  const style = text(shot.styleRef) === "故事级封面风格参考（如有）" ? "" : text(shot.styleRef);
  const visualFacts = [!confirmed && shot.subject, !confirmed && shot.action, shot.location, shot.timeLight, shot.mood, style, shot.colorPalette, shot.materialTexture]
    .map(value => stripExplicitScreenText(text(value))).filter(Boolean).join("；");
  const adjacent = [index > 0 ? shots[index - 1] : undefined, index >= 0 ? shots[index + 1] : undefined]
    .filter((s): s is Record<string, unknown> => Boolean(s))
    .map(s => `镜头 ${s.shotNo}：${[s.subject, s.action].map(value => stripExplicitScreenText(text(value))).filter(Boolean).join("；").slice(0, 250)}`);
  const interfaceShot = /界面|对话框|网页|应用屏幕|\b(?:interface|UI|webpage|app screen)\b/i.test([requirement, visualFacts].join(" "));
  return [
    staging,
    (!confirmed || input.instruction) && `【本镜画面】${requirement}`,
    visualFacts ? `【画面事实】${visualFacts}` : "",
    systemPrompt,
    `【影片】${input.title}${direction ? `；${direction}` : ""}`,
    interfaceShot ? "Render the interface artwork itself, retaining its shapes and blank lettering areas. Preserve only the surroundings specified for this shot." : "",
    !confirmed && adjacent.length ? `【衔接背景，不绘制相邻镜头】${adjacent.join("；")}` : "",
    "完整单幅电影画面，按当前镜头表现主体、动作和场景，沿用本片已确认的媒介、线条、材质与色调。文字由独立文字轨叠加。",
    SCENE_OBJECT_DIRECTION,
    STILL_EDGE_INTEGRATION,
    "Single full-bleed frame; no annotation board, reference sheet, collage, borders, labels or lettering.",
  ].filter(Boolean).join("\n");
}

/** A reviewed composer draft is authoritative. Retain style, never hidden shot facts or adjacent scenes. */
export function composedStoryboardImagePrompt(body: Record<string, unknown>, instruction: string): string {
  const recipe = activeArtSystemRecipe(body);
  return [
    stillVisualDescription(instruction),
    SCENE_OBJECT_DIRECTION,
    STILL_EDGE_INTEGRATION,
    recipe?.system?.englishPrompt || artSystemPrompt(body),
    "One continuous full-bleed illustration. Follow the supplied description for subjects, action and composition. Use references only for the requested elements. Plain unmarked surfaces; captions are added separately.",
  ].filter(Boolean).join("\n");
}
