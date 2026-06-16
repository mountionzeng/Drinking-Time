import type { CreationEditorShot } from '../CreationEditorContext';
import type { ArtDimension } from './types';

export type StructuredPromptResult = {
  dimensions: ArtDimension[];
};

export type StructuredPromptAdapter = (shot: CreationEditorShot) => StructuredPromptResult;

function clean(value: string | undefined) {
  return value?.trim() ?? '';
}

function fallback(value: string, fallbackValue: string) {
  return value || fallbackValue;
}

/**
 * Temporary adapter for the art-repo getStructuredPrompt contract.
 *
 * Shape is intentionally concentrated here: the real art-repo integration should
 * replace this function only, leaving prompt-table consumers unchanged.
 */
export function getStructuredPromptStub(shot: CreationEditorShot): StructuredPromptResult {
  const style = clean(shot.styleRef);
  const mood = clean(shot.mood || shot.emotion);
  const timeLight = clean(shot.timeLight);
  const angle = clean(shot.cameraAngle);
  const shotType = clean(shot.shotType);
  const location = clean(shot.location);

  return {
    dimensions: [
      {
        dimension: 'genre',
        label: '流派',
        value: fallback(style, 'cinematic diary still, intimate realism'),
        weight: 0.5,
      },
      {
        dimension: 'tone',
        label: '色调',
        value: fallback([mood, timeLight].filter(Boolean).join('，'), 'warm restrained tones'),
        weight: 0.3,
      },
      {
        dimension: 'emotion',
        label: '情感',
        value: fallback(mood, 'subtle emotional movement'),
        weight: 0.15,
      },
      {
        dimension: 'lighting',
        label: '光线',
        value: fallback(timeLight, 'soft natural light'),
        weight: 0.05,
      },
      {
        dimension: 'composition',
        label: '构图',
        value: fallback([shotType, location].filter(Boolean).join('，'), 'quiet cinematic composition'),
        weight: 0.05,
      },
      {
        dimension: 'material',
        label: '材质',
        value: fallback(clean(shot.visualAnchorText || shot.note), 'daily texture, tactile detail'),
        weight: 0.05,
      },
      {
        dimension: 'angle',
        label: '角度',
        value: fallback(angle, 'human eye-level perspective'),
        weight: 0.05,
      },
      {
        dimension: 'palette',
        label: '配色',
        value: fallback([mood, style].filter(Boolean).join('，'), 'muted lived-in palette'),
        weight: 0.05,
      },
    ],
  };
}
