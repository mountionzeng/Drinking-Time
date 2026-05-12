import type { ShotStage } from '../views/ShotStageIllustration';

export const ANALYSIS_STAGE_SEQUENCE: ShotStage[] = [
  'idea_pool',
  'requirement_pool',
  'structured',
  'production_ready',
  'queued',
  'rendered',
  'blocked',
];

export const ANALYSIS_STAGE_NARRATOR: Record<
  ShotStage,
  { tag: string; line: string }
> = {
  idea_pool: {
    tag: 'IDEA',
    line: '在纳音节奏下，先让灵感浮起来，再决定哪些碎片值得进入制作流程。',
  },
  requirement_pool: {
    tag: 'REQ',
    line: '客户需求、剧本语义和参考图开始沉淀，边界与优先级逐渐显形。',
  },
  structured: {
    tag: 'STRUCT',
    line: '这里把感觉翻译成结构，把镜头语法、空间层次和光色骨架拎出来。',
  },
  production_ready: {
    tag: 'READY',
    line: '可生产镜头已经封坛，参数和提示词都足够稳定，可以进入生成或交付。',
  },
  queued: {
    tag: 'QUEUE',
    line: '镜头排进工序，等待渲染、审片或下一轮人工细修。',
  },
  rendered: {
    tag: 'DONE',
    line: '产出已经落桌，接下来就是比对、挑选和决定是否继续迭代。',
  },
  blocked: {
    tag: 'HOLD',
    line: '某个镜头卡住了，说明素材、意图或参数还有缺口，需要先补齐。',
  },
};
