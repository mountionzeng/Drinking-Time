import { describe, expect, it } from 'vitest';
import type { CreationEditorShot } from '../CreationEditorContext';
import { buildPromptTable } from './buildPromptTable';

function makeShot(overrides: Partial<CreationEditorShot> = {}): CreationEditorShot {
  return {
    shotNo: 1,
    shotKey: 'SH01',
    subject: '女孩',
    action: '站在厨房门边',
    dialogue: '我只是想等一下',
    shotType: '中景',
    beat: '转折',
    cameraAngle: '平视',
    cameraMove: '缓慢推进',
    location: '傍晚厨房',
    timeLight: '落日侧光',
    mood: '温柔但紧张',
    sound: '',
    styleRef: '胶片油画',
    note: '',
    emotion: '犹豫',
    sourceCardContent: '用户说她在厨房门边停了一会儿。',
    videoStart: '她站在门边，手还没放下',
    videoEnd: '镜头落在她看向厨房里的停顿',
    transitionIn: '接上一镜的脚步声',
    transitionOut: '用视线带到下一镜',
    videoPrompt: '3-5 秒，平视缓慢推进，人物在门边停住，环境声降低，克制真实',
    ...overrides,
  };
}

describe('buildPromptTable', () => {
  it('builds content rows with source and category from shot fields', () => {
    const rows = buildPromptTable(makeShot());
    const subject = rows.find((row) => row.dimension === 'subject');

    expect(subject).toMatchObject({
      label: '主体',
      value: '女孩',
      category: 'content',
      source: {
        system: 'chat',
        label: '聊天',
        sourceCardContent: '用户说她在厨房门边停了一会儿。',
      },
    });
  });

  it('injects the structured prompt stub as eight art rows with weights', () => {
    const rows = buildPromptTable(makeShot());
    const artRows = rows.filter((row) => row.source.system === 'art-repo');

    expect(artRows).toHaveLength(8);
    expect(artRows.map((row) => row.dimension)).toEqual([
      'genre',
      'tone',
      'emotion',
      'lighting',
      'composition',
      'material',
      'angle',
      'palette',
    ]);
    expect(artRows.find((row) => row.dimension === 'genre')?.weight).toBe(0.5);
    expect(artRows.find((row) => row.dimension === 'tone')?.weight).toBe(0.3);
    expect(artRows.find((row) => row.dimension === 'emotion')?.weight).toBe(0.15);
  });

  it('adds director narrative rows when the shot has a narrative job', () => {
    const rows = buildPromptTable(makeShot({
      narrativeJob: {
        intentSummary: '用途：求职；观众：招聘者',
        audience: '招聘者',
        claim: '本镜要证明用户具备跨学科创新力。',
        roleConcern: '岗位关心候选人能否跨语境协作。',
        causalExplanation: '这个能力来自长期同时处理技术和影像任务。',
        evidence: '屏幕上密密麻麻的项目名、技能栏、数字',
        storyContext: '这是第 2 张优势卡。',
        visualTranslation: '把项目、技能和数字重新组织成清晰职业论点。',
        externalValue: '减少技术和业务之间的翻译损耗。',
        recommendationStatus: '强证据，可以直接作为核心镜头。',
        avoidMisread: '避免画成普通门口背影。',
      },
    }));
    const narrativeRows = rows.filter((row) => row.category === 'narrative');

    expect(narrativeRows.map((row) => row.dimension)).toEqual([
      'narrativeClaim',
      'roleConcern',
      'visualTranslation',
      'causalExplanation',
      'narrativeEvidence',
      'externalValue',
      'storyContext',
      'avoidMisread',
      'recommendationStatus',
      'intentSummary',
    ]);
    expect(narrativeRows.every((row) => row.category === 'narrative')).toBe(true);
    expect(narrativeRows.find((row) => row.dimension === 'visualTranslation')).toMatchObject({
      label: '导演画面策略',
      source: { system: 'director', label: '导演' },
    });
  });

  it('adds video motion rows from the same shot design source', () => {
    const rows = buildPromptTable(makeShot({ sound: '冰箱低频声和轻微脚步声' }));
    const motionRows = rows.filter((row) => row.category === 'motion');

    expect(motionRows.map((row) => row.dimension)).toEqual([
      'cameraMove',
      'videoStart',
      'videoEnd',
      'transitionIn',
      'transitionOut',
      'sound',
      'videoPrompt',
    ]);
    expect(motionRows.find((row) => row.dimension === 'videoPrompt')).toMatchObject({
      label: '图生视频提示词',
      source: { system: 'director', label: '导演' },
    });
  });

  it('keeps empty video rows editable for older stories without video design fields', () => {
    const rows = buildPromptTable(makeShot({
      cameraMove: '',
      sound: '',
      videoStart: '',
      videoEnd: '',
      transitionIn: '',
      transitionOut: '',
      videoPrompt: '',
    }));
    const motionRows = rows.filter((row) => row.category === 'motion');

    expect(motionRows.map((row) => row.dimension)).toEqual([
      'cameraMove',
      'videoStart',
      'videoEnd',
      'transitionIn',
      'transitionOut',
      'sound',
      'videoPrompt',
    ]);
    expect(motionRows.find((row) => row.dimension === 'videoPrompt')?.value).toBe('');
  });

  it('adds director rows from shot intent and rationale when no full narrative job exists', () => {
    const rows = buildPromptTable(makeShot({
      intent: '证明用户能把抽象需求转成可验证产品判断。',
      rationale: '岗位关心判断是否可信；这张画面用项目复盘材料把优势和证据连起来。',
    }));
    const narrativeRows = rows.filter((row) => row.category === 'narrative');

    expect(narrativeRows.map((row) => row.dimension)).toEqual([
      'narrativeClaim',
      'causalExplanation',
      'storyContext',
    ]);
    expect(narrativeRows.find((row) => row.dimension === 'narrativeClaim')).toMatchObject({
      label: '镜头意图',
      value: '证明用户能把抽象需求转成可验证产品判断。',
    });
    expect(narrativeRows.find((row) => row.dimension === 'causalExplanation')).toMatchObject({
      label: '导演解释',
      value: '岗位关心判断是否可信；这张画面用项目复盘材料把优势和证据连起来。',
    });
  });

  it('omits empty content fields without crashing', () => {
    const rows = buildPromptTable(makeShot({
      subject: '',
      action: '',
      dialogue: '',
    }));

    expect(rows.some((row) => row.dimension === 'subject')).toBe(false);
    expect(rows.some((row) => row.dimension === 'action')).toBe(false);
    expect(rows.some((row) => row.dimension === 'dialogue')).toBe(false);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('falls back to content rows if the structured prompt adapter fails', () => {
    const rows = buildPromptTable(makeShot(), {
      structuredPromptAdapter: () => {
        throw new Error('art repo unavailable');
      },
    });

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((row) => row.category === 'style')).toBe(false);
    expect(rows.some((row) => row.category === 'content')).toBe(true);
    expect(rows.some((row) => row.category === 'motion')).toBe(true);
    expect(rows.some((row) => row.source.system === 'art-repo')).toBe(false);
  });
});
