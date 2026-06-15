import { ArtReferenceFeature, getArtRepository } from "./artRepository";
import { generateStructuredPrompt, ArtPromptDimensions } from "./artPromptTemplate";
import { enhancePromptWithArtistry } from "./artisticEnhancement";

export interface DimensionScores {
  artStyle: number;
  colorTone: number;
  mood: number;
  materials: number;
}

export interface ReferenceMatch {
  filename: string;
  features: ArtReferenceFeature;
  totalScore: number;
  dimensionScores: DimensionScores;
}

export interface UserDimensions {
  artStyleKeywords: string[];
  colorKeywords: string[];
  moodKeywords: string[];
  materialKeywords: string[];
}

class ArtReferenceAgent {
  private artRepository = getArtRepository();

  extractDimensionsFromDescription(description: string): UserDimensions {
    const lowerDesc = description.toLowerCase();

    const artStyleKeywords = this.extractArtStyleKeywords(lowerDesc);
    const colorKeywords = this.extractColorKeywords(lowerDesc);
    const moodKeywords = this.extractMoodKeywords(lowerDesc);
    const materialKeywords = this.extractMaterialKeywords(lowerDesc);

    return {
      artStyleKeywords,
      colorKeywords,
      moodKeywords,
      materialKeywords,
    };
  }

  private extractArtStyleKeywords(text: string): string[] {
    const artStyles = [
      "水彩",
      "油画",
      "素描",
      "插画",
      "摄影",
      "漫画",
      "版画",
      "手绘",
      "粉笔",
      "铅笔",
      "钢笔",
      "彩铅",
      "印象派",
      "写实",
      "抽象",
      "现代",
      "古典",
    ];

    return artStyles.filter((style) => text.includes(style));
  }

  private extractColorKeywords(text: string): string[] {
    const colors = ["金色", "金黄", "褐色", "蓝色", "深蓝", "紫色", "深紫", "白色", "黑色", "灰色", "红色", "绿色"];
    const tones = ["暖色", "冷色", "中性", "亮", "暗", "明亮", "昏暗", "夜晚", "白天", "傍晚"];

    const foundColors = colors.filter((color) => text.includes(color));
    const foundTones = tones.filter((tone) => text.includes(tone));

    return [...foundColors, ...foundTones];
  }

  private extractMoodKeywords(text: string): string[] {
    const moods = [
      "温暖",
      "寒冷",
      "安静",
      "热闹",
      "思考",
      "欢乐",
      "悲伤",
      "神秘",
      "深沉",
      "轻松",
      "紧张",
      "平静",
      "动感",
      "抒情",
      "细致",
      "粗糙",
    ];

    return moods.filter((mood) => text.includes(mood));
  }

  private extractMaterialKeywords(text: string): string[] {
    const materials = ["布料", "木质", "金属", "皮肤", "纸质", "玻璃", "陶瓷", "石头"];

    return materials.filter((material) => text.includes(material));
  }

  scoreReference(
    reference: ArtReferenceFeature,
    userDimensions: UserDimensions,
  ): { totalScore: number; dimensionScores: DimensionScores } {
    const artStyleScore = this.scoreArtStyle(reference.artStyle, userDimensions.artStyleKeywords);
    const colorScore = this.scoreColorTone(reference.colorTone, reference.dominantColors, userDimensions.colorKeywords);
    const moodScore = this.scoreMood(reference.mood, userDimensions.moodKeywords);
    const materialScore = this.scoreMaterials(reference.materials, userDimensions.materialKeywords);

    // 权重：美术流派 50%，颜色 30%，情感 15%，材质 5%
    const totalScore = artStyleScore * 0.5 + colorScore * 0.3 + moodScore * 0.15 + materialScore * 0.05;

    return {
      totalScore,
      dimensionScores: {
        artStyle: artStyleScore,
        colorTone: colorScore,
        mood: moodScore,
        materials: materialScore,
      },
    };
  }

  private scoreArtStyle(refStyle: string, userKeywords: string[]): number {
    if (userKeywords.length === 0) return 0.5; // 中立分

    const refStyleLower = refStyle.toLowerCase();
    const matches = userKeywords.filter((keyword) => refStyleLower.includes(keyword));

    return Math.min(1.0, matches.length / userKeywords.length);
  }

  private scoreColorTone(
    refColorTone: string,
    refColors: string[],
    userKeywords: string[],
  ): number {
    if (userKeywords.length === 0) return 0.5;

    let score = 0;

    // 检查颜色匹配
    for (const keyword of userKeywords) {
      if (refColorTone.includes(keyword)) {
        score += 0.5;
      }
      for (const color of refColors) {
        if (color.includes(keyword)) {
          score += 0.25;
          break;
        }
      }
    }

    // 归一化
    return Math.min(1.0, score / userKeywords.length);
  }

  private scoreMood(refMoods: string[], userKeywords: string[]): number {
    if (userKeywords.length === 0) return 0.5;

    const matches = userKeywords.filter((mood) => refMoods.some((refMood) => refMood.includes(mood) || mood.includes(refMood)));

    return Math.min(1.0, matches.length / userKeywords.length);
  }

  private scoreMaterials(refMaterials: string[], userKeywords: string[]): number {
    if (userKeywords.length === 0) return 0.5;

    const matches = userKeywords.filter((material) =>
      refMaterials.some((refMat) => refMat.includes(material) || material.includes(refMat)),
    );

    return Math.min(1.0, matches.length / userKeywords.length);
  }

  findBestMatches(userDescription: string, topK: number = 3): ReferenceMatch[] {
    const dimensions = this.extractDimensionsFromDescription(userDescription);
    const allReferences = this.artRepository.getAllReferences();

    const scored = allReferences.map(([filename, features]) => {
      const { totalScore, dimensionScores } = this.scoreReference(features, dimensions);
      return {
        filename,
        features,
        totalScore,
        dimensionScores,
      };
    });

    // 按总分排序，降序
    scored.sort((a, b) => b.totalScore - a.totalScore);

    return scored.slice(0, topK);
  }

  getFeatureDescription(references: ReferenceMatch[]): string {
    if (references.length === 0) return "";

    const descriptions = references
      .map((ref) => {
        const { features } = ref;
        return `【${features.artStyle}】${features.visualDescription}`;
      })
      .join("\n");

    return descriptions;
  }

  // 获取推荐的主要艺术流派（用于强化生成提示）
  getMainArtStyle(references: ReferenceMatch[]): string {
    if (references.length === 0) return "";

    // 返回得分最高的参考的艺术流派
    const topRef = references[0];
    const style = topRef.features.artStyle;
    const artist = topRef.features.artistReference;

    if (artist) {
      return `${style}（${artist}风格）`;
    }
    return style;
  }

  // 生成工程化的结构化提示词（维度表格）
  generateStructuredArtPrompt(references: ReferenceMatch[]): string {
    if (references.length === 0) return "";

    const topRef = references[0];
    const features = topRef.features;

    // 构建维度对象
    const dimensions: ArtPromptDimensions = {
      artStyle: features.artStyle,
      artist: features.artistReference,
      colorTone: features.colorTone,
      dominantColors: features.dominantColors,
      lighting: features.lightingCharacter,
      moods: features.mood,
      composition: features.composition,
      cameraAngle: features.cameraAngle,
      materials: features.materials,
    };

    // 生成结构化提示词
    return generateStructuredPrompt(dimensions);
  }

  // 生成带艺术性增强的完整提示词
  generateEnhancedArtPrompt(references: ReferenceMatch[]): string {
    if (references.length === 0) return "";

    const basePrompt = this.generateStructuredArtPrompt(references);
    const artStyle = references[0]?.features.artStyle;

    // 融合艺术性增强词汇
    if (artStyle) {
      return enhancePromptWithArtistry(basePrompt, artStyle);
    }

    return basePrompt;
  }
}

let artReferenceAgentInstance: ArtReferenceAgent | null = null;

export function getArtReferenceAgent(): ArtReferenceAgent {
  if (!artReferenceAgentInstance) {
    artReferenceAgentInstance = new ArtReferenceAgent();
  }
  return artReferenceAgentInstance;
}
