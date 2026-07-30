import {
  Briefcase,
  Heart,
  MessageCircleHeart,
  Share2,
  Sparkles,
  UserRound,
} from 'lucide-react';
import { useStoryAgentActions } from '@/features/storyAgent/StoryAgentContext';
import type { ChatMessage } from '@/features/storyAgent/types';
import { PURPOSE_LABELS, type StoryIntent } from '../intentTypes';

export type StoryCapabilityId =
  | 'personal_memory'
  | 'social_post'
  | 'linkedin_job_search'
  | 'gift'
  | 'portfolio'
  | 'fiction';

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
    label: '发社交平台给陌生人',
    description: '把故事讲给公开平台上的观众',
    icon: Share2,
  },
  {
    id: 'linkedin_job_search',
    label: '生成求职视频',
    description: '突出职业能力与可信度',
    icon: Briefcase,
  },
  {
    id: 'gift',
    label: '父母给孩子讲故事',
    description: '把一个故事讲给自己的孩子',
    icon: MessageCircleHeart,
  },
  {
    id: 'portfolio',
    label: '介绍自己的经历',
    description: '把真实经历整理成自己的故事',
    icon: UserRound,
  },
  {
    id: 'fiction',
    label: '创造另一个世界',
    description: '一句话生成虚构短片故事',
    icon: Sparkles,
  },
];

export const CAPABILITY_GROUPS: Array<{
  label: string;
  options: StoryCapabilityId[];
}> = [
  { label: '记录', options: ['personal_memory'] },
  { label: '给别人讲个故事', options: ['gift', 'social_post'] },
  {
    label: '生成一个自己的故事',
    options: ['linkedin_job_search', 'portfolio'],
  },
  { label: '创造另一个世界', options: ['fiction'] },
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
        desiredEffect: '让父母把一个完整、适合聆听的故事讲给孩子',
        tone: '清楚、温暖、有想象力，适合亲子讲述',
        confidence: 1,
        missingQuestion: '',
        configured: true,
      };
    case 'portfolio':
      return {
        purpose: 'portfolio',
        audience: 'public',
        platform: 'presentation',
        desiredEffect: '把自己的真实经历整理成一个别人能理解的个人故事',
        tone: '真实、清楚、有个人视角',
        confidence: 1,
        missingQuestion: '',
        configured: true,
      };
    case 'fiction':
      return {
        purpose: 'fiction',
        audience: 'public',
        platform: 'presentation',
        desiredEffect: '把一句虚构灵感发展成一个能拍的短片故事',
        tone: '有世界感、有人物动机、带一点电影气质',
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
  const { setConfirmedIntent } = useStoryAgentActions();

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
          小酌可以帮你把一段经历或灵感做成
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-1.5">
          {CAPABILITY_GROUPS.map(group => (
            <section
              key={group.label}
              className="rounded-md border p-2"
              style={{ borderColor: 'var(--panel-border)' }}
            >
              <h3 className="mb-1.5 text-[11px] font-semibold leading-tight text-foreground">
                {group.label}
              </h3>
              <div className="flex flex-col gap-1">
                {group.options.map(capabilityId => {
                  const option = CAPABILITY_OPTIONS.find(item => item.id === capabilityId);
                  if (!option) return null;
                  const Icon = option.icon;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => chooseCapability(option.id, setConfirmedIntent)}
                      className="group flex min-h-[48px] items-start gap-2 rounded-sm border px-2 py-1.5 text-left transition-colors hover:bg-background/50 focus:outline-none focus:ring-1"
                      style={{
                        borderColor: 'var(--panel-border)',
                        // @ts-expect-error custom prop for tailwind ring color via inline style
                        '--tw-ring-color': 'var(--nayin-accent)',
                      }}
                    >
                      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-nayin-bright" />
                      <span className="min-w-0">
                        <span className="block text-[10.5px] font-medium leading-tight text-foreground">
                          {option.label}
                        </span>
                        <span className="mt-0.5 block text-[9px] leading-snug text-muted-foreground">
                          {option.description}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">
          也可以直接说你的事，小酌会自己判断要往哪条路走。
        </p>
      </div>
    </div>
  );
}
