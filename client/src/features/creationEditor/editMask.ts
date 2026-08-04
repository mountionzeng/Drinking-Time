export type NormalizedMaskPoint = {
  x: number;
  y: number;
};

export type StoryboardEditMaskPlan = {
  label: string;
  points: readonly NormalizedMaskPoint[];
};

/**
 * 0201 首帧的人物位于画面中央；遮罩只覆盖腰线以下的现有裙摆与目标落地区域，
 * 避开头发、双臂、发光方框和上下宽银幕黑边。
 */
export const STORYBOARD_0201_FIRST_SKIRT_MASK_PLAN: StoryboardEditMaskPlan = {
  label: "0201 首帧女主腰线以下的裙摆至地面区域",
  points: [
    { x: 0.455, y: 0.61 },
    { x: 0.545, y: 0.61 },
    { x: 0.575, y: 0.68 },
    { x: 0.61, y: 0.815 },
    { x: 0.39, y: 0.815 },
    { x: 0.425, y: 0.68 },
  ],
};

/** 0201 尾帧人物更小、更靠上，使用独立的紧凑裙摆遮罩。 */
export const STORYBOARD_0201_LAST_SKIRT_MASK_PLAN: StoryboardEditMaskPlan = {
  label: "0201 尾帧女主腰线以下的裙摆至地面区域",
  points: [
    { x: 0.485, y: 0.575 },
    { x: 0.515, y: 0.575 },
    { x: 0.535, y: 0.62 },
    { x: 0.555, y: 0.72 },
    { x: 0.445, y: 0.72 },
    { x: 0.465, y: 0.62 },
  ],
};

export function requiresStoryboardExactEditMask(
  instruction: string,
  cueCode: string | null
): boolean {
  return cueCode === "0201" && /(裙|dress|gown)/i.test(instruction.trim());
}

export function storyboardExactEditMaskPlan(
  instruction: string,
  context: {
    cueCode: string | null;
    frameRole: "first" | "last" | "reference" | null;
  }
): StoryboardEditMaskPlan | undefined {
  if (!requiresStoryboardExactEditMask(instruction, context.cueCode)) {
    return undefined;
  }
  if (context.frameRole !== "first" && context.frameRole !== "last") {
    return undefined;
  }
  return context.frameRole === "last"
    ? STORYBOARD_0201_LAST_SKIRT_MASK_PLAN
    : STORYBOARD_0201_FIRST_SKIRT_MASK_PLAN;
}

export async function createStoryboardEditMaskDataUrl(
  imageUrl: string,
  plan: StoryboardEditMaskPlan
): Promise<string> {
  const image = new Image();
  image.decoding = "async";
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("遮罩基底图片加载失败"));
  });
  image.src = imageUrl;
  await loaded;

  if (!image.naturalWidth || !image.naturalHeight) {
    throw new Error("遮罩基底图片尺寸无效");
  }

  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("浏览器无法创建图片遮罩");

  context.fillStyle = "#000";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.globalCompositeOperation = "destination-out";
  context.beginPath();
  plan.points.forEach((point, index) => {
    const x = point.x * canvas.width;
    const y = point.y * canvas.height;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.closePath();
  context.fill();

  return canvas.toDataURL("image/png");
}
