import {
  createGeneratedImage,
  createStory,
  getStoryById,
  listUserStories,
  promoteStoryImageToCurrent,
  updateStoryTimeline,
} from "../server/db";
import { migrateStoryPromptLineage } from "../server/services/promptLineageMigration";
import { getStoryMaterialState } from "../server/services/storyMaterials";
import { DEFAULT_TIMELINE_TRANSFORM } from "../shared/storyMaterial";
import type { ImageAsset } from "../shared/imageAsset";

const USER_ID = Number(process.env.SEED_USER_ID ?? 48);
const PREFERRED_PROJECT_ID = Number(process.env.SEED_PROJECT_ID ?? 1129);
const PREFERRED_SOURCE_STORY_ID = Number(
  process.env.SEED_SOURCE_STORY_ID ?? 1158
);
const PREFERRED_IMAGE_STORY_ID = Number(process.env.SEED_IMAGE_STORY_ID ?? 49);

type SceneSeed = {
  sceneNo: string;
  title: string;
  artBrief: string;
  shotStart: number;
  shotEnd: number;
};

type SourceStory = NonNullable<Awaited<ReturnType<typeof getStoryById>>>;

type SourceShot = Record<string, unknown>;

type DialogueSeed = {
  text: string;
  subject: string;
  action: string;
  mood: string;
};

const scenes: SceneSeed[] = [
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

const dialogueSeeds: DialogueSeed[] = [
  {
    text: "我害怕所有的事情",
    subject: "SheSelf",
    action: "站在冷白空间中承认恐惧",
    mood: "紧绷、坦白、脆弱",
  },
  {
    text: "我会反反覆覆的被告知：",
    subject: "SheSelf 与不可见的声音",
    action: "被重复的规训话语包围",
    mood: "压迫、回声、迟疑",
  },
  {
    text: "我的一切都需要改造。",
    subject: "被审视的身体",
    action: "被置于改造和修正的标准下",
    mood: "冰冷、被动、失重",
  },
  {
    text: "而我总是改造的还是不够好。我需要反反覆覆的雕琢自己。",
    subject: "持续被雕琢的自我",
    action: "在自我修正中被消耗",
    mood: "疲惫、重复、疼痛",
  },
  {
    text: "每当我有任何疑虑",
    subject: "SheSelf 的疑虑",
    action: "短暂停下并看向内侧",
    mood: "不安、敏感、克制",
  },
  {
    text: "他们会第一时间教我千万不要‘神经紧张’，",
    subject: "规训者的声音",
    action: "把她的警觉命名为过度反应",
    mood: "讽刺、窒息、被压低",
  },
  {
    text: "追求肤浅就能‘达到极乐’",
    subject: "被诱导的自我",
    action: "看见虚假极乐被包装成出口",
    mood: "荒诞、冷淡、危险",
  },
  {
    text: "他们会用虚无的标准，把我吞掉。",
    subject: "虚无标准",
    action: "像空洞结构一样吞没她",
    mood: "巨大、空泛、吞噬",
  },
  {
    text: "他们要求我证明。",
    subject: "SheSelf",
    action: "被迫站到证明自己的位置",
    mood: "被审问、僵硬、孤立",
  },
  {
    text: "要求我解释。要求我把自己整理成",
    subject: "被整理的自我",
    action: "把复杂感受压扁成可解释材料",
    mood: "规整、紧张、分裂",
  },
  {
    text: "可以被观看、被判断、被通过的样子。",
    subject: "可被通过的外壳",
    action: "被摆放成等待审阅的形状",
    mood: "冷白、可疑、屈从",
  },
  {
    text: "可真相只能是我自己的感受",
    subject: "SheSelf 的感受",
    action: "从外部判断转回自己的身体",
    mood: "清醒、低声、坚定",
  },
  {
    text: "我的恐惧是因为：我看见了我自己。",
    subject: "SheSelf 与自己的倒影",
    action: "在恐惧里第一次认出自己",
    mood: "震动、清醒、近乎神圣",
  },
  {
    text: "他们希望把我塑造成一个比他们更低级的物种，成为他们的养料",
    subject: "被降级的身体",
    action: "看见自己被放进他者的等级秩序",
    mood: "愤怒、黑暗、沉重",
  },
  {
    text: "当我无处可逃的时候，",
    subject: "无处可逃的 SheSelf",
    action: "在封闭空间里寻找唯一方向",
    mood: "逼仄、悬停、临界",
  },
  {
    text: "我只能往下走。",
    subject: "向下的身体",
    action: "选择下沉而不是继续逃离",
    mood: "决绝、低频、内收",
  },
  {
    text: "走到身体里，走到泥土里。",
    subject: "身体与泥土",
    action: "穿过身体边界进入泥土和根系",
    mood: "潮湿、深处、安静",
  },
  {
    text: "走到那些没有被说出来的地方。",
    subject: "未被说出的地方",
    action: "靠近沉默、伤口和未命名经验",
    mood: "隐秘、低光、靠近",
  },
  {
    text: "在那里我看见，她们被放进别人的秩序里。",
    subject: "她们的残影",
    action: "看见前代女性被嵌入他者秩序",
    mood: "历史感、哀悼、互认",
  },
  {
    text: "但我们都不会消失。",
    subject: "SheSelf 与她们",
    action: "在地下深处保持存在",
    mood: "稳定、低声、韧性",
  },
  {
    text: "我们会在任何情况下落地生根。",
    subject: "根系中的我们",
    action: "从任何缝隙里长出根",
    mood: "生长、坚定、温暖",
  },
  {
    text: "森林就在那里。",
    subject: "森林",
    action: "静静显现为已经存在的庇护",
    mood: "开阔、安定、呼吸感",
  },
  {
    text: "我不需要被允许，才开始生长。",
    subject: "开始生长的 SheSelf",
    action: "越过许可机制，自行向上生长",
    mood: "自由、明亮、脱离审判",
  },
  {
    text: "天既赋予我们生息 我们就能托举自己到任何地方",
    subject: "被根系托举的 SheSelf",
    action: "由森林和身体的根系托举到更高处",
    mood: "升起、完整、庄严",
  },
];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function sceneForShot(shotNo: number): SceneSeed {
  return (
    scenes.find(scene => shotNo >= scene.shotStart && shotNo <= scene.shotEnd) ??
    scenes[0]
  );
}

function shotLabel(shotNo: number): string {
  return `SH${String(shotNo).padStart(2, "0")}`;
}

function estimateDurationMs(line: string): number {
  const chars = Array.from(line.replace(/[\s，。！？：；、‘’“”']/g, "")).length;
  const shortPauses = (line.match(/[，、]/g) ?? []).length * 240;
  const longPauses = (line.match(/[。！？：；]/g) ?? []).length * 420;
  const quotedPause = (line.match(/[‘’“”']/g) ?? []).length * 120;
  const raw = 900 + chars * 185 + shortPauses + longPauses + quotedPause;
  return Math.round(Math.min(7600, Math.max(1800, raw)) / 100) * 100;
}

function sourceShots(story: SourceStory): SourceShot[] {
  const body = asRecord(story.body);
  return Array.isArray(body.shots)
    ? body.shots.filter(
        (shot): shot is SourceShot =>
          Boolean(shot && typeof shot === "object" && !Array.isArray(shot))
      )
    : [];
}

async function findSourceStory(): Promise<SourceStory> {
  const preferred = await getStoryById(PREFERRED_SOURCE_STORY_ID, USER_ID);
  if (preferred && sourceShots(preferred).length >= dialogueSeeds.length) {
    return preferred;
  }
  const stories = await listUserStories(USER_ID);
  for (const story of stories) {
    if (!story.title.includes("根基")) continue;
    const full = await getStoryById(story.id, USER_ID);
    if (full && sourceShots(full).length >= dialogueSeeds.length) return full;
  }
  throw new Error("没有找到可继承 24 个镜头稳定 ID 的「根基」故事");
}

async function findImageStory(): Promise<SourceStory | null> {
  const preferred = await getStoryById(PREFERRED_IMAGE_STORY_ID, USER_ID);
  if (preferred) return preferred;
  const stories = await listUserStories(USER_ID);
  for (const story of stories) {
    if (!story.title.includes("根基")) continue;
    const materials = await getStoryMaterialState(story.id, USER_ID);
    if (materials?.shots.some(shot => shot.currentImage)) {
      return (await getStoryById(story.id, USER_ID)) ?? null;
    }
  }
  return null;
}

function buildShots(rootStory: SourceStory) {
  const rootShots = sourceShots(rootStory);
  return dialogueSeeds.map((seed, index) => {
    const shotNo = index + 1;
    const scene = sceneForShot(shotNo);
    const source = rootShots[index] ?? {};
    const stableShotId =
      text(source.stableShotId) ||
      text(source.shotIdentity) ||
      `sheself-${shotLabel(shotNo).toLowerCase()}-shot`;
    const sourceStyle = text(source.styleRef);
    const durationMs = estimateDurationMs(seed.text);

    return {
      ...clone(source),
      stableShotId,
      shotIdentity: stableShotId,
      shotNo,
      sceneNo: scene.sceneNo,
      sceneTitle: scene.title,
      sceneArtBrief: scene.artBrief,
      subject: seed.subject,
      action: seed.action,
      dialogue: seed.text,
      durationMs,
      durationSec: Math.round(durationMs / 100) / 10,
      shotType: text(source.shotType) || "电影感单镜",
      beat: `${scene.title} / ${shotLabel(shotNo)}`,
      cameraAngle: text(source.cameraAngle) || "平视到轻微仰视",
      cameraMove:
        shotNo <= 7
          ? "缓慢推进，保留压迫性静止"
          : shotNo <= 13
            ? "轻微环绕或推近，形成审判感"
            : shotNo <= 20
              ? "镜头缓慢下移，像进入身体和泥土"
              : "镜头从低处缓慢抬升，带出森林和根系",
      location:
        shotNo <= 7
          ? "冷白画廊和暗部身体空间"
          : shotNo <= 13
            ? "镜面审判剧场和抽象观看空间"
            : shotNo <= 20
              ? "泥土、根系和身体内部的地下空间"
              : "森林根系、自然光和开放天空",
      timeLight:
        shotNo <= 13
          ? "冷白主光，暗部压低，局部暗红"
          : shotNo <= 20
            ? "地下低光，潮湿反射，绿色和褐色微光"
            : "柔和自然光，绿色和金色逐渐打开",
      mood: seed.mood,
      sound: `旁白气口约 ${Math.round(durationMs / 1000)} 秒；低频环境声跟随台词情绪`,
      styleRef: [
        "沿用根基现有视觉资产",
        sourceStyle,
        scene.artBrief,
      ]
        .filter(Boolean)
        .join("；"),
      sourceCardContent: scene.title,
      intent: `让台词「${seed.text}」成为画面情绪和动作的核心参考。`,
      rationale:
        "每一行台词对应一个镜头，按正常说话节奏安排时长，并让场景美术库约束后续图像和视频生成。",
      videoStart: `${scene.title}，${seed.subject}进入画面。`,
      videoEnd: `${seed.action}后停在可继续接下一句的状态。`,
      transitionIn:
        shotNo === scene.shotStart ? "新场景建立镜头" : "承接上一句旁白情绪",
      transitionOut:
        shotNo === scene.shotEnd ? "收束本场并准备转入下一场" : "情绪自然延续",
      videoPrompt: [
        `Scene ${scene.sceneNo}: ${scene.title}.`,
        `Art library: ${scene.artBrief}.`,
        `Voiceover reference: ${seed.text}.`,
        `Action: ${seed.action}.`,
        "Use the existing Genji/根基 visual language and reusable take continuity.",
      ].join(" "),
      promptDraft: [
        `场次：${scene.sceneNo} · ${scene.title}`,
        `场景美术库：${scene.artBrief}`,
        `台词/旁白：${seed.text}`,
        `画面动作：${seed.action}`,
        "不要把台词渲染成画面里的字幕、标语或 UI 文字。",
      ].join("\n"),
    };
  });
}

function buildBody(rootStory: SourceStory, shots: ReturnType<typeof buildShots>) {
  const rootBody = asRecord(rootStory.body);
  return {
    visualCanvasItems: clone(rootBody.visualCanvasItems ?? []),
    visualPreference:
      text(rootBody.visualPreference) ||
      "女性身体、根系、泥土、森林、冷白空间到自然光的电影感转变",
    imageProvider: text(rootBody.imageProvider) || "existing-assets",
    artDirection: clone(rootBody.artDirection ?? null),
    confirmedIntent: clone(rootBody.confirmedIntent ?? null),
    characters: [
      {
        name: "SheSelf",
        role: "主体/叙述者/生长者",
        oneLiner:
          "她从被观看、被规训的位置向身体和泥土深处走去，最终确认自己无需许可也能生长。",
      },
      {
        name: "她们",
        role: "历史根系",
        oneLiner:
          "她们是被放进别人秩序里的女性残影，也是不会消失的地下根系。",
      },
      {
        name: "他们/标准",
        role: "压迫结构",
        oneLiner:
          "它不是单一人物，而是观看、判断、证明和改造的系统性声音。",
      },
    ],
    scenes: scenes.map(scene => ({
      sceneNo: scene.sceneNo,
      title: scene.title,
      artBrief: scene.artBrief,
      shotRange: `${shotLabel(scene.shotStart)}-${shotLabel(scene.shotEnd)}`,
      sourceStoryId: rootStory.id,
      sourceStoryTitle: rootStory.title,
    })),
    cards: [],
    shots,
    materialReusePolicy:
      "继承根基故事的稳定镜头 ID；视频 take 通过稳定 ID 复用；图片按稳定 ID 优先、SH 编号兜底复制当前根基图。",
    sourceStoryId: rootStory.id,
    sourceStoryTitle: rootStory.title,
    _revision: {
      source: "seed-sheself-story",
      version: 1,
      createdAt: new Date().toISOString(),
    },
  };
}

function imageMaps(materials: NonNullable<Awaited<ReturnType<typeof getStoryMaterialState>>>) {
  const byStable = new Map<string, ImageAsset>();
  const byShotNo = new Map<number, ImageAsset>();
  const ordered: Array<{ shotNo: number; image: ImageAsset }> = [];
  for (const shot of materials.shots) {
    const image = shot.currentImage ?? shot.imageVersions[0] ?? null;
    if (!image) continue;
    byStable.set(shot.stableShotId, image);
    byShotNo.set(shot.shotNo, image);
    ordered.push({ shotNo: shot.shotNo, image });
  }
  return { byStable, byShotNo, ordered };
}

function nearestFallbackImage(
  targetShotNo: number,
  ordered: Array<{ shotNo: number; image: ImageAsset }>
): ImageAsset | null {
  if (ordered.length === 0) return null;
  const targetScene = sceneForShot(targetShotNo).sceneNo;
  const sameScene = ordered.filter(
    entry => sceneForShot(entry.shotNo).sceneNo === targetScene
  );
  const candidates = sameScene.length > 0 ? sameScene : ordered;
  return [...candidates].sort(
    (left, right) =>
      Math.abs(left.shotNo - targetShotNo) -
        Math.abs(right.shotNo - targetShotNo) || left.shotNo - right.shotNo
  )[0]?.image ?? null;
}

async function copyRootImages(params: {
  storyId: number;
  shots: ReturnType<typeof buildShots>;
  imageStory: SourceStory | null;
}) {
  if (!params.imageStory) return { copied: 0, sourceStoryId: null };
  const materials = await getStoryMaterialState(params.imageStory.id, USER_ID);
  if (!materials) return { copied: 0, sourceStoryId: params.imageStory.id };

  const { byStable, byShotNo, ordered } = imageMaps(materials);
  let copied = 0;
  for (const shot of params.shots) {
    const shotNo = Number(shot.shotNo);
    const legacyKey = `legacy-sh${String(shotNo).padStart(2, "0")}-shot`;
    const image =
      byStable.get(shot.stableShotId) ??
      byStable.get(legacyKey) ??
      byShotNo.get(shotNo) ??
      nearestFallbackImage(shotNo, ordered);
    if (!image) continue;

    const created = await createGeneratedImage({
      projectId: PREFERRED_PROJECT_ID,
      storyId: params.storyId,
      userId: USER_ID,
      shotNo: shotLabel(shotNo),
      shotIdentity: shot.stableShotId,
      imageKey: image.imageKey,
      imageUrl: image.imageUrl,
      prompt: image.prompt,
      generationType: "initial",
      parentImageId: image.id,
      isCurrent: true,
    });
    await promoteStoryImageToCurrent({
      imageId: created.id,
      storyId: params.storyId,
      userId: USER_ID,
      metadata: {
        source: "seed-sheself-root-image-copy",
        sourceStoryId: params.imageStory.id,
        sourceImageId: image.id,
      },
    });
    copied += 1;
  }

  return { copied, sourceStoryId: params.imageStory.id };
}

async function main() {
  if (dialogueSeeds.length !== 24) {
    throw new Error(`SheSelf 台词应为 24 行，当前为 ${dialogueSeeds.length}`);
  }

  const rootStory = await findSourceStory();
  const imageStory = await findImageStory();
  const shots = buildShots(rootStory);
  const body = buildBody(rootStory, shots);
  const created = await createStory({
    userId: USER_ID,
    projectId: rootStory.projectId ?? PREFERRED_PROJECT_ID,
    title: "SheSelf",
    logline:
      "一个被观看和规训的女性向身体与根系深处走去，重新确认自己可以生长。",
    theme: "真相只能是自己的感受；生长不需要被允许。",
    arc: "恐惧被规训 -> 被虚无标准吞没 -> 向身体和泥土深处走去 -> 在森林和根系中自我托举。",
    summary:
      "《SheSelf》按四幕场景拆成 24 个镜头，每行台词对应一个镜头和说话节奏时长，并继承根基素材体系。",
    body,
  });

  await migrateStoryPromptLineage({
    storyId: created.id,
    userId: USER_ID,
    body: {
      ...body,
      title: "SheSelf",
      theme: "真相只能是自己的感受；生长不需要被允许。",
      arc: "恐惧被规训 -> 被虚无标准吞没 -> 向身体和泥土深处走去 -> 在森林和根系中自我托举。",
    },
    source: "initial",
  });

  await updateStoryTimeline({
    storyId: created.id,
    userId: USER_ID,
    expectedVersion: 0,
    items: shots.map((shot, position) => ({
      stableShotId: shot.stableShotId,
      included: true,
      position,
      plannedDurationMs: shot.durationMs,
      transform: { ...DEFAULT_TIMELINE_TRANSFORM },
    })),
  });

  const imageResult = await copyRootImages({
    storyId: created.id,
    shots,
    imageStory,
  });
  const materials = await getStoryMaterialState(created.id, USER_ID);
  const currentImages =
    materials?.shots.filter(shot => Boolean(shot.currentImage)).length ?? 0;
  const currentVideos =
    materials?.shots.filter(shot => Boolean(shot.currentVideo)).length ?? 0;
  const reusableVideos =
    materials?.shots.reduce((sum, shot) => sum + shot.videoTakes.length, 0) ??
    0;

  console.log(
    JSON.stringify(
      {
        storyId: created.id,
        title: "SheSelf",
        sourceStoryId: rootStory.id,
        sourceStoryTitle: rootStory.title,
        imageSourceStoryId: imageResult.sourceStoryId,
        shotCount: shots.length,
        sceneCount: scenes.length,
        copiedImages: imageResult.copied,
        currentImages,
        currentVideos,
        reusableVideoTakes: reusableVideos,
        totalDurationMs: shots.reduce((sum, shot) => sum + shot.durationMs, 0),
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
