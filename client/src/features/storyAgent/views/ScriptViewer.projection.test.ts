import { describe, expect, it } from 'vitest';
import { projectScriptScenesFromShots } from './ScriptViewer';
import type { GeneratedScript, StoryShot } from '@/features/storyAgent/types';

function shot(shotNo: number, overrides: Partial<StoryShot> = {}): StoryShot {
  return {
    shotNo,
    subject: `主体 ${shotNo}`,
    action: `动作 ${shotNo}`,
    dialogue: `台词 ${shotNo}`,
    shotType: '',
    beat: `拍点 ${shotNo}`,
    cameraAngle: '',
    cameraMove: '',
    location: '',
    timeLight: '',
    mood: '',
    sound: '',
    styleRef: '',
    note: '',
    emotion: `情绪 ${shotNo}`,
    sourceCardContent: '',
    ...overrides,
  };
}

function script(overrides: Partial<GeneratedScript> = {}): GeneratedScript {
  return {
    id: 'script-1',
    title: '旧剧本',
    logline: '',
    scenes: [
      {
        sceneNo: 'S01',
        fromCardId: 'card-1',
        visual: '旧 frozen visual',
        emotion: '旧情绪',
      },
    ],
    arcSummary: '',
    cardOrder: ['card-1'],
    createdAt: 1,
    ...overrides,
  };
}

describe('ScriptViewer canonical projection', () => {
  it('projects scene text from canonical story shots over frozen script scenes', () => {
    const scenes = projectScriptScenesFromShots(script(), [
      shot(1, {
        subject: '新的主体',
        action: '新的动作',
        dialogue: '新的台词',
        emotion: '新的情绪',
      }),
    ]);

    expect(scenes).toHaveLength(1);
    expect(scenes[0]).toMatchObject({
      sceneNo: 'S01',
      fromCardId: 'card-1',
      visual: '新的主体 · 新的动作 · 「新的台词」',
      emotion: '新的情绪',
      shotIndex: 0,
    });
  });

  it('falls back to latest script scenes before canonical shots exist', () => {
    const scenes = projectScriptScenesFromShots(script(), []);

    expect(scenes).toEqual([
      {
        sceneNo: 'S01',
        fromCardId: 'card-1',
        visual: '旧 frozen visual',
        emotion: '旧情绪',
      },
    ]);
  });
});
