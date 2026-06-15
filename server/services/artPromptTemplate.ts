/**
 * 美术提示词工程化模板
 * 通过维度表格结构化管理提示词的各个方面
 */

export interface ArtPromptDimensions {
  // 1. 美术流派（最高优先级）
  artStyle?: string;      // e.g., "水彩插画"
  artist?: string;        // e.g., "日式水彩风格"

  // 2. 色彩维度
  colorTone?: string;     // e.g., "cool-light" (冷色调、明亮)
  dominantColors?: string[]; // e.g., ["蓝色", "白色"]
  colorMood?: string;     // e.g., "清新" / "温暖" / "神秘"

  // 3. 光线维度
  lighting?: string;      // e.g., "侧光，主光源明确"
  timeOfDay?: string;     // e.g., "黄金时段" / "傍晚" / "午夜"

  // 4. 情感维度
  moods?: string[];       // e.g., ["宁静", "清新", "梦幻"]

  // 5. 构图与空间
  composition?: string;   // e.g., "远景构图，天空占比大"
  cameraAngle?: string;   // e.g., "平视" / "仰视" / "俯视"
  perspective?: string;   // e.g., "广角" / "近景" / "全身"

  // 6. 材质与质感
  materials?: string[];   // e.g., ["纸质", "水彩笔触"]
  texture?: string;       // e.g., "柔和" / "粗糙" / "精细"

  // 7. 场景背景
  setting?: string;       // e.g., "室内" / "山间" / "都市"
  environment?: string;   // 具体场景描述
}

/**
 * 提示词维度表格
 * 用来管理和查询不同美术风格的特征
 */
export const ArtStyleDimensionTable: Record<string, ArtPromptDimensions> = {
  "水彩插画": {
    artStyle: "水彩插画",
    artist: "日式水彩风格",
    colorTone: "cool-light",
    dominantColors: ["蓝色", "绿色", "白色"],
    colorMood: "清新",
    lighting: "散射光，柔和均匀",
    moods: ["宁静", "清新", "梦幻"],
    composition: "远景构图，天空占比大",
    cameraAngle: "平视",
    materials: ["纸质", "水彩笔触"],
    texture: "柔和",
  },

  "油画": {
    artStyle: "油画",
    artist: "印象派风格",
    colorTone: "warm-light",
    dominantColors: ["金色", "红色", "褐色"],
    colorMood: "温暖",
    lighting: "侧光，主光源明确",
    moods: ["温暖", "怀旧", "抒情"],
    composition: "人物半身，背景虚化",
    cameraAngle: "略微俯视",
    materials: ["布料", "油彩厚涂"],
    texture: "厚重",
  },

  "素描": {
    artStyle: "素描",
    artist: "写实素描",
    colorTone: "neutral-dark",
    dominantColors: ["黑色", "灰色", "白色"],
    colorMood: "庄严",
    lighting: "明暗对比强烈，侧光",
    moods: ["庄严", "细致", "立体感强"],
    composition: "人物肖像，正面构图",
    cameraAngle: "正面",
    materials: ["纸质", "铅笔"],
    texture: "精细",
  },

  "数字插画": {
    artStyle: "数字插画",
    artist: "概念艺术风格",
    colorTone: "cool-dark",
    dominantColors: ["紫色", "蓝色", "白色"],
    colorMood: "神秘",
    lighting: "光源位置明确，产生强反差",
    moods: ["神秘", "科幻", "动感"],
    composition: "全身人物，动态姿态",
    cameraAngle: "仰视",
    materials: ["数字笔刷", "图层混合"],
    texture: "锐利",
  },

  "扁平插画": {
    artStyle: "扁平插画",
    artist: "现代插画风格",
    colorTone: "mixed-light",
    dominantColors: ["绿色", "黄色", "粉色"],
    colorMood: "温暖",
    lighting: "均匀背景，无明确光源",
    moods: ["温暖", "亲切", "简洁"],
    composition: "简洁构图，留白充分",
    cameraAngle: "正面平视",
    materials: ["数字绘画", "矢量图"],
    texture: "光滑",
  },
};

/**
 * 生成结构化提示词
 * 将维度表格转换为 LLM 可理解的提示词
 */
export function generateStructuredPrompt(dimensions: ArtPromptDimensions): string {
  const parts: string[] = [];

  // 按优先级顺序组织提示词
  if (dimensions.artStyle) {
    parts.push(`【美术流派】${dimensions.artStyle}`);
    if (dimensions.artist) {
      parts.push(`（${dimensions.artist}）`);
    }
  }

  if (dimensions.colorTone) {
    parts.push(`【色调】${dimensions.colorTone}`);
    if (dimensions.dominantColors?.length) {
      parts.push(`主要颜色：${dimensions.dominantColors.join("、")}`);
    }
  }

  if (dimensions.lighting) {
    parts.push(`【光线】${dimensions.lighting}`);
    if (dimensions.timeOfDay) {
      parts.push(`时间：${dimensions.timeOfDay}`);
    }
  }

  if (dimensions.moods?.length) {
    parts.push(`【情感】${dimensions.moods.join("、")}`);
  }

  if (dimensions.composition) {
    parts.push(`【构图】${dimensions.composition}`);
    if (dimensions.cameraAngle) {
      parts.push(`镜头角度：${dimensions.cameraAngle}`);
    }
  }

  if (dimensions.materials?.length) {
    parts.push(`【材质】${dimensions.materials.join("、")}`);
  }

  if (dimensions.texture) {
    parts.push(`【质感】${dimensions.texture}`);
  }

  return parts.join(" ");
}

/**
 * 维度表格查询 - 获取指定风格的所有维度
 */
export function getDimensionsForStyle(style: string): ArtPromptDimensions | null {
  return ArtStyleDimensionTable[style] || null;
}

/**
 * 提示词优先级定义
 * 定义哪些维度在生成提示词时的优先级
 */
export const PromptPriorityOrder = [
  "artStyle",      // 1. 美术流派（最重要）
  "artist",        // 2. 艺术家风格
  "colorTone",     // 3. 色调
  "lighting",      // 4. 光线
  "moods",         // 5. 情感
  "composition",   // 6. 构图
  "materials",     // 7. 材质
  "texture",       // 8. 质感
] as const;
