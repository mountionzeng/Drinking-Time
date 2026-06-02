/**
 * Shot prompt composer
 *
 * 单一的「prompt 合成缝」：每镜最终出图 prompt 都从这里出来。
 * 输入层次固定为：
 * 1. 视觉内容（主体 / 动作 / 场景 / 镜头语言）
 * 2. 情绪电荷（本镜情绪 + beat 位置 + 与上一镜的流动 delta）
 * 3. 视觉锚（Story Cards 画布定下的审美 / 参考）
 *
 * 守则：流动来自用户材料，不为戏剧性放大，不制造新事实，不翻负。
 */

export type VisualAnchorForPrompt = {
  title: string;
  imageUrl?: string;
  objective?: string;
  aesthetic?: string;
  prompt?: string;
  visualStyle?: string[];
  mood?: string[];
  colorPalette?: string[];
};

export type ShotForPrompt = {
  shotNo: number;
  subject: string;
  action: string;
  dialogue: string;
  shotType: string;
  beat: string;
  cameraAngle: string;
  cameraMove: string;
  location: string;
  timeLight: string;
  mood: string;
  sound: string;
  styleRef: string;
  note: string;
  emotion: string;
  sourceCardContent: string;
};

export type ShotPromptComposition = {
  emotionCharge: string;
  emotionDelta: string;
  visualAnchorText: string;
  promptDraft: string;
  negativePrompt: string;
};

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function compactJoin(parts: Array<string | undefined | null>, sep = "，"): string {
  return parts.map(clean).filter(Boolean).join(sep);
}

function list(values?: string[], limit = 5): string {
  return Array.isArray(values)
    ? values.map(clean).filter(Boolean).slice(0, limit).join(" / ")
    : "";
}

function emotionOf(shot: ShotForPrompt): string {
  return clean(shot.emotion) || clean(shot.mood) || "未标";
}

function describeDelta(previous: ShotForPrompt | null, current: ShotForPrompt): string {
  const currentEmotion = emotionOf(current);
  if (!previous) {
    return `起点：${currentEmotion}`;
  }

  const previousEmotion = emotionOf(previous);
  if (previousEmotion === currentEmotion) {
    return `延续：${currentEmotion} 没有剧烈翻转，只看细微浓度变化`;
  }

  if (current.beat === "转折") {
    return `转变：从「${previousEmotion}」向「${currentEmotion}」偏移，画面要表现这个移动本身`;
  }

  return `流动：从「${previousEmotion}」过渡到「${currentEmotion}」，保持真实克制`;
}

function visualAnchorSummary(anchors?: VisualAnchorForPrompt[]): string {
  const picked = Array.isArray(anchors) ? anchors.slice(0, 4) : [];
  if (picked.length === 0) return "";

  return picked
    .map((anchor, index) => {
      const style = list(anchor.visualStyle, 3);
      const mood = list(anchor.mood, 3);
      const palette = list(anchor.colorPalette, 3);
      const text = compactJoin([
        anchor.aesthetic ? `审美：${anchor.aesthetic}` : "",
        style ? `风格：${style}` : "",
        mood ? `情绪：${mood}` : "",
        palette ? `色彩：${palette}` : "",
      ], "；");
      return `V${index + 1}「${anchor.title}」${text ? `（${text}）` : ""}`;
    })
    .join("；");
}

/** 镜头引用的图像片段（来自提示词片段池） */
export type FragmentForPrompt = {
  tag: string;
  text: string;
};

/** 把引用的图像片段组装成离散、带标签的 prompt 段落 */
function fragmentSection(fragments?: FragmentForPrompt[]): string {
  if (!fragments || fragments.length === 0) return "";
  // 按标签分组，每组一行
  const grouped = new Map<string, string[]>();
  for (const f of fragments) {
    const tag = f.tag.trim();
    const text = f.text.trim();
    if (!tag || !text) continue;
    const arr = grouped.get(tag) ?? [];
    arr.push(text);
    grouped.set(tag, arr);
  }
  if (grouped.size === 0) return "";
  const lines: string[] = [];
  grouped.forEach((texts, tag) => {
    lines.push(`${tag}：${texts.join(" / ")}`);
  });
  return `图像片段：\n${lines.join("\n")}`;
}

export function composeShotPrompt(params: {
  shot: ShotForPrompt;
  previousShot?: ShotForPrompt | null;
  arc?: string;
  visualAnchors?: VisualAnchorForPrompt[];
  /** 该镜引用的图像片段（优先于 visualAnchors 的压扁摘要） */
  fragments?: FragmentForPrompt[];
}): ShotPromptComposition {
  const { shot } = params;
  const emotionDelta = describeDelta(params.previousShot ?? null, shot);
  const emotionCharge = compactJoin([
    `本镜情绪：${emotionOf(shot)}`,
    `弧线位置：${shot.beat || "未标"}`,
    params.arc ? `整体弧线：${params.arc}` : "",
    emotionDelta,
  ], "；");
  const visualAnchorText = visualAnchorSummary(params.visualAnchors);

  const visualContent = compactJoin([
    shot.subject ? `主体：${shot.subject}` : "",
    shot.action ? `动作：${shot.action}` : "",
    shot.dialogue ? `原话/台词：${shot.dialogue}` : "",
    shot.location ? `场景：${shot.location}` : "",
    shot.shotType ? `景别：${shot.shotType}` : "",
  ], "；");

  const cameraAndLook = compactJoin([
    shot.cameraAngle ? `机位：${shot.cameraAngle}` : "",
    shot.cameraMove ? `运镜：${shot.cameraMove}` : "",
    shot.timeLight ? `时间与光：${shot.timeLight}` : "",
    shot.mood ? `氛围色调：${shot.mood}` : "",
    shot.styleRef ? `风格参考：${shot.styleRef}` : "",
  ], "；");

  // 有引用片段时用离散片段代替压扁的视觉锚；没有引用片段时回退到旧的视觉锚摘要
  const fragmentText = fragmentSection(params.fragments);
  const visualAnchorLine = fragmentText
    ? fragmentText
    : visualAnchorText
      ? `视觉锚：${visualAnchorText}`
      : "";

  const promptDraft = [
    visualContent || "主体与动作来自用户故事素材",
    cameraAndLook,
    `情绪电荷：${emotionCharge}`,
    shot.beat === "转折"
      ? "转折镜重点：不要只画静态悲伤或静态快乐，要用光线、色温、距离、姿态或构图表现情绪正在变化。"
      : "情绪处理：如实镜像用户材料，保持克制，不额外制造冲突或重大事实。",
    visualAnchorLine,
    "画面要求：电影感静帧，具体、可拍、保留日常质感，不要文字，不要水印。",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    emotionCharge,
    emotionDelta,
    visualAnchorText,
    promptDraft,
    negativePrompt: "不要夸张戏剧化，不要新增重大创伤事实，不要通用网红感，不要文字，不要水印",
  };
}

export function applyShotPromptComposition<T extends ShotForPrompt>(
  shots: T[],
  params: {
    arc?: string;
    visualAnchors?: VisualAnchorForPrompt[];
  } = {},
): Array<T & ShotPromptComposition> {
  return shots.map((shot, index) => {
    const composition = composeShotPrompt({
      shot,
      previousShot: index > 0 ? shots[index - 1] : null,
      arc: params.arc,
      visualAnchors: params.visualAnchors,
    });
    return { ...shot, ...composition };
  });
}
