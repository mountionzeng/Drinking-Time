/**
 * 艺术性增强词库
 * 在美术风格的基础上，补充高级艺术描述词来增强艺术性
 */

export interface ArtisticEnhancementTier {
  // 第一层：细节质感增强
  textureDetails: string[];
  // 第二层：光影艺术性增强
  lightingArt: string[];
  // 第三层：构图美学增强
  compositionArt: string[];
  // 第四层：色彩和谐增强
  colorHarmony: string[];
  // 第五层：意境和深度增强
  artisticDepth: string[];
}

/**
 * 按美术流派分类的艺术性增强词
 */
export const ArtisticEnhancementByStyle: Record<string, ArtisticEnhancementTier> = {
  "水彩插画": {
    textureDetails: [
      "细致的水彩晕染",
      "流动的笔触韵律",
      "纸张纹理质感",
      "透明渐变效果",
      "湿润笔触的温度感",
    ],
    lightingArt: [
      "光线穿过水分的柔和散射",
      "阴影中保留白纸的呼吸感",
      "光与影的诗意对话",
      "自然光晕的温柔包围",
    ],
    compositionArt: [
      "恰到好处的留白",
      "视觉焦点的自然引导",
      "空间的诗意分布",
      "动静平衡的构图",
    ],
    colorHarmony: [
      "颜色的自然融合与过渡",
      "色彩的内在和谐关系",
      "冷暖色调的对话",
      "饱和度的精妙控制",
    ],
    artisticDepth: [
      "意韵悠远的氛围营造",
      "观者心灵的共鸣空间",
      "时间在画面中的流动",
      "静物中蕴含的生命力",
    ],
  },

  "油画": {
    textureDetails: [
      "厚重的油彩笔触",
      "层层堆积的肌理",
      "明暗交界的过渡",
      "笔触节奏的律动感",
      "油彩特有的光泽感",
    ],
    lightingArt: [
      "戏剧化的光源塑形",
      "明暗对比的力量感",
      "光线雕刻的体积感",
      "阴影中暗含的色彩丰富性",
    ],
    compositionArt: [
      "古典比例的美感",
      "焦点的强势表达",
      "形体的坚实感",
      "空间的纵深感",
    ],
    colorHarmony: [
      "色层的深度与厚度",
      "冷暖对比的张力",
      "颜色的振动与共鸣",
      "油彩特有的色彩沉淀感",
    ],
    artisticDepth: [
      "古典美学的现代诠释",
      "人文精神的凝聚",
      "时代精神的记录",
      "永恒性的视觉追求",
    ],
  },

  "素描": {
    textureDetails: [
      "铅笔的细腻笔触",
      "线条的韵律节奏",
      "黑白灰的层次递进",
      "纸张与笔的对话",
      "线条的力度变化",
    ],
    lightingArt: [
      "线条勾勒的光影体积",
      "阴影的深度与透视",
      "光线的解剖式表达",
      "明暗交界线的精妙处理",
    ],
    compositionArt: [
      "线条的构图力量",
      "负空间的审美价值",
      "形体的几何美感",
      "比例的精确性",
    ],
    colorHarmony: [
      "黑白灰的精妙分配",
      "色阶的均匀过渡",
      "明度关系的准确性",
      "整体调性的一致性",
    ],
    artisticDepth: [
      "古典美学的严谨追求",
      "对形体本质的探索",
      "精神气质的表达",
      "智性的视觉语言",
    ],
  },

  "数字插画": {
    textureDetails: [
      "精细的像素细节",
      "笔刷的数字质感",
      "图层的丰富层次",
      "滤镜的艺术表达",
      "色彩的精确控制",
    ],
    lightingArt: [
      "动态的光效表现",
      "科技感的光源设计",
      "精准的光线计算",
      "视觉冲击力的营造",
    ],
    compositionArt: [
      "现代视觉的动感构图",
      "层次的明确分布",
      "焦点的强势引导",
      "空间的三维感",
    ],
    colorHarmony: [
      "饱和度的大胆运用",
      "色彩的视觉冲击",
      "渐变的流畅性",
      "调色板的协调性",
    ],
    artisticDepth: [
      "当代审美的诠释",
      "想象力的自由表达",
      "虚幻与现实的交融",
      "个性风格的彰显",
    ],
  },
};

/**
 * 通用艺术性增强词（适用所有风格）
 */
export const UniversalArtisticEnhancement: ArtisticEnhancementTier = {
  textureDetails: [
    "精细的纹理处理",
    "质感的丰富层次",
    "细节的精妙把握",
  ],
  lightingArt: [
    "光影交融的艺术表现",
    "视觉张力的营造",
    "空间感的强化",
  ],
  compositionArt: [
    "视觉平衡的美感",
    "黄金比例的运用",
    "焦点的清晰表达",
  ],
  colorHarmony: [
    "色彩的和谐搭配",
    "冷暖关系的平衡",
    "色彩心理学的应用",
  ],
  artisticDepth: [
    "艺术意蕴的表达",
    "观者心灵的触动",
    "作品的永恒价值",
  ],
};

/**
 * 获取指定流派的艺术性增强词
 */
export function getArtisticEnhancementForStyle(style: string): ArtisticEnhancementTier {
  return ArtisticEnhancementByStyle[style] || UniversalArtisticEnhancement;
}

/**
 * 从艺术性增强词库中随机选择并生成增强提示词
 */
export function generateArtisticEnhancementPrompt(style: string, count: number = 3): string {
  const enhancement = getArtisticEnhancementForStyle(style);

  const selectedEnhancements: string[] = [];

  // 从各层中随机选择
  const layers = [
    enhancement.textureDetails,
    enhancement.lightingArt,
    enhancement.compositionArt,
    enhancement.colorHarmony,
    enhancement.artisticDepth,
  ];

  // 均匀地从各层选择
  for (let i = 0; i < Math.min(count, layers.length); i++) {
    const layer = layers[i];
    if (layer.length > 0) {
      const randomIdx = Math.floor(Math.random() * layer.length);
      selectedEnhancements.push(layer[randomIdx]);
    }
  }

  return selectedEnhancements.join("、");
}

/**
 * 融合艺术性增强到结构化提示词中
 */
export function enhancePromptWithArtistry(basePrompt: string, artStyle: string): string {
  const enhancement = generateArtisticEnhancementPrompt(artStyle, 2);

  if (!enhancement) {
    return basePrompt;
  }

  return `${basePrompt}\n【艺术性增强】${enhancement}`;
}
