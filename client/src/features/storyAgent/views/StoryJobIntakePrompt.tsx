import { useState } from 'react';
import { Briefcase, Check, CornerDownRight } from 'lucide-react';
import { useStoryAgentActions } from '@/features/storyAgent/StoryAgentContext';
import { useConfirmedIntent } from '@/features/storyAgent/spine/selectors';
import { JOB_CHANNEL_OPTIONS, type StoryIntent } from '../intentTypes';

export type JobIntakeStep = 'targetRole' | 'channel' | 'materials' | 'done' | 'none';

export function getJobIntakeStep(intent: StoryIntent | null): JobIntakeStep {
  if (!intent || intent.purpose !== 'linkedin_job_search') return 'none';
  if (intent.targetRole === undefined) return 'targetRole';
  if (intent.channel === undefined) return 'channel';
  if (!intent.jobMaterialsPrompted) return 'materials';
  return 'done';
}

export function mergeJobIntentField(
  intent: StoryIntent,
  patch:
    | Pick<StoryIntent, 'targetRole'>
    | Pick<StoryIntent, 'channel'>
    | Pick<StoryIntent, 'jobMaterialsPrompted'>,
): StoryIntent {
  return { ...intent, ...patch };
}

export function splitJobChannels(channel: string | undefined): string[] {
  return Array.from(
    new Set(
      (channel ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

export function toggleJobChannel(channels: string[], channel: string): string[] {
  return channels.includes(channel)
    ? channels.filter((value) => value !== channel)
    : [...channels, channel];
}

export function joinJobChannels(channels: string[], customChannel = ''): string {
  const custom = customChannel.trim();
  return Array.from(new Set([...channels, custom].filter(Boolean))).join(',');
}

export default function StoryJobIntakePrompt() {
  const confirmedIntent = useConfirmedIntent();
  const { setConfirmedIntent } = useStoryAgentActions();
  const [targetRoleInput, setTargetRoleInput] = useState('');
  const [selectedChannels, setSelectedChannels] = useState<string[]>(() =>
    splitJobChannels(confirmedIntent?.channel),
  );
  const [customChannelInput, setCustomChannelInput] = useState('');
  const step = getJobIntakeStep(confirmedIntent);

  if (!confirmedIntent || step === 'none' || step === 'done') return null;

  const updateIntent = (
    patch:
      | Pick<StoryIntent, 'targetRole'>
      | Pick<StoryIntent, 'channel'>
      | Pick<StoryIntent, 'jobMaterialsPrompted'>,
  ) => {
    setConfirmedIntent(mergeJobIntentField(confirmedIntent, patch));
  };

  const submitTargetRole = () => {
    updateIntent({ targetRole: targetRoleInput.trim() });
  };
  const submitCustomChannel = () => {
    updateIntent({ channel: joinJobChannels(selectedChannels, customChannelInput) });
  };
  const skipChannel = () => {
    updateIntent({ channel: '' });
  };

  return (
    <div className="flex justify-start" data-testid="story-job-intake">
      <div
        className="max-w-[85%] rounded-2xl rounded-tl-sm border px-3 py-2.5 text-[12.5px] leading-relaxed"
        style={{
          background: 'var(--card)',
          borderColor: 'var(--nayin-accent-dim)',
          color: 'var(--foreground)',
        }}
      >
        <div className="mb-2 flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground opacity-80">
          <Briefcase className="h-3 w-3 text-nayin-bright" />
          求职片轻问
        </div>

        {step === 'targetRole' ? (
          <div className="flex flex-col gap-2">
            <p>
              那我先按求职片来帮你。目标岗位或行业大概是什么？
            </p>
            <div className="flex items-center gap-2">
              <input
                value={targetRoleInput}
                onChange={(event) => setTargetRoleInput(event.target.value)}
                placeholder="比如 产品经理 / 影视美术 / AI 设计"
                className="min-w-0 flex-1 rounded-md border bg-transparent px-2 py-1.5 text-[11px] focus:outline-none focus:ring-1"
                style={{
                  borderColor: 'var(--panel-border)',
                  // @ts-expect-error custom prop for tailwind ring color via inline style
                  '--tw-ring-color': 'var(--nayin-accent)',
                }}
              />
              <button
                type="button"
                onClick={submitTargetRole}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-background/60"
                aria-label="记下目标岗位"
                title="记下目标岗位"
              >
                <Check className="h-3.5 w-3.5 text-nayin-bright" />
              </button>
            </div>
            <button
              type="button"
              onClick={() => updateIntent({ targetRole: '' })}
              className="self-start text-[10px] text-muted-foreground transition-colors hover:text-foreground"
            >
              先跳过，后面聊到再补
            </button>
          </div>
        ) : step === 'channel' ? (
          <div className="flex flex-col gap-2">
            <p>
              这份简历主要准备投到哪里？可以多选，我会据此拿捏正式度和节奏。
            </p>
            <div className="flex flex-wrap gap-1.5">
              {JOB_CHANNEL_OPTIONS.map((option) => {
                const selected = selectedChannels.includes(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setSelectedChannels((channels) => toggleJobChannel(channels, option.value))}
                    aria-pressed={selected}
                    className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-left text-[11px] transition-colors hover:bg-background/50 focus:outline-none focus:ring-1"
                    style={{
                      borderColor: selected ? 'var(--nayin-accent)' : 'var(--panel-border)',
                      background: selected ? 'var(--nayin-glow)' : 'transparent',
                      color: selected ? 'var(--foreground)' : undefined,
                      // @ts-expect-error custom prop for tailwind ring color via inline style
                      '--tw-ring-color': 'var(--nayin-accent)',
                    }}
                  >
                    {selected ? (
                      <Check className="h-3 w-3 shrink-0 text-nayin-bright" />
                    ) : (
                      <CornerDownRight className="h-3 w-3 shrink-0 text-nayin-bright" />
                    )}
                    {option.label}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2">
              <input
                value={customChannelInput}
                onChange={(event) => setCustomChannelInput(event.target.value)}
                placeholder="其他投放场景"
                className="min-w-0 flex-1 rounded-md border bg-transparent px-2 py-1.5 text-[11px] focus:outline-none focus:ring-1"
                style={{
                  borderColor: 'var(--panel-border)',
                  // @ts-expect-error custom prop for tailwind ring color via inline style
                  '--tw-ring-color': 'var(--nayin-accent)',
                }}
              />
              <button
                type="button"
                onClick={submitCustomChannel}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-background/60"
                aria-label="记下投递渠道"
                title="记下投递渠道"
              >
                <Check className="h-3.5 w-3.5 text-nayin-bright" />
              </button>
            </div>
            <button
              type="button"
              onClick={skipChannel}
              className="self-start text-[10px] text-muted-foreground transition-colors hover:text-foreground"
            >
              先跳过投递渠道
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p>
              接下来你可以直接把 JD 或简历贴过来。小酌会先站在招聘者视角看：岗位要什么、你简历里哪些经历能证明、还缺哪几个关键问题。
            </p>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => updateIntent({ jobMaterialsPrompted: true })}
                className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] transition-colors hover:bg-background/50 focus:outline-none focus:ring-1"
                style={{
                  borderColor: 'var(--panel-border)',
                  // @ts-expect-error custom prop for tailwind ring color via inline style
                  '--tw-ring-color': 'var(--nayin-accent)',
                }}
              >
                <Check className="h-3 w-3 text-nayin-bright" />
                好，我贴 JD / 简历
              </button>
              <button
                type="button"
                onClick={() => updateIntent({ jobMaterialsPrompted: true })}
                className="text-[10px] text-muted-foreground transition-colors hover:text-foreground"
              >
                先继续聊
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
