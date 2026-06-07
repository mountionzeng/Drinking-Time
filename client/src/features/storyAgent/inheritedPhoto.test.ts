import { describe, expect, it } from 'vitest';
import {
  buildCardPhotoMap,
  buildInheritedPhotoReference,
  buildSceneInheritedImageMap,
  emptyVisualAnalysis,
  reconcileInheritedPhotos,
} from './inheritedPhoto';
import type { ChatMessage, VisualCanvasItem } from './types';

// 造一个视觉锚 fixture：默认是 reference，可覆盖任意字段
function makeVisualItem(overrides: Partial<VisualCanvasItem>): VisualCanvasItem {
  return {
    id: 'v1',
    title: '图',
    imageUrl: 'https://cdn.example.com/a.jpg',
    source: 'reference',
    x: 0,
    y: 0,
    width: 170,
    height: 218,
    prompt: '',
    analysis: emptyVisualAnalysis(),
    createdAt: 1,
    ...overrides,
  };
}

describe('emptyVisualAnalysis', () => {
  it('返回全空的视觉分析占位（字符串空、数组空、confidence 0）', () => {
    expect(emptyVisualAnalysis()).toEqual({
      objective: '',
      aesthetic: '',
      visualStyle: [],
      mood: [],
      colorPalette: [],
      composition: '',
      lighting: '',
      promptDraft: '',
      negativePrompt: '',
      confidence: 0,
    });
  });
});

describe('buildInheritedPhotoReference 构造卡片继承的对话照片视觉锚', () => {
  it('没带照片 → 返回 null（不挂图）', () => {
    expect(
      buildInheritedPhotoReference({
        photoUrlForStore: undefined,
        spawnedCardId: 'card_1',
        existingCount: 0,
        id: 'visual_1',
        createdAt: 1000,
      }),
    ).toBeNull();
  });

  it('没出卡 → 返回 null（没有可挂靠的卡片）', () => {
    expect(
      buildInheritedPhotoReference({
        photoUrlForStore: 'https://cdn.example.com/p.jpg',
        spawnedCardId: undefined,
        existingCount: 0,
        id: 'visual_1',
        createdAt: 1000,
      }),
    ).toBeNull();
  });

  it('照片+卡片都有 → 产出一条 source=reference、挂到该卡片的视觉锚（完整数据基准）', () => {
    const item = buildInheritedPhotoReference({
      photoUrlForStore: 'https://cdn.example.com/p.jpg',
      spawnedCardId: 'card_1',
      existingCount: 0,
      id: 'visual_1',
      createdAt: 1000,
    });

    // ↓↓↓ 这就是真机跑「发照片 → 出卡」后，落进 story body.visualCanvasItems 里应有的那条数据 ↓↓↓
    expect(item).toEqual({
      id: 'visual_1',
      title: '对话照片',
      imageUrl: 'https://cdn.example.com/p.jpg',
      source: 'reference',
      cardId: 'card_1',
      x: 18,
      y: 18,
      width: 170,
      height: 218,
      prompt: '',
      analysis: emptyVisualAnalysis(),
      createdAt: 1000,
    });
  });

  it('已有 N 张图时，新图按 18px 递增错开摆放', () => {
    const item = buildInheritedPhotoReference({
      photoUrlForStore: 'https://cdn.example.com/p.jpg',
      spawnedCardId: 'card_1',
      existingCount: 3,
      id: 'visual_9',
      createdAt: 1000,
    });
    expect(item?.x).toBe(18 + 3 * 18); // 72
    expect(item?.y).toBe(18 + 3 * 18);
  });
});

describe('buildSceneInheritedImageMap 剧本派生式取图', () => {
  it('场景 fromCardId 命中某卡片的 reference 图 → 映射到该图 URL', () => {
    const items = [
      makeVisualItem({
        id: 'v1',
        cardId: 'card_1',
        imageUrl: 'https://cdn/x.jpg',
        source: 'reference',
      }),
    ];
    const map = buildSceneInheritedImageMap(
      [{ sceneNo: 'S01', fromCardId: 'card_1' }],
      items,
    );
    expect(map.get('S01')).toBe('https://cdn/x.jpg');
  });

  it('fromCardId 为空串的场景被跳过（内容匹配没命中卡片）', () => {
    const items = [makeVisualItem({ cardId: 'card_1' })];
    const map = buildSceneInheritedImageMap(
      [{ sceneNo: 'S01', fromCardId: '' }],
      items,
    );
    expect(map.has('S01')).toBe(false);
  });

  it('只认 source=reference：美术 Agent 的 riff 图即使 cardId 相同也不当继承图', () => {
    const items = [
      makeVisualItem({
        id: 'v1',
        cardId: 'card_1',
        source: 'riff',
        imageUrl: 'https://cdn/riff.jpg',
      }),
    ];
    const map = buildSceneInheritedImageMap(
      [{ sceneNo: 'S01', fromCardId: 'card_1' }],
      items,
    );
    expect(map.has('S01')).toBe(false);
  });

  it('卡片没有任何继承图 → 该场景不进 Map（渲染端自然回退为无缩略图）', () => {
    const map = buildSceneInheritedImageMap(
      [{ sceneNo: 'S01', fromCardId: 'card_404' }],
      [makeVisualItem({ cardId: 'card_1' })],
    );
    expect(map.size).toBe(0);
  });

  it('多场景各取各的卡片继承图', () => {
    const items = [
      makeVisualItem({ id: 'v1', cardId: 'card_1', imageUrl: 'https://cdn/1.jpg' }),
      makeVisualItem({ id: 'v2', cardId: 'card_2', imageUrl: 'https://cdn/2.jpg' }),
    ];
    const map = buildSceneInheritedImageMap(
      [
        { sceneNo: 'S01', fromCardId: 'card_1' },
        { sceneNo: 'S02', fromCardId: 'card_2' },
      ],
      items,
    );
    expect(map.get('S01')).toBe('https://cdn/1.jpg');
    expect(map.get('S02')).toBe('https://cdn/2.jpg');
  });
});

// 造一条对话消息 fixture
function makeMsg(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'm1',
    role: 'user',
    content: '',
    timestamp: 1,
    ...overrides,
  };
}

describe('buildCardPhotoMap 从对话历史反查 cardId→来源照片', () => {
  it('实时态：用户发图在前、助手出卡在后 → 配对到该卡', () => {
    const map = buildCardPhotoMap([
      makeMsg({ role: 'user', photoUrl: 'https://cdn/p.jpg' }),
      makeMsg({ role: 'assistant', spawnedCardId: 'card_1' }),
    ]);
    expect(map.get('card_1')).toBe('https://cdn/p.jpg');
  });

  it('归档态：同一条消息既有图又有 spawnedCardId → 也能配对', () => {
    const map = buildCardPhotoMap([
      makeMsg({
        role: 'user',
        photoUrl: 'https://cdn/p.jpg',
        spawnedCardId: 'card_1',
      }),
    ]);
    expect(map.get('card_1')).toBe('https://cdn/p.jpg');
  });

  it('出卡但本轮没带图（前一条是无图用户发言）→ 不配对，不张冠李戴', () => {
    const map = buildCardPhotoMap([
      makeMsg({ role: 'user', photoUrl: 'https://cdn/p.jpg' }),
      makeMsg({ role: 'assistant', spawnedCardId: 'card_1' }),
      makeMsg({ role: 'user', content: '纯文字' }),
      makeMsg({ role: 'assistant', spawnedCardId: 'card_2' }),
    ]);
    expect(map.get('card_1')).toBe('https://cdn/p.jpg');
    expect(map.has('card_2')).toBe(false);
  });

  it('没出卡的消息一律跳过', () => {
    const map = buildCardPhotoMap([
      makeMsg({ role: 'user', photoUrl: 'https://cdn/p.jpg' }),
      makeMsg({ role: 'assistant', content: '我在' }),
    ]);
    expect(map.size).toBe(0);
  });
});

describe('reconcileInheritedPhotos 给老卡补挂继承图', () => {
  it('老卡有来源照片、却没 reference 视觉锚 → 补挂一条（cardId/source/imageUrl 对得上）', () => {
    const next = reconcileInheritedPhotos({
      visualCanvasItems: [],
      cards: [{ id: 'card_1' }],
      cardPhotoMap: new Map([['card_1', 'https://cdn/p.jpg']]),
      makeId: () => 'visual_new',
      now: 1000,
    });
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      id: 'visual_new',
      title: '对话照片',
      source: 'reference',
      cardId: 'card_1',
      imageUrl: 'https://cdn/p.jpg',
    });
  });

  it('卡已有 reference 视觉锚 → 幂等跳过，不重复挂图', () => {
    const existing = [
      makeVisualItem({ id: 'v1', cardId: 'card_1', source: 'reference' }),
    ];
    const next = reconcileInheritedPhotos({
      visualCanvasItems: existing,
      cards: [{ id: 'card_1' }],
      cardPhotoMap: new Map([['card_1', 'https://cdn/p.jpg']]),
      makeId: () => 'visual_new',
      now: 1000,
    });
    expect(next).toBe(existing); // 原样返回同一引用
  });

  it('卡没有来源照片 → 不补挂', () => {
    const next = reconcileInheritedPhotos({
      visualCanvasItems: [],
      cards: [{ id: 'card_404' }],
      cardPhotoMap: new Map([['card_1', 'https://cdn/p.jpg']]),
      makeId: () => 'visual_new',
      now: 1000,
    });
    expect(next).toHaveLength(0);
  });

  it('没有任何补挂 → 原样返回入参引用（调用方可据此跳过 setState）', () => {
    const existing = [makeVisualItem({ id: 'v1', cardId: 'card_1' })];
    const next = reconcileInheritedPhotos({
      visualCanvasItems: existing,
      cards: [{ id: 'card_1' }],
      cardPhotoMap: new Map(),
      makeId: () => 'visual_new',
      now: 1000,
    });
    expect(next).toBe(existing);
  });
});
