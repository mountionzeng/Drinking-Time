import type { StoryIntent } from '@/features/storyAgent/intentTypes';
import type { NarrativeJob, StoryCard } from '@/features/storyAgent/types';

type CardForNarrative = Pick<StoryCard, 'title' | 'content' | 'emotion' | 'sensoryDetails'>;
type CardForIntent = Pick<StoryCard, 'title' | 'content' | 'sourceQuote' | 'rawText'>;

function clean(value: string | undefined, fallback = '') {
  return value?.replace(/\s+/g, ' ').trim() || fallback;
}

function audienceLabel(intent: StoryIntent) {
  if (intent.audience === 'recruiters') return '招聘者';
  if (intent.audience === 'clients') return '客户';
  if (intent.audience === 'investors') return '投资人';
  if (intent.audience === 'teammates') return '团队成员';
  if (intent.audience === 'public') return '公开观众';
  return intent.audience || '观众';
}

function cardEvidence(card: CardForNarrative | undefined) {
  return [
    clean(card?.content),
    card?.sensoryDetails?.length ? `细节：${card.sensoryDetails.join('、')}` : '',
    clean(card?.emotion) ? `情绪：${clean(card?.emotion)}` : '',
  ].filter(Boolean).join('；');
}

function cardText(card: CardForNarrative | undefined) {
  return [card?.title, card?.content, card?.emotion, ...(card?.sensoryDetails ?? [])]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function storyText(cards: readonly CardForIntent[]) {
  return cards
    .flatMap((card) => [card.title, card.content, card.sourceQuote, card.rawText])
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ')
    .replace(/\s+/g, ' ')
    .slice(0, 4000);
}

function inferTargetRole(text: string) {
  if (/AIGC\s*(类)?\s*PM/i.test(text) || /AIGC.*产品/.test(text)) return 'AIGC PM';
  if (/产品经理|Product Manager|PM\b/i.test(text)) return '产品经理';
  return '目标岗位';
}

function inferStrength(card: CardForNarrative | undefined, allText: string) {
  const text = `${cardText(card)} ${allText}`;
  if (/跨学科|技术.*艺术|艺术.*技术|影视|特效|计算机|CS/i.test(text)) {
    return '跨学科转译能力：能把技术创新、影像经验和产品表达放到同一个判断框架里';
  }
  if (/定义产品|产品.*往哪|AIGC|PM|产品经理|方向/i.test(text)) {
    return '产品方向判断：不只执行需求，而是能判断产品应该往哪里走';
  }
  if (/结果|说服|不需要说服|给别人/i.test(text)) {
    return '结果导向：用可见成果降低沟通成本，而不是停在口头说服';
  }
  if (/流程|运作|全局|标准|判断|抽象/i.test(text)) {
    return '系统理解：能把抽象问题拆成流程、标准和可验证的判断';
  }
  if (/验证|想法|非正式|聊聊|需求/i.test(text)) {
    return '低成本验证：能在早期用轻量对话和小样判断方向是否成立';
  }
  if (/必须|转型|门槛|清楚/i.test(text)) {
    return '主动选择：知道自己为什么要转向，并能把这件事讲成清晰职业叙事';
  }
  return clean(card?.title, '一个值得进一步挖掘的求职优势');
}

function inferRoleConcern(targetRole: string, strength: string) {
  if (/AIGC|PM|产品/i.test(targetRole)) {
    return `${targetRole} 关心的不是会不会使用工具，而是候选人能否看懂技术可能性、用户需求和商业落点之间的关系，并把抽象方向变成可验证的产品判断。`;
  }
  if (/跨学科|转译|技术|艺术/.test(strength)) {
    return `${targetRole} 关心候选人能否跨语境协作：既听得懂技术，也能把结果翻译成团队、客户或观众能理解的价值。`;
  }
  return `${targetRole} 关心候选人是否有真实优势、可信证据，以及这个优势能不能在外部工作场景里产生价值。`;
}

function inferCausalExplanation(card: CardForNarrative | undefined, strength: string) {
  const evidence = clean(card?.content, clean(card?.title));
  if (/跨学科|转译|技术|艺术/.test(strength)) {
    return `这个能力不是一句性格标签，而是来自长期同时处理技术、影像和表达任务：${evidence}`;
  }
  if (/系统理解|流程|标准/.test(strength)) {
    return `这个能力来自他反复把模糊需求拆成流程、标准和验证动作的经验：${evidence}`;
  }
  if (/低成本验证/.test(strength)) {
    return `这个能力来自他习惯先用轻量沟通确认方向，再决定是否投入更重资源：${evidence}`;
  }
  return `这个片段说明优势是从真实经历里长出来的，而不是临时包装出来的标签：${evidence}`;
}

function inferExternalValue(targetRole: string, strength: string) {
  if (/AIGC|PM|产品/i.test(targetRole)) {
    return '外部价值：帮助团队更快判断一个 AIGC 产品方向是否值得做，把技术亮点转成用户能感知、业务能评估的产品结果。';
  }
  if (/跨学科|转译|技术|艺术/.test(strength)) {
    return '外部价值：减少技术、创意和业务之间的翻译损耗，让复杂想法更快变成可沟通、可评审、可落地的输出。';
  }
  return '外部价值：让招聘者看到这不是自我感受，而是一种能在真实工作中降低风险、提高效率或创造结果的能力。';
}

function evidenceState(card: CardForNarrative | undefined) {
  const text = cardText(card);
  if (/\d|年|硕士|项目|插件|效率|作品|经验|岗位|简历/i.test(text)) {
    return '强证据：可以直接作为核心优势镜头，但画面要优先展示可验证材料和工作场景。';
  }
  if (text.length > 48) {
    return '可拍但需补强：已有方向和语气，建议继续追问数字、作品、项目名或具体结果来提高说服力。';
  }
  return '证据不足：先不要拍成核心优势，建议继续追问经历细节，或把它降权为过渡镜头。';
}

function storyPosition(params: {
  card?: CardForNarrative;
  shotNo: number;
  totalShots: number;
}) {
  const title = clean(params.card?.title, `优势 ${params.shotNo}`);
  if (params.totalShots <= 1) {
    return `这是当前唯一优势卡：先把“${title}”拍成一个可理解的能力论点。`;
  }
  if (params.shotNo === 1) {
    return `这是开场优势卡：用“${title}”建立候选人的定位，不急着煽情，先让招聘者知道这支片为什么值得看。`;
  }
  if (params.shotNo === params.totalShots) {
    return `这是收束优势卡：用“${title}”把前面的证据落到下一步机会和外部价值上。`;
  }
  return `这是第 ${params.shotNo}/${params.totalShots} 张优势卡：承接前面的定位，继续补足“为什么可信”和“如何发生作用”。`;
}

export function deriveNarrativeIntent(params: {
  confirmedIntent: StoryIntent | null | undefined;
  cards: readonly CardForIntent[];
}): StoryIntent | null {
  if (params.confirmedIntent) return params.confirmedIntent;
  const text = storyText(params.cards);
  const jobSignals = [
    /求职|招聘|面试官|简历|领英|LinkedIn/i,
    /AIGC\s*(类)?\s*PM/i,
    /岗位|职位|target role/i,
  ];
  if (!jobSignals.some((signal) => signal.test(text))) return null;
  return {
    purpose: 'linkedin_job_search',
    audience: 'recruiters',
    platform: 'linkedin',
    tone: 'credible',
    desiredEffect: '让招聘者理解这段经历背后的判断力、可信度和跨学科转化能力',
    targetRole: inferTargetRole(text),
    channel: 'story-material-inference',
    confidence: 0.66,
  };
}

export function buildNarrativeJob(params: {
  intent: StoryIntent | null | undefined;
  card?: CardForNarrative;
  cards?: readonly CardForIntent[];
  shotNo: number;
  totalShots: number;
}): NarrativeJob | undefined {
  const { intent, card } = params;
  if (!intent || intent.purpose === 'personal_memory') return undefined;

  const audience = audienceLabel(intent);
  const desiredEffect = clean(intent.desiredEffect, '让观众理解这段经历的意义');
  const targetRole = clean(intent.targetRole, '目标岗位');
  const allText = storyText(params.cards ?? []);
  const strength = inferStrength(card, `${targetRole} ${allText}`);
  const evidence = cardEvidence(card) || clean(card?.title, `第 ${params.shotNo} 个故事片段`);
  const intentSummary = [
    `用途：${intent.purpose}`,
    `观众：${audience}`,
    `平台：${intent.platform || 'unknown'}`,
    `效果：${desiredEffect}`,
  ].join('；');

  if (intent.purpose === 'linkedin_job_search') {
    return {
      intentSummary,
      audience,
      roleConcern: inferRoleConcern(targetRole, strength),
      claim: strength,
      causalExplanation: inferCausalExplanation(card, strength),
      evidence,
      storyContext: storyPosition(params),
      visualTranslation: `按广告片导演思路拍：把“${strength}”转成一个招聘者能一眼读懂的工作证据画面。优先展示简历/作品/流程图/会议白板/原型/项目现场等可验证材料，再用人物动作和构图说明判断正在发生。`,
      externalValue: inferExternalValue(targetRole, strength),
      recommendationStatus: evidenceState(card),
      avoidMisread: '避免拍成普通情绪短片、孤独人物、门口背影、励志海报或抽象氛围图；画面必须回答“这张卡为什么能增加求职说服力”。',
    };
  }

  return {
    intentSummary,
    audience,
    claim: `本镜要服务“${desiredEffect}”，让${audience}明白这个片段为什么值得被看见。`,
    roleConcern: `${audience}需要先看懂这个片段与整体目标的关系，再被画面情绪打动。`,
    causalExplanation: `这个片段的意义来自具体经历，而不是单独的漂亮氛围：${evidence}`,
    evidence,
    storyContext: storyPosition(params),
    visualTranslation: '把抽象目的转成具体可见的动作、物件、关系或证据，让画面承担说明任务，而不只是制造气氛。',
    externalValue: `外部价值：让${audience}更快理解这个片段和用户目标之间的关系。`,
    recommendationStatus: evidenceState(card),
    avoidMisread: '避免只画漂亮情绪或独立海报；画面必须能回到本镜的观众理解任务。',
  };
}
