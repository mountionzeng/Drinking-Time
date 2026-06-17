import { Briefcase, Gift, Heart, Images, Share2 } from 'lucide-react';
import { useStoryAgent } from '@/features/storyAgent/StoryAgentContext';
import type { ChatMessage } from '@/features/storyAgent/types';
import { PURPOSE_LABELS, type StoryIntent } from '../intentTypes';

export type StoryCapabilityId =
  | 'personal_memory'
  | 'social_post'
  | 'linkedin_job_search'
  | 'gift'
  | 'portfolio';

export const CAPABILITY_OPTIONS: Array<{
  id: StoryCapabilityId;
  label: string;
  description: string;
  icon: typeof Heart;
}> = [
  {
    id: 'personal_memory',
    label: PURPOSE_LABELS.personal_memory,
    description: '把这一段认真收好',
    icon: Heart,
  },
  {
    id: 'social_post',
    label: PURPOSE_LABELS.social_post,
    description: '适合朋友圈或社交平台',
    icon: Share2,
  },
  {
    id: 'linkedin_job_search',
    label: '求职 · 给招聘者看',
    description: '突出职业能力与可信度',
    icon: Briefcase,
  },
  {
    id: 'gift',
    label: PURPOSE_LABELS.gift,
    description: '做成一份给 TA 的短片',
    icon: Gift,
  },
  {
    id: 'portfolio',
    label: PURPOSE_LABELS.portfolio,
    description: '整理成对外展示作品',
    icon: Images,
  },
];

export function buildCapabilityIntent(capabilityId: StoryCapabilityId): StoryIntent {
  switch (capabilityId) {
    case 'linkedin_job_search':
      return {
        purpose: 'linkedin_job_search',
        audience: 'recruiters',
        platform: 'linkedin',
        desiredEffect: '让招聘者快速看见这个人的能力、判断力和可信度',
        tone: '清晰、专业、有个人温度，但不过度私人化',
        confidence: 1,
        missingQuestion: '',
        configured: true,
      };
    case 'social_post':
      return {
        purpose: 'social_post',
        audience: 'friends',
        platform: 'wechat',
        desiredEffect: '适合发给熟人圈看见这段经历',
        tone: '自然、轻盈、有分享感',
        confidence: 1,
        missingQuestion: '',
        configured: true,
      };
    case 'gift':
      return {
        purpose: 'gift',
        audience: 'specific_person',
        platform: 'private_archive',
        desiredEffect: '把这段经历做成给某个人的表达',
        tone: '真诚、克制、有温度',
        confidence: 1,
        missingQuestion: '',
        configured: true,
      };
    case 'portfolio':
      return {
        purpose: 'portfolio',
        audience: 'clients',
        platform: 'portfolio_site',
        desiredEffect: '整理成对外展示的个人作品',
        tone: '清楚、精致、可展示',
        confidence: 1,
        missingQuestion: '',
        configured: true,
      };
    case 'personal_memory':
    default:
      return {
        purpose: 'personal_memory',
        audience: 'self',
        platform: 'private_archive',
        desiredEffect: '把这段经历保存成给自己回看的短片',
        tone: '私人、柔和、忠于感受',
        confidence: 1,
        missingQuestion: '',
        configured: true,
      };
  }
}

export function chooseCapability(
  capabilityId: StoryCapabilityId,
  setConfirmedIntent: (intent: StoryIntent) => void,
): StoryIntent {
  const intent = buildCapabilityIntent(capabilityId);
  setConfirmedIntent(intent);
  return intent;
}

export function shouldShowCapabilityMenu({
  messages,
  confirmedIntent,
  returningGreeting,
  isReplying,
}: {
  messages: ChatMessage[];
  confirmedIntent: StoryIntent | null;
  returningGreeting: string | null;
  isReplying: boolean;
}): boolean {
  const hasUserMessage = messages.some(
    (message) => message.role === 'user' && (message.content.trim() || message.photoUrl),
  );
  return !confirmedIntent && !returningGreeting && !isReplying && !hasUserMessage;
}

export default function StoryCapabilityMenu() {
  const { setConfirmedIntent } = useStoryAgent();

  return (
    <div
      className="flex justify-start"
      data-testid="story-capability-menu"
    >
      <div
        className="max-w-[85%] rounded-2xl rounded-tl-sm border px-3 py-2.5 text-[12.5px] leading-relaxed"
        style={{
          background: 'var(--nayin-glow)',
          borderColor: 'var(--nayin-accent-dim)',
          color: 'var(--foreground)',
        }}
      >
        <div className="mb-2 text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground opacity-80">
          小酌可以帮你把一段经历做成
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(96px,1fr))] gap-1.5">
          {CAPABILITY_OPTIONS.map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => chooseCapability(option.id, setConfirmedIntent)}
                className="group flex min-h-[82px] flex-col items-start justify-between gap-2 rounded-md border px-2 py-2 text-left transition-colors hover:bg-background/50 focus:outline-none focus:ring-1"
                style={{
                  borderColor: 'var(--panel-border)',
                  // @ts-expect-error custom prop for tailwind ring color via inline style
                  '--tw-ring-color': 'var(--nayin-accent)',
                }}
              >
                <Icon className="h-3.5 w-3.5 shrink-0 text-nayin-bright" />
                <span className="min-w-0">
                  <span className="block text-[11px] font-medium leading-tight text-foreground">
                    {option.label}
                  </span>
                  <span className="mt-1 block text-[9.5px] leading-snug text-muted-foreground">
                    {option.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">
          也可以直接说你的事，小酌会自己判断要往哪条路走。
        </p>
      </div>
    </div>
  );
}
