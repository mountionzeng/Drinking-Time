import type { CreationEditorShot } from '../CreationEditorContext';
import type { PromptRow } from './types';

export type CompiledVideoShotRecipe = {
  sourceImageUrl?: string;
  finalPrompt: string;
  missing: string[];
  usedDimensions: string[];
};

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function rowValue(rows: readonly PromptRow[], dimension: string): string {
  return clean(rows.find((row) => row.dimension === dimension)?.value);
}

function shotLabel(shot: CreationEditorShot) {
  return shot.shotKey || `SH${String(shot.shotNo).padStart(2, '0')}`;
}

function addLine(lines: string[], label: string, value: string) {
  if (value) lines.push(`${label}：${value}`);
}

export function compileVideoShotRecipe(params: {
  shot: CreationEditorShot;
  rows: readonly PromptRow[];
}): CompiledVideoShotRecipe {
  const { shot, rows } = params;
  const sourceImageUrl = clean(shot.imageUrl) || clean(shot.promptRun?.imageUrl);
  const dimensions = [
    'videoPrompt',
    'subject',
    'action',
    'cameraMove',
    'videoStart',
    'videoEnd',
    'transitionIn',
    'transitionOut',
    'dialogue',
    'sound',
    'mood',
    'styleRef',
    'rationale',
  ];
  const usedDimensions: string[] = [];
  const value = (dimension: string) => {
    const next = rowValue(rows, dimension) || clean(shot[dimension as keyof CreationEditorShot]);
    if (next) usedDimensions.push(dimension);
    return next;
  };

  const videoPrompt = value('videoPrompt');
  const subject = value('subject');
  const action = value('action');
  const cameraMove = value('cameraMove');
  const videoStart = value('videoStart');
  const videoEnd = value('videoEnd');
  const transitionIn = value('transitionIn');
  const transitionOut = value('transitionOut');
  const dialogue = value('dialogue');
  const sound = value('sound');
  const mood = value('mood');
  const styleRef = value('styleRef');
  const rationale = value('rationale');

  const lines = [
    `图生视频任务：只生成 ${shotLabel(shot)} 的 3-5 秒短片片段。`,
    '使用当前关键帧作为首帧，保持人物、构图、色调和故事上下文一致。',
  ];
  addLine(lines, '核心视频提示', videoPrompt);
  addLine(lines, '镜头要传达的信息', clean(shot.intent) || rationale);
  addLine(lines, '主体', subject);
  addLine(lines, '动作', action);
  addLine(lines, '相机运动', cameraMove || '稳定轻微运动，避免夸张转场');
  addLine(lines, '起始画面', videoStart);
  addLine(lines, '结束状态', videoEnd);
  addLine(lines, '接上一镜', transitionIn);
  addLine(lines, '接下一镜', transitionOut);
  addLine(lines, '字幕/旁白含义', dialogue);
  addLine(lines, '背景音', sound);
  addLine(lines, '情绪色调', mood);
  addLine(lines, '美术风格', styleRef);
  lines.push('限制：不要生成文字水印，不要把字幕画进画面，不要新增事实，不要励志海报感。');
  lines.push('Negative: no floating objects, no gravity-defying elements, birds fly only in sky not on ground, characters obey physics, no impossible poses, no melting or warping of solid objects.');

  const missing: string[] = [];
  if (!sourceImageUrl) missing.push('首帧图');
  if (!videoPrompt && !action && !cameraMove) missing.push('视频运动提示');

  return {
    sourceImageUrl: sourceImageUrl || undefined,
    finalPrompt: lines.filter(Boolean).join('\n'),
    missing,
    usedDimensions: Array.from(new Set(usedDimensions.filter((dimension) => dimensions.includes(dimension)))),
  };
}
