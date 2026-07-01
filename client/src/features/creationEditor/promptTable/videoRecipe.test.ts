import { describe, expect, it } from 'vitest';
import type { CreationEditorShot } from '../CreationEditorContext';
import type { PromptRow } from './types';
import { compileVideoShotRecipe } from './videoRecipe';

function shot(overrides: Partial<CreationEditorShot> = {}): CreationEditorShot {
  return {
    shotNo: 1,
    shotKey: 'SH01',
    subject: '项目材料',
    action: '从混乱被整理成一条职业论点',
    dialogue: '我知道该往哪走',
    shotType: '中',
    beat: '开场',
    cameraAngle: '平视',
    cameraMove: '缓慢推进',
    location: '桌面',
    timeLight: '柔和桌面光',
    mood: '克制可信',
    sound: '低频环境声',
    styleRef: '纪实广告片',
    note: '',
    emotion: '笃定',
    sourceCardContent: '用户说自己能把抽象需求转成画面。',
    imageUrl: '/api/images/hero.png',
    intent: '证明用户能把抽象需求转成可验证判断。',
    rationale: '这镜用材料整理过程说明能力发生作用。',
    videoStart: '桌面上材料散开',
    videoEnd: '材料排成清晰路径',
    transitionIn: '开场进入',
    transitionOut: '手指指向下一份证据',
    videoPrompt: '3-5 秒，平视缓慢推进，材料从混乱变清晰',
    ...overrides,
  };
}

function row(dimension: string, value: string): PromptRow {
  return {
    id: `row:${dimension}`,
    dimension,
    label: dimension,
    value,
    weight: 0.5,
    source: { system: 'manual', label: '手改' },
    category: 'motion',
    inheritance: 'overridden',
    contentLength: Array.from(value).length,
  };
}

describe('compileVideoShotRecipe', () => {
  it('builds a video package from current image and shot design rows', () => {
    const recipe = compileVideoShotRecipe({
      shot: shot(),
      rows: [
        row('videoPrompt', '手改视频提示：镜头轻推，材料变成清晰职业论点'),
        row('sound', '纸张声后音乐收住'),
      ],
    });

    expect(recipe.missing).toEqual([]);
    expect(recipe.sourceImageUrl).toBe('/api/images/hero.png');
    expect(recipe.finalPrompt).toContain('只生成 SH01 的 3-5 秒短片片段');
    expect(recipe.finalPrompt).toContain('手改视频提示');
    expect(recipe.finalPrompt).toContain('纸张声后音乐收住');
    expect(recipe.usedDimensions).toContain('videoPrompt');
  });

  it('reports missing source image before the shot can be sent to video generation', () => {
    const recipe = compileVideoShotRecipe({
      shot: shot({ imageUrl: undefined, promptRun: undefined }),
      rows: [],
    });

    expect(recipe.missing).toContain('首帧图');
    expect(recipe.finalPrompt).toContain('相机运动：缓慢推进');
  });

  it('includes unified art prompt library dimensions in the video package', () => {
    const recipe = compileVideoShotRecipe({
      shot: shot(),
      rows: [
        row('visual_style', 'oil painting, Dutch Golden Age, in the manner of Rembrandt'),
        row('color_palette', '暖土, 赭石, 深褐'),
        row('lighting', '单一侧逆光 / 伦勃朗三角光'),
        row('composition', '近景半身，大片暗部留白'),
        row('material', '厚涂油画笔触，画布纹理'),
        row(
          'art_style_recipe',
          '暗调里被一束暖光雕出来的人\nsignature: 暗部里那束温暖的侧光',
        ),
        row('negative_prompt', '平光, 霓虹, 网红滤镜'),
      ],
    });

    expect(recipe.finalPrompt).toContain('美术配方：暗调里被一束暖光雕出来的人');
    expect(recipe.finalPrompt).toContain('美术风格：纪实广告片');
    expect(recipe.finalPrompt).toContain('oil painting, Dutch Golden Age');
    expect(recipe.finalPrompt).toContain('色彩基调：暖土, 赭石, 深褐');
    expect(recipe.finalPrompt).toContain('灯光：单一侧逆光 / 伦勃朗三角光');
    expect(recipe.finalPrompt).toContain('构图：近景半身，大片暗部留白');
    expect(recipe.finalPrompt).toContain('材质：厚涂油画笔触，画布纹理');
    expect(recipe.finalPrompt).toContain('平光, 霓虹, 网红滤镜');
    expect(recipe.usedDimensions).toEqual(
      expect.arrayContaining([
        'visual_style',
        'color_palette',
        'lighting',
        'composition',
        'material',
        'art_style_recipe',
        'negative_prompt',
      ]),
    );
  });
});
