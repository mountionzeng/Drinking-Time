export interface StoryIntent {
  purpose: string;
  audience: string;
  platform: string;
  desiredEffect?: string;
  tone?: string;
  confidence?: number;
  missingQuestion?: string;
  evidence?: string[];
  configured?: boolean;
  targetRole?: string;
  channel?: string;
  jobMaterialsPrompted?: boolean;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function normalizeStoryIntent(raw: unknown): StoryIntent | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (
    typeof obj.purpose !== 'string' ||
    typeof obj.audience !== 'string' ||
    typeof obj.platform !== 'string'
  ) {
    return null;
  }
  return {
    purpose: obj.purpose,
    audience: obj.audience,
    platform: obj.platform,
    desiredEffect: optionalString(obj.desiredEffect),
    tone: optionalString(obj.tone),
    confidence: typeof obj.confidence === 'number' ? obj.confidence : undefined,
    missingQuestion: optionalString(obj.missingQuestion),
    evidence: Array.isArray(obj.evidence)
      ? obj.evidence.filter((item): item is string => typeof item === 'string')
      : undefined,
    configured: typeof obj.configured === 'boolean' ? obj.configured : undefined,
    targetRole: optionalString(obj.targetRole),
    channel: optionalString(obj.channel),
    jobMaterialsPrompted:
      typeof obj.jobMaterialsPrompted === 'boolean' ? obj.jobMaterialsPrompted : undefined,
  };
}

export const PURPOSE_LABELS: Record<string, string> = {
  personal_memory: '给自己留念',
  social_post: '发社交平台',
  linkedin_job_search: '求职 / 领英',
  portfolio: '作品集',
  gift: '送给某个人',
  relationship_record: '记录一段关系',
  fiction: '讲别人的故事（虚构）',
  product_intro: '介绍自己的产品',
  creative_expression: '纯表达 / 情绪短片',
  exploration: '还在探索',
};

export const AUDIENCE_LABELS: Record<string, string> = {
  self: '自己',
  specific_person: '某个人',
  friends: '朋友',
  public: '大众',
  recruiters: '招聘者',
  clients: '客户',
  investors: '投资人',
  teammates: '团队',
  unknown: '待定',
};

export const JOB_CHANNEL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'linkedin', label: 'LinkedIn / 领英' },
  { value: 'wechat_video', label: '视频号' },
  { value: 'resume_attachment', label: '简历附件' },
  { value: 'referral', label: '内推' },
];
