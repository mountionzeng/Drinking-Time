/**
 * StoryIntentGate — 生成剧本前的意图确认关。
 *
 * 模型(2026-06-14 brainstorm 锁定):情绪流动为主轴,但「同一段情绪,意图不同,
 * 渲染方式天差地别」——给 friends 的抖音 15 秒 vs 给 recruiters 的作品集短片,
 * 节奏/构图/精致度完全两套。所以出剧本前先把意图钉死。
 *
 * 交互(hybrid):点「识别意图」→ 跑 server recognizeIntent(意图大脑一直在)→
 * 摆出识别到的 purpose/audience/platform/tone(+ 不确定时的反问)→ 用户确认或改
 * purpose → onConfirm。确认后「生成剧本」才按这个意图走。
 */
import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Loader2, Sparkles, Check, Pencil } from 'lucide-react';

export interface StoryIntent {
  purpose: string;
  audience: string;
  platform: string;
  desiredEffect: string;
  tone: string;
  confidence: number;
  missingQuestion: string;
  evidence?: string[];
  configured?: boolean;
}

// purpose 的友好中文标签(含本次新增的两类)
const PURPOSE_LABELS: Record<string, string> = {
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

const AUDIENCE_LABELS: Record<string, string> = {
  self: '自己', specific_person: '某个人', friends: '朋友', public: '大众',
  recruiters: '招聘者', clients: '客户', investors: '投资人', teammates: '团队', unknown: '待定',
};

interface Props {
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  confirmedIntent: StoryIntent | null;
  onConfirm: (intent: StoryIntent) => void;
  onClear: () => void;
}

export default function StoryIntentGate({ history, confirmedIntent, onConfirm, onClear }: Props) {
  const recognizeMut = trpc.storyAgent.recognizeIntent.useMutation();
  const [draft, setDraft] = useState<StoryIntent | null>(null);

  const recognize = async () => {
    try {
      const res = await recognizeMut.mutateAsync({ history });
      setDraft(res as StoryIntent);
    } catch {
      /* 失败时静默,用户可重试;不阻断生成剧本 */
    }
  };

  // 已确认:收成一行,显示确认过的意图,可重新识别
  if (confirmedIntent && !draft) {
    return (
      <div
        className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-[10px]"
        style={{ borderColor: 'var(--nayin-accent-dim)', background: 'var(--nayin-glow)' }}
      >
        <Check className="h-3 w-3 shrink-0 text-nayin-bright" />
        <span className="text-foreground/80">
          意图已确认：<b>{PURPOSE_LABELS[confirmedIntent.purpose] ?? confirmedIntent.purpose}</b>
          {' · 给'}{AUDIENCE_LABELS[confirmedIntent.audience] ?? confirmedIntent.audience}{'看'}
        </span>
        <button
          type="button"
          onClick={() => { onClear(); setDraft(confirmedIntent); }}
          className="ml-auto flex items-center gap-0.5 text-muted-foreground hover:text-foreground transition-colors"
        >
          <Pencil className="h-2.5 w-2.5" /> 改
        </button>
      </div>
    );
  }

  // 未识别:一个触发按钮(放在生成剧本上方)
  if (!draft) {
    return (
      <button
        type="button"
        onClick={recognize}
        disabled={recognizeMut.isPending || history.length === 0}
        className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed py-2 text-[11px] font-medium transition disabled:opacity-50"
        style={{ borderColor: 'var(--panel-border)', color: 'var(--nayin-accent-bright)' }}
        title="出剧本前先确认这片子给谁看、为什么拍"
      >
        {recognizeMut.isPending ? (
          <><Loader2 className="h-3.5 w-3.5 animate-spin" /> 小酌在判断意图…</>
        ) : (
          <><Sparkles className="h-3.5 w-3.5" /> 识别拍摄意图（出剧本前确认）</>
        )}
      </button>
    );
  }

  // 已识别:摆出来让用户确认 / 改 purpose
  return (
    <div
      className="flex flex-col gap-1.5 rounded-md border p-2.5"
      style={{ borderColor: 'var(--nayin-accent-dim)', background: 'var(--card)' }}
    >
      <div className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
        确认意图 · 出剧本前
      </div>

      <label className="flex items-center gap-2 text-[11px]">
        <span className="shrink-0 text-muted-foreground">这是个</span>
        <select
          value={draft.purpose}
          onChange={(e) => setDraft({ ...draft, purpose: e.target.value })}
          className="flex-1 rounded border bg-transparent px-1.5 py-1 text-[11px] text-foreground focus:outline-none focus:ring-1"
          style={{ borderColor: 'var(--panel-border)' }}
        >
          {Object.entries(PURPOSE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>

      <div className="text-[10px] leading-relaxed text-muted-foreground">
        给 <b className="text-foreground/80">{AUDIENCE_LABELS[draft.audience] ?? draft.audience}</b> 看
        {draft.platform && draft.platform !== 'unknown' ? ` · 发 ${draft.platform}` : ''}
        {draft.tone ? ` · 调性「${draft.tone}」` : ''}
      </div>

      {draft.missingQuestion?.trim() && (
        <div className="text-[10px] text-nayin-bright">小酌想确认：{draft.missingQuestion}</div>
      )}
      {draft.configured === false && (
        <div className="text-[9px] text-muted-foreground/70">（未配 API，按本地规则粗判，可手动改）</div>
      )}

      <button
        type="button"
        onClick={() => { onConfirm(draft); setDraft(null); }}
        className="mt-0.5 flex items-center justify-center gap-1 rounded-md py-1.5 text-[11px] font-medium"
        style={{ background: 'var(--nayin-accent)', color: 'var(--background)' }}
      >
        <Check className="h-3 w-3" /> 确认，按这个意图写剧本
      </button>
    </div>
  );
}
