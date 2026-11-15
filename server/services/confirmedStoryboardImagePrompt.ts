import { stripExplicitScreenText } from "../../shared/bookScreenText";
import { artSystemPrompt } from "../../shared/artSystem";
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}
function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
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
  if (!shot || (!systemPrompt && (!text(provenance.groupId) || !text(provenance.draftShotId)))) return null;
  const requirement = stripExplicitScreenText(text(input.instruction) || text(shot.promptDraft));
  if (!requirement) return null;
  const shots = Array.isArray(input.body.shots) ? input.body.shots.map(record) : [];
  const index = shots.findIndex(s => s.stableShotId === shot.stableShotId && s.shotNo === shot.shotNo);
  const records = Array.isArray(input.body.bookVideoRecords) ? input.body.bookVideoRecords.map(record) : [];
  const source = records.find(r => r.status === "adopted" &&
    `publishing-group-${r.versionId}-${record(r.preview).previewId}` === provenance.groupId);
  const brief = record(source?.brief);
  const direction = [brief.purpose, brief.audience, brief.tone].map(text).filter(Boolean).join("；");
  const style = text(shot.styleRef) === "故事级封面风格参考（如有）" ? "" : text(shot.styleRef);
  const visualFacts = [shot.subject, shot.action, shot.location, shot.timeLight, shot.mood, style, shot.colorPalette, shot.materialTexture]
    .map(value => stripExplicitScreenText(text(value))).filter(Boolean).join("；");
  const adjacent = [index > 0 ? shots[index - 1] : undefined, index >= 0 ? shots[index + 1] : undefined]
    .filter((s): s is Record<string, unknown> => Boolean(s))
    .map(s => `镜头 ${s.shotNo}：${[s.subject, s.action].map(value => stripExplicitScreenText(text(value))).filter(Boolean).join("；").slice(0, 250)}`);
  const interfaceShot = /界面|对话框|网页|应用屏幕|\b(?:interface|UI|webpage|app screen)\b/i.test([requirement, visualFacts].join(" "));
  return [
    `【本镜画面】${requirement}`,
    visualFacts ? `【画面事实】${visualFacts}` : "",
    systemPrompt,
    `【影片】${input.title}${direction ? `；${direction}` : ""}`,
    interfaceShot ? "Render the interface artwork itself, retaining its shapes and blank lettering areas. Preserve only the surroundings specified for this shot." : "",
    adjacent.length ? `【衔接背景，不绘制相邻镜头】${adjacent.join("；")}` : "",
    "完整单幅电影画面，按当前镜头表现主体、动作和场景，沿用本片已确认的媒介、线条、材质与色调。文字由独立文字轨叠加。",
    "Single full-bleed frame; no annotation board, reference sheet, collage, borders, labels or lettering.",
  ].filter(Boolean).join("\n");
}
