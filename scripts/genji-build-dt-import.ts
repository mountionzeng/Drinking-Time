import fs from "node:fs";
import path from "node:path";

type GenjiAsset = {
  index: number;
  group: string;
  kind: "audio" | "image" | "video" | string;
  name: string;
  extension: string;
  size_mb: number;
  duration_sec: number | "";
  width: number | "";
  height: number | "";
  role_hint: string;
  source_path: string;
  quick_link: string;
  preview_rel: string;
};

type WorkspaceAsset = {
  index: number;
  group: string;
  kind: string;
  rank: string;
  name: string;
  duration: string;
  dimensions: string;
  roleHint: string;
  preview: string;
  quickLink: string;
  sourcePath: string;
};

type WorkspaceShot = {
  id: string;
  time: string;
  segment: string;
  task: string;
  candidate_ids: number[];
  status: string;
  priority: string;
  edit: string;
  gap: string;
  candidates: WorkspaceAsset[];
};

type WorkspaceData = {
  story: {
    title: string;
    version: string;
    format: string;
    premise: string;
    workingRule: string;
  };
  shots: WorkspaceShot[];
  assets: WorkspaceAsset[];
};

type ShotOverride = {
  subject: string;
  action: string;
  shotType: string;
  cameraAngle: string;
  cameraMove: string;
  location: string;
  timeLight: string;
  mood: string;
  sound: string;
  styleRef: string;
  emotion: string;
  videoStart: string;
  videoEnd: string;
  transitionIn: string;
  transitionOut: string;
  promptDraft: string;
  videoPrompt: string;
};

const repoRoot = process.cwd();
const genjiRoot = path.resolve(repoRoot, "../根基_素材整理");
const workspacePath = path.join(genjiRoot, "04_故事工作台/story_data.json");
const manifestPath = path.join(genjiRoot, "asset_manifest.json");
const outputDir = path.join(genjiRoot, "05_DT导入");
const outputJsonPath = path.join(outputDir, "genji_dt_story_import.json");
const outputReadmePath = path.join(outputDir, "README.md");

const youmindLinks = [
  { act: "第一幕", url: "https://youmind.com/d/n4cG3vbFAQY2cs" },
  { act: "第二幕", url: "https://youmind.com/d/ZRfPnmz2TPSgdx" },
  { act: "第三幕", url: "https://youmind.com/d/b5ultdjUeMH5CX" },
  { act: "第四幕", url: "https://youmind.com/d/ttPAgSbO4DnTEL" },
  { act: "第五幕", url: "https://youmind.com/d/hiICzvY0v7L7nD" },
];

const shotOverrides: Record<string, ShotOverride> = {
  S01: {
    subject: "蒙眼的女主",
    action: "静止在近距离镜头前，白布遮住眼睛，呼吸很轻。",
    shotType: "极近景",
    cameraAngle: "正面平视",
    cameraMove: "极慢推进",
    location: "黑暗画廊或无边背景",
    timeLight: "低照度，柔白侧光",
    mood: "被观看、被剥夺视线",
    sound: "低频空气声，远处观众席细小摩擦声",
    styleRef: "克制、冷白、皮肤与白布形成第一视觉锚点",
    emotion: "失明般的压抑",
    videoStart: "白布和皮肤几乎静止。",
    videoEnd: "呼吸让白布轻微起伏。",
    transitionIn: "黑场中浮出一块白布。",
    transitionOut: "白布的纹理切成画廊墙面。",
    promptDraft:
      "extreme close-up of a young woman blindfolded with white cloth, quiet breath, pale side light, black void background, cinematic restraint, intimate texture, no glamour, no horror makeup",
    videoPrompt: "slow push-in, almost still, cloth moves only with breathing",
  },
  S02: {
    subject: "被陈列的女主",
    action: "她像作品一样被放在画廊/古典剧场中，周围有不可见的观看者。",
    shotType: "中近景到中景",
    cameraAngle: "略低或平视",
    cameraMove: "缓慢横移",
    location: "古典画廊/剧场",
    timeLight: "展厅式冷暖混合光",
    mood: "被摆放、被凝视",
    sound: "空间混响、脚步、布料细响",
    styleRef: "古典剧场、白布、人体、沉默的观看关系",
    emotion: "羞耻与麻木",
    videoStart: "画廊空间先于人物出现。",
    videoEnd: "镜头停在她被观看的位置。",
    transitionIn: "白布纹理变成展厅墙面。",
    transitionOut: "观看者的压力转为红色规则空间。",
    promptDraft:
      "a blindfolded woman displayed like an artwork in a classical gallery theatre, restrained composition, quiet violence of being watched, cinematic tableau, no explicit crowd",
    videoPrompt: "slow lateral move across the gallery, keep the woman still",
  },
  S03: {
    subject: "红色规则空间里的女主",
    action: "她被数据、屏幕、审判式红光吞没。",
    shotType: "广角环境镜头",
    cameraAngle: "高压迫感平视",
    cameraMove: "短促推进",
    location: "红色数据法庭/抽象赛博空间",
    timeLight: "红黑强对比",
    mood: "被规训、被判定",
    sound: "电子噪声、硬切节拍",
    styleRef: "红色数据噩梦，屏幕感，规则侵入",
    emotion: "焦虑、被吞噬",
    videoStart: "规则空间像墙一样压近。",
    videoEnd: "红色空间裂成森林入口。",
    transitionIn: "画廊凝视变为审判红光。",
    transitionOut: "红色数据结构变成树干和枝干。",
    promptDraft:
      "red data tribunal, abstract cyber court, a lone blindfolded woman overwhelmed by screens and rules, oppressive crimson light, symbolic not literal sci-fi",
    videoPrompt: "fast tightening push, digital noise becomes organic branches",
  },
  S04: {
    subject: "红色森林入口",
    action: "红色规则空间变成枝干和裂缝，她被引向根部。",
    shotType: "竖构图通道镜头",
    cameraAngle: "仰视树干",
    cameraMove: "向前穿入",
    location: "红黑森林裂缝",
    timeLight: "红雾与黑树影",
    mood: "进入危险的内部",
    sound: "电子噪声逐渐变成风声和木质摩擦",
    styleRef: "红色森林、黑色枝干、入口感",
    emotion: "恐惧中的决心",
    videoStart: "红光和竖直树干像门。",
    videoEnd: "画面进入黑色根系。",
    transitionIn: "数据红光变成红雾。",
    transitionOut: "树干切成地下根系。",
    promptDraft:
      "a crimson forest corridor, black vertical trees forming a narrow passage, a symbolic entrance into roots, expressionist red and black, cinematic dread",
    videoPrompt: "forward drift through a vertical red forest corridor",
  },
  S05: {
    subject: "巨大根系下的女主",
    action: "她进入根系世界，身体很小，但开始向深处走。",
    shotType: "大全景",
    cameraAngle: "压迫性高角度",
    cameraMove: "慢推或下降",
    location: "黑红地下树根空间",
    timeLight: "黑暗中有红色天光",
    mood: "渺小、被吞没、但没有退回",
    sound: "低频、远处根系断裂声",
    styleRef: "黑红版画，巨大树根，人物尺度极小",
    emotion: "恐惧转为穿透",
    videoStart: "人物在根系下方几乎被黑暗吞没。",
    videoEnd: "人物向根系裂缝深处移动。",
    transitionIn: "红色森林入口落入地下。",
    transitionOut: "根系开始像身体和骨骼。",
    promptDraft:
      "tiny woman beneath colossal black roots in a red sky underworld, expressionist woodcut style, she moves toward a narrow opening between roots, oppressed but determined",
    videoPrompt: "slow descent and push toward the tiny figure under roots",
  },
  S06: {
    subject: "前代身体与树根",
    action: "手、骨感身体、根系缠绕在一起，形成历史层。",
    shotType: "近景组接",
    cameraAngle: "局部平视",
    cameraMove: "快速切片，局部慢推",
    location: "黑红根部深处",
    timeLight: "红黑硬光，白色骨感高光",
    mood: "不是一个人的痛",
    sound: "短促呼吸、骨木摩擦、节奏加快",
    styleRef: "白色肢体、黑色根、红色背景",
    emotion: "痛感、历史压迫",
    videoStart: "根系缠住手和身体局部。",
    videoEnd: "身体轮廓逐渐像根。",
    transitionIn: "巨根压迫切到身体局部。",
    transitionOut: "身体根化，进入根基深处。",
    promptDraft:
      "white hands and ancestral bodies intertwined with black roots against a red background, historical pain, symbolic bones and roots, expressionist, not gore",
    videoPrompt: "rapid montage feeling, tiny pushes on hands and roots",
  },
  S07: {
    subject: "根像身体，身体像根",
    action: "她到达根部深处，看见根系与身体已经不可分。",
    shotType: "中远景静帧",
    cameraAngle: "低角度",
    cameraMove: "轻微推拉",
    location: "根部核心",
    timeLight: "黑红渐暗",
    mood: "看见根基",
    sound: "噪声下降，低频心跳",
    styleRef: "树根身体化，黑红高对比",
    emotion: "震动、辨认",
    videoStart: "根系像身体趴伏。",
    videoEnd: "画面停在根部核心。",
    transitionIn: "身体缠绕变成整体根系。",
    transitionOut: "红黑压迫开始褪为灰绿地下。",
    promptDraft:
      "body-shaped roots at the core of an underground red-black forest, the root system resembles a human form, solemn symbolic composition, expressionist cinematic frame",
    videoPrompt: "subtle slow push, hold on the root-body shape",
  },
  S08: {
    subject: "灰绿地下空间",
    action: "黑红压迫退潮，根部变成潮湿、灰绿、有呼吸的空间。",
    shotType: "环境转场",
    cameraAngle: "低机位",
    cameraMove: "慢慢横移",
    location: "灰绿地下森林",
    timeLight: "雾气漫反射冷光",
    mood: "从窒息到呼吸",
    sound: "低频呼吸、水汽、泥土声",
    styleRef: "灰绿、潮湿、地下、根系空间",
    emotion: "缓慢松动",
    videoStart: "红黑根系仍在画面边缘。",
    videoEnd: "灰绿地下空间完全接管。",
    transitionIn: "红色降低饱和度。",
    transitionOut: "泥土里的手出现。",
    promptDraft:
      "grey green underground root chamber, mist, damp soil, a breathing space after red oppression, cinematic transition from nightmare to regrowth",
    videoPrompt: "slow lateral drift, red fades into grey-green mist",
  },
  S09: {
    subject: "从土里伸出的手",
    action: "一只手从泥土、根和黑暗中伸出来。",
    shotType: "近景",
    cameraAngle: "低角度贴近泥土",
    cameraMove: "手部跟随微推",
    location: "地下泥土与根系之间",
    timeLight: "灰绿雾光，手部高光",
    mood: "挣扎但开始活过来",
    sound: "泥土破开、呼吸变清楚",
    styleRef: "手、泥土、根系、灰绿雾气",
    emotion: "求生、重启",
    videoStart: "手还在泥土下。",
    videoEnd: "手掌突破根和泥。",
    transitionIn: "灰绿空间落到泥土表面。",
    transitionOut: "手的根化连接头发和身体。",
    promptDraft:
      "a human hand emerging from dark soil and roots, grey-green mist, symbolic rebirth, tactile mud and root texture, cinematic close-up, not zombie horror",
    videoPrompt: "hand slowly pushes through soil, roots shift subtly",
  },
  S10: {
    subject: "身体和头发化作根",
    action: "手、背影、长发开始变成根系，她不是逃离根，而是在重新生长。",
    shotType: "中近景",
    cameraAngle: "背面或侧面",
    cameraMove: "轻微环绕",
    location: "地下根系空间",
    timeLight: "灰绿冷光，柔雾",
    mood: "痛后的重建",
    sound: "呼吸、纤维生长、低频渐稳",
    styleRef: "长发化根、身体与树根融合",
    emotion: "生长、接受、重组",
    videoStart: "头发垂落，像湿黑线条。",
    videoEnd: "头发和根系连成一体。",
    transitionIn: "手的根化延伸到身体。",
    transitionOut: "根系支撑她重新站起。",
    promptDraft:
      "a woman seen from behind, long black hair transforming into roots, body merging with underground root system, grey-green mist, quiet rebirth, poetic not grotesque",
    videoPrompt: "hair slowly extends into root-like strands, subtle organic motion",
  },
  S11: {
    subject: "接近树洞出口的女主",
    action: "她重新站立，朝树洞出口靠近。",
    shotType: "中远景",
    cameraAngle: "背面平视",
    cameraMove: "缓慢跟随",
    location: "树洞内部/出口前",
    timeLight: "出口冷白光，内部灰绿暗光",
    mood: "清醒、接近存在",
    sound: "噪声消失，风声进入",
    styleRef: "树洞出口、根系环绕、人物站立",
    emotion: "稳定、临界",
    videoStart: "她站在根系内部。",
    videoEnd: "她到达树洞出口的光边。",
    transitionIn: "根系支撑她站起。",
    transitionOut: "手伸向蒙眼布。",
    promptDraft:
      "a woman standing inside a tree hollow, roots around the circular exit, pale forest light outside, quiet threshold, cinematic symbolic frame",
    videoPrompt: "slow follow from behind toward the tree hollow exit",
  },
  S12: {
    subject: "取下蒙眼布的女主",
    action: "她第一次主动取下白色蒙眼布。",
    shotType: "近景",
    cameraAngle: "正面或三分之二侧面",
    cameraMove: "极慢推进",
    location: "树洞出口的光边",
    timeLight: "柔白边缘光",
    mood: "从被看见到自己看见",
    sound: "布料滑落，世界安静一拍",
    styleRef: "白布、皮肤、树洞边缘光",
    emotion: "清醒、主体性",
    videoStart: "白布仍遮住眼睛。",
    videoEnd: "白布落下，眼睛第一次看向光。",
    transitionIn: "出口光照到蒙眼布。",
    transitionOut: "她转身走向森林。",
    promptDraft:
      "close-up of a woman at the edge of a tree hollow removing a white blindfold, soft forest light on her face, quiet act of seeing for herself, cinematic restraint",
    videoPrompt: "hands slowly untie and lower the blindfold, hold the first gaze",
  },
  S13: {
    subject: "走出树洞的白裙女主",
    action: "她从树洞出口走入森林光里，背影清晰但不解释。",
    shotType: "远景背影",
    cameraAngle: "背面平视",
    cameraMove: "静止或极慢后退",
    location: "树洞出口与森林",
    timeLight: "清晨森林散射光",
    mood: "存在、未完成但已经开始",
    sound: "风、树叶、很轻的呼吸",
    styleRef: "白裙、树洞、森林光、安静终章",
    emotion: "开放、坚定",
    videoStart: "她站在树洞出口。",
    videoEnd: "她走入森林光中。",
    transitionIn: "蒙眼布落下。",
    transitionOut: "留白结束。",
    promptDraft:
      "a woman in a simple white dress walking out of a tree hollow into soft forest light, back view, quiet ending, poetic cinematic realism, no fantasy glow",
    videoPrompt: "slow still shot, she walks from tree hollow into forest light",
  },
};

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function parseDurationMs(timeRange: string): number {
  const match = /^(\d+)-(\d+)s$/.exec(timeRange.trim());
  if (!match) return 3000;
  const start = Number(match[1]);
  const end = Number(match[2]);
  return Math.max(100, (end - start) * 1000);
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 42) || "asset"
  );
}

function importedFileName(asset: WorkspaceAsset | GenjiAsset): string {
  const index = String(asset.index).padStart(3, "0");
  return `genji-${index}-${slug(asset.name)}.jpg`;
}

function dtImageUrl(asset: WorkspaceAsset | GenjiAsset): string {
  return `/api/images/${importedFileName(asset)}`;
}

function stableShotId(shot: WorkspaceShot): string {
  return `genji-${shot.id.toLowerCase()}`;
}

function assetByIndex<T extends { index: number }>(assets: T[]) {
  return new Map(assets.map(asset => [asset.index, asset]));
}

function buildStoryShot(shot: WorkspaceShot, index: number) {
  const override = shotOverrides[shot.id];
  if (!override) throw new Error(`Missing shot override for ${shot.id}`);
  const shotNo = index + 1;
  const stable = stableShotId(shot);
  const gapLabel = shot.gap ? `缺口：${shot.gap}` : "无关键缺口";
  const candidateLabel = shot.candidate_ids.length
    ? `候选素材：${shot.candidate_ids.map(id => String(id).padStart(3, "0")).join(", ")}`
    : "候选素材：暂无";

  return {
    stableShotId: stable,
    shotIdentity: stable,
    shotNo,
    subject: override.subject,
    action: override.action,
    dialogue: "",
    shotType: override.shotType,
    beat: shot.segment,
    cameraAngle: override.cameraAngle,
    cameraMove: override.cameraMove,
    location: override.location,
    timeLight: override.timeLight,
    mood: override.mood,
    sound: override.sound,
    styleRef: override.styleRef,
    note: [
      `《根基》导入镜头 ${shot.id}｜${shot.time}`,
      `画面任务：${shot.task}`,
      `剪辑处理：${shot.edit}`,
      gapLabel,
      candidateLabel,
      `状态：${shot.status}`,
    ].join("\n"),
    emotion: override.emotion,
    sourceCardContent: shot.task,
    intent: shot.task,
    rationale: shot.gap
      ? `这个镜头位保留“${shot.gap}”，因为它影响观众是否能理解这一段的动作和主题。`
      : "现有素材可以先支撑这个镜头位，后续通过 DT 的 prompt table 和 animatic 继续打磨。",
    videoStart: override.videoStart,
    videoEnd: override.videoEnd,
    transitionIn: override.transitionIn,
    transitionOut: override.transitionOut,
    videoPrompt: override.videoPrompt,
    emotionCharge: `${shot.segment}｜${override.emotion}`,
    emotionDelta: override.transitionIn,
    visualAnchorText: override.styleRef,
    promptDraft: override.promptDraft,
    negativePrompt:
      "low quality, blurry, flat lighting, generic fantasy, glossy AI look, extra fingers, deformed hands, gore, horror makeup, text, watermark",
    durationMs: parseDurationMs(shot.time),
    genji: {
      time: shot.time,
      sourceShotId: shot.id,
      status: shot.status,
      priority: shot.priority || null,
      gap: shot.gap || null,
      candidateAssetIds: shot.candidate_ids,
      editNote: shot.edit,
    },
  };
}

function buildCards() {
  const now = Date.parse("2026-07-02T00:00:00.000Z");
  return [
    {
      id: "genji-card-act-1",
      title: "第一幕：被观看",
      content: "画廊、蒙眼、身体被陈列。问题不是她看见什么，而是她如何被观看。",
      emotion: "被观看的羞耻与麻木",
      sensoryDetails: ["白布", "画廊回声", "冷光", "静止身体"],
      createdAt: now,
      order: 1,
    },
    {
      id: "genji-card-act-2",
      title: "第二幕：被吞噬",
      content: "红色数据法庭和规则噩梦吞没她，外部判断变成内在牢笼。",
      emotion: "焦虑、规训、异化",
      sensoryDetails: ["红光", "电子噪声", "屏幕", "审判"],
      createdAt: now + 1,
      order: 2,
    },
    {
      id: "genji-card-act-3",
      title: "第三幕：穿透",
      content: "她进入黑红树根深处，看见身体、骨骸、根系缠绕在同一个历史结构里。",
      emotion: "恐惧转为决心",
      sensoryDetails: ["黑红树根", "骨感白色", "地下", "窒息"],
      createdAt: now + 2,
      order: 3,
    },
    {
      id: "genji-card-act-4",
      title: "第四幕：生长",
      content: "她不是逃离根，而是在泥土、头发和手的变化中重新长出自己。",
      emotion: "痛后的重建",
      sensoryDetails: ["泥土", "手", "头发化根", "灰绿雾"],
      createdAt: now + 3,
      order: 4,
    },
    {
      id: "genji-card-act-5",
      title: "第五幕：存在",
      content: "取下蒙眼布，走出树洞。答案不是胜利宣言，而是她终于自己看见。",
      emotion: "安静的主体性",
      sensoryDetails: ["白布落下", "树洞出口", "森林光", "背影"],
      createdAt: now + 4,
      order: 5,
    },
  ];
}

function buildAssetPool(manifest: GenjiAsset[], workspaceAssets: WorkspaceAsset[]) {
  const workspaceByIndex = assetByIndex(workspaceAssets);
  return manifest.map(asset => {
    const workspace = workspaceByIndex.get(asset.index);
    return {
      index: asset.index,
      group: asset.group,
      kind: asset.kind,
      rank: workspace?.rank ?? "待筛",
      name: asset.name,
      durationSec: asset.duration_sec || null,
      dimensions:
        asset.width && asset.height ? `${asset.width}x${asset.height}` : null,
      roleHint: asset.role_hint,
      sourcePath: asset.source_path,
      quickLink: asset.quick_link,
      previewPath: asset.preview_rel
        ? path.join(genjiRoot, asset.preview_rel)
        : null,
      proposedDtImageUrl: asset.preview_rel ? dtImageUrl(asset) : null,
    };
  });
}

function buildVisualCanvasItems(workspace: WorkspaceData) {
  return workspace.assets
    .filter(asset => asset.preview && (asset.rank === "A" || asset.rank === "B"))
    .slice(0, 48)
    .map((asset, index) => ({
      id: `genji-asset-${String(asset.index).padStart(3, "0")}`,
      title: `${String(asset.index).padStart(3, "0")}｜${asset.rank}｜${asset.group}`,
      imageUrl: dtImageUrl(asset),
      originalImageUrl: dtImageUrl(asset),
      source: "reference",
      x: (index % 8) * 180,
      y: Math.floor(index / 8) * 150,
      width: 160,
      height: 100,
      prompt: asset.roleHint,
      userInstruction: "《根基》导入素材，可作为风格、镜头或转场参照。",
      analysis: {
        objective: `${asset.group} 的 ${asset.kind} 素材 ${asset.name}`,
        aesthetic: asset.roleHint,
        visualStyle: [asset.rank, asset.group],
        mood: [asset.roleHint],
        colorPalette: [],
        composition: asset.dimensions || "",
        lighting: "",
        promptDraft: asset.roleHint,
        negativePrompt: "",
        confidence: 0.75,
      },
      createdAt: Date.parse("2026-07-02T00:00:00.000Z") + index,
    }));
}

function buildGeneratedImageRows(workspace: WorkspaceData) {
  const workspaceAssetsByIndex = assetByIndex(workspace.assets);
  return workspace.shots.flatMap((shot, shotIndex) => {
    const shotNo = shotIndex + 1;
    const stable = stableShotId(shot);
    return shot.candidate_ids.flatMap((assetId, candidateIndex) => {
      const asset = workspaceAssetsByIndex.get(assetId);
      if (!asset || !asset.preview) return [];
      return [
        {
          source: "dry-run-existing-asset-preview",
          sourceAssetIndex: asset.index,
          sourceAssetName: asset.name,
          sourcePreviewPath: path.resolve(outputDir, asset.preview),
          copyTargetFileName: importedFileName(asset),
          createGeneratedImageInput: {
            projectId: null,
            storyId: "__CREATED_STORY_ID__",
            userId: "__CURRENT_USER_ID__",
            shotNo: String(shotNo),
            shotIdentity: stable,
            imageKey: `genji-import/${importedFileName(asset)}`,
            imageUrl: dtImageUrl(asset),
            prompt: [
              `《根基》现有素材 ${String(asset.index).padStart(3, "0")} 导入为镜头 ${shot.id} 候选图。`,
              `素材组：${asset.group}`,
              `用途：${asset.roleHint}`,
              `镜头任务：${shot.task}`,
            ].join("\n"),
            generationType: "initial",
            parentImageId: null,
            isCurrent: candidateIndex === 0,
            maskKey: null,
          },
        },
      ];
    });
  });
}

function uniqueCopyPlan(rows: ReturnType<typeof buildGeneratedImageRows>) {
  const seen = new Set<string>();
  return rows.flatMap(row => {
    const key = row.copyTargetFileName;
    if (seen.has(key)) return [];
    seen.add(key);
    return [
      {
        sourcePreviewPath: row.sourcePreviewPath,
        targetRelativeToLocalImageDir: row.copyTargetFileName,
        imageUrl: row.createGeneratedImageInput.imageUrl,
      },
    ];
  });
}

function buildRenderBacklog(workspace: WorkspaceData) {
  return workspace.shots
    .filter(shot => shot.gap)
    .map(shot => ({
      shotId: shot.id,
      stableShotId: stableShotId(shot),
      time: shot.time,
      priority: shot.priority || "P2",
      gap: shot.gap,
      why: shot.edit,
      proposedPrompt: shotOverrides[shot.id]?.promptDraft ?? shot.task,
      status: shot.status,
    }));
}

function main() {
  const workspace = readJson<WorkspaceData>(workspacePath);
  const manifest = readJson<GenjiAsset[]>(manifestPath);
  const storyShots = workspace.shots.map(buildStoryShot);
  const generatedImageRows = buildGeneratedImageRows(workspace);
  const copyPlan = uniqueCopyPlan(generatedImageRows);
  const assetPool = buildAssetPool(manifest, workspace.assets);
  const renderBacklog = buildRenderBacklog(workspace);

  const storyUpsertInput = {
    title: "根基",
    logline:
      "一个被观看、被规训的女性向地下根系深处穿透，在前代身体与树根之间找回自己的观看和生长。",
    theme: "被观看的身体如何穿透历史根系，重新长出主体性。",
    arc: "被观看 → 被吞噬 → 穿透 → 生长 → 存在",
    summary:
      "90 秒重启版优先验证《根基》的核心视觉：蒙眼、红色数据法庭、黑红树根、手从泥土伸出、头发化根、取下蒙眼布、走出树洞。",
    projectId: null,
    body: {
      cards: buildCards(),
      characters: [
        {
          name: "女主",
          role: "主体/被观看者/穿透者",
          oneLiner: "她从被陈列和被规训的位置，进入根系深处，最后取回自己的观看。",
        },
        {
          name: "前代女性",
          role: "历史根系",
          oneLiner: "她们不一定以完整人物出现，而以手、骨、根、身体残影出现。",
        },
        {
          name: "规则/观看者",
          role: "压迫结构",
          oneLiner: "它可以是画廊、数据法庭、红色屏幕或抽象兽群，不是单一反派。",
        },
      ],
      shots: storyShots,
      visualPreference:
        "黑红版画式地下根系 + 灰绿雾气生长段 + 克制白布/白裙终章；避免泛奇幻、过度恐怖、廉价怪物片质感。",
      visualCanvasItems: buildVisualCanvasItems(workspace),
      genjiImport: {
        source: "Codex dry-run import package",
        generatedAt: new Date().toISOString(),
        sourceFolder:
          "/Users/yuandai/Local/iCloud-Desktop-Documents-Backup-20260517-221717/Desktop/根基/",
        organizedFolder: genjiRoot,
        workspaceStoryData: workspacePath,
        assetManifest: manifestPath,
        youmindLinks,
        principle:
          "重要但现有不够的镜头先占位；现有能改的镜头先进 DT 试剪和打磨。",
      },
      genjiAssetPool: assetPool,
      genjiRenderBacklog: renderBacklog,
      genjiEditPrinciples: [
        "第三幕和第四幕是主题核心，先保证穿透和生长成立。",
        "第一幕只需建立被观看，不做长设定。",
        "第二幕的动物/怪物只做污名投射闪回，不抢主线。",
        "缺口不硬凑，进入 DT 的 prompt table / rerender 链路。",
      ],
    },
  };

  const packageData = {
    mode: "dry-run",
    target: {
      app: "drinking-time-local",
      writeDatabase: false,
      writeLocalPersist: false,
      intendedEntry: "storyAgent.storyUpsert + createGeneratedImage",
    },
    storyUpsertInput,
    proposedGeneratedImages: generatedImageRows,
    copyPlan,
    validation: {
      sourceAssetCount: manifest.length,
      workspaceAssetCount: workspace.assets.length,
      shotCount: storyShots.length,
      renderBacklogCount: renderBacklog.length,
      proposedGeneratedImageRows: generatedImageRows.length,
      uniquePreviewCopies: copyPlan.length,
      missingShotOverrides: workspace.shots
        .filter(shot => !shotOverrides[shot.id])
        .map(shot => shot.id),
      shotsWithoutCandidates: workspace.shots
        .filter(shot => shot.candidate_ids.length === 0)
        .map(shot => shot.id),
      placeholderGaps: renderBacklog.map(item => `${item.priority}:${item.gap}`),
    },
  };

  ensureDir(outputDir);
  fs.writeFileSync(outputJsonPath, JSON.stringify(packageData, null, 2), "utf8");
  fs.writeFileSync(
    outputReadmePath,
    [
      "# 《根基》DT 导入 dry-run",
      "",
      "这个目录是把《根基》整理结果映射到 Drinking Time 现有架构的导入预览。",
      "",
      "- `genji_dt_story_import.json`：不会直接写库的完整导入包。",
      "- `storyUpsertInput`：准备交给 `storyAgent.storyUpsert` 的 DT story。",
      "- `proposedGeneratedImages`：准备挂到每个镜头的现有候选图。",
      "- `copyPlan`：真实导入时需要复制到 `LOCAL_IMAGE_DIR` 的预览图。",
      "",
      "当前策略：不是把 125 个素材都塞成主图，而是把 A/B 候选接到镜头，把完整素材池放进 story body 供 agent 分析。",
      "",
    ].join("\n"),
    "utf8"
  );

  console.log(`wrote ${outputJsonPath}`);
  console.log(
    JSON.stringify(
      {
        shots: storyShots.length,
        assets: manifest.length,
        generatedImageRows: generatedImageRows.length,
        uniquePreviewCopies: copyPlan.length,
        renderBacklog: renderBacklog.length,
      },
      null,
      2
    )
  );
}

main();
