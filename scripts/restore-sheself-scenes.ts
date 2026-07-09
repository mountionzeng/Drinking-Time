import { getStoryById, updateStory } from "../server/db";
import {
  getStoryRevision,
  prepareStoryBody,
} from "../server/services/storySync";
import { migrateStoryPromptLineage } from "../server/services/promptLineageMigration";

const USER_ID = Number(process.env.SEED_USER_ID ?? 48);
const STORY_ID = Number(process.env.SEED_TARGET_STORY_ID ?? 1159);
const SOURCE_STORY_ID = Number(process.env.SEED_SOURCE_STORY_ID ?? 1158);
const SOURCE_STORY_TITLE =
  process.env.SEED_SOURCE_STORY_TITLE ?? "根基｜2分35秒提示词工程版";

const scenes = [
  {
    sceneNo: "SC01",
    title: "第一幕：规训与自我改造",
    artBrief:
      "冷白黑暗画廊、白布与皮肤、被观看的身体、压迫性留白、规训感和脆弱感",
    shotStart: 1,
    shotEnd: 7,
  },
  {
    sceneNo: "SC02",
    title: "第二幕：虚无标准与被吞没",
    artBrief:
      "古典剧场与审判空间、镜面和框架、空洞标准、可被观看和判断的身体、冷白与暗红",
    shotStart: 8,
    shotEnd: 13,
  },
  {
    sceneNo: "SC03",
    title: "第三幕：向下走入身体和泥土",
    artBrief:
      "泥土、根系、身体内部、地下空间、低饱和绿色和褐色、从窒息转向扎根",
    shotStart: 14,
    shotEnd: 20,
  },
  {
    sceneNo: "SC04",
    title: "第四幕：落地生根与自我托举",
    artBrief:
      "森林、根系托举、自然光、生息、柔和绿色与金色、自行生长而非被允许",
    shotStart: 21,
    shotEnd: 24,
  },
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function shotLabel(shotNo: number): string {
  return `SH${String(shotNo).padStart(2, "0")}`;
}

function sceneForShot(shotNo: number) {
  return (
    scenes.find(scene => shotNo >= scene.shotStart && shotNo <= scene.shotEnd) ??
    scenes[0]
  );
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function main() {
  const story = await getStoryById(STORY_ID, USER_ID);
  if (!story) {
    throw new Error(`找不到 SheSelf 故事：${STORY_ID}`);
  }

  const body = { ...asRecord(story.body) };
  body.scenes = scenes.map(scene => ({
    sceneNo: scene.sceneNo,
    title: scene.title,
    artBrief: scene.artBrief,
    shotRange: `${shotLabel(scene.shotStart)}-${shotLabel(scene.shotEnd)}`,
    sourceStoryId: SOURCE_STORY_ID,
    sourceStoryTitle: SOURCE_STORY_TITLE,
  }));
  body.materialReusePolicy =
    "继承根基故事的稳定镜头 ID；视频 take 通过稳定 ID 复用；图片按稳定 ID 优先、SH 编号兜底复制当前根基图。";
  body.sourceStoryId = SOURCE_STORY_ID;
  body.sourceStoryTitle = SOURCE_STORY_TITLE;
  body.shots = (Array.isArray(body.shots) ? body.shots : []).map(
    (rawShot, index) => {
      const shot = asRecord(rawShot);
      const shotNo =
        typeof shot.shotNo === "number" && Number.isFinite(shot.shotNo)
          ? shot.shotNo
          : index + 1;
      const scene = sceneForShot(shotNo);
      const existingPrompt = text(shot.promptDraft);
      const promptDraft = existingPrompt.includes("场景美术库")
        ? existingPrompt
        : [
            `场次：${scene.sceneNo} · ${scene.title}`,
            `场景美术库：${scene.artBrief}`,
            text(shot.dialogue) ? `台词/旁白：${text(shot.dialogue)}` : "",
            text(shot.action) ? `画面动作：${text(shot.action)}` : "",
            "不要把台词渲染成画面里的字幕、标语或 UI 文字。",
          ]
            .filter(Boolean)
            .join("\n");

      return {
        ...shot,
        sceneNo: scene.sceneNo,
        sceneTitle: scene.title,
        sceneArtBrief: scene.artBrief,
        sourceCardContent: text(shot.sourceCardContent) || scene.title,
        promptDraft,
      };
    }
  );

  const nextBody = prepareStoryBody(
    body,
    getStoryRevision(story.body) + 1,
    story.body
  );
  await updateStory(STORY_ID, USER_ID, { body: nextBody });
  await migrateStoryPromptLineage({
    storyId: STORY_ID,
    userId: USER_ID,
    body: {
      ...nextBody,
      title: story.title,
      theme: story.theme,
      arc: story.arc,
    },
    source: "initial",
  });

  const updated = await getStoryById(STORY_ID, USER_ID);
  const updatedBody = asRecord(updated?.body);
  const shots = Array.isArray(updatedBody.shots) ? updatedBody.shots : [];
  const first = asRecord(shots[0]);
  const last = asRecord(shots[23]);
  console.log(
    JSON.stringify(
      {
        storyId: STORY_ID,
        sceneCount: Array.isArray(updatedBody.scenes)
          ? updatedBody.scenes.length
          : 0,
        first: {
          sceneNo: first.sceneNo,
          sceneTitle: first.sceneTitle,
        },
        last: {
          sceneNo: last.sceneNo,
          sceneTitle: last.sceneTitle,
        },
        revision: updatedBody._revision,
      },
      null,
      2
    )
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
