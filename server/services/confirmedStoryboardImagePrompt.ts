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
  const requirement = text(input.instruction) || text(shot.promptDraft);
  if (!requirement) return null;
  const shots = Array.isArray(input.body.shots) ? input.body.shots.map(record) : [];
  const index = shots.findIndex(s => s.stableShotId === shot.stableShotId && s.shotNo === shot.shotNo);
  const records = Array.isArray(input.body.bookVideoRecords) ? input.body.bookVideoRecords.map(record) : [];
  const source = records.find(r => r.status === "adopted" &&
    `publishing-group-${r.versionId}-${record(r.preview).previewId}` === provenance.groupId);
  const brief = record(source?.brief);
  const direction = [brief.purpose, brief.audience, brief.tone].map(text).filter(Boolean).join("；");
  const style = text(shot.styleRef) === "故事级封面风格参考（如有）" ? "" : text(shot.styleRef);
  const visualFacts = [shot.subject, shot.action, shot.location, shot.timeLight, shot.mood, style]
    .map(text).filter(Boolean).join("；");
  const adjacent = [index > 0 ? shots[index - 1] : undefined, index >= 0 ? shots[index + 1] : undefined]
    .filter((s): s is Record<string, unknown> => Boolean(s))
    .map(s => `镜头 ${s.shotNo}：${[s.subject, s.action].map(text).filter(Boolean).join("；").slice(0, 250)}`);
  return [
    "Render only the subjects explicitly required below, in the specified medium. Match the supplied reference's corresponding object shapes, linework, materials and palette. Do not introduce people or environments that the shot does not require.",
    "Render the interface artwork itself when an interface is requested, preserving its graphic shapes and blank lettering areas. Keep any surroundings explicitly described by the author, including abstract worlds. Only show a physical device, room, billboard or person when explicitly requested; do not invent those as a way to display the interface.",
    `【当前已确认影片】${input.title}${direction ? `；${direction}` : ""}`,
    systemPrompt,
    `【本镜要求】${requirement}`,
    visualFacts ? `【本镜画面事实】${visualFacts}` : "",
    "按本镜要求制作一张静态画面。保留明确的主体、场景、媒介、界面布局与配色；未指定的细节保持克制，不自行改为另一种环境或摄影风格。界面就是界面，不把它改造成实体房间或其他场景。",
    adjacent.length ? `【前后文，仅帮助理解衔接，不搬用其他镜头的画面内容】\n${adjacent.join("\n")}` : "",
    "本次只制作画面底图。原稿的屏幕文字、台词及字幕保留在影片文字轨；图内对应位置留白，不生成乱码，不因为无字要求删除界面或改变场景。",
    "One still image, one composition, one moment. No collage or multiple panels. Keep lettering areas empty: all captions and readable words are added separately, never painted into this image.",
  ].filter(Boolean).join("\n");
}
