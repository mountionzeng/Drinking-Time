import { ArrowRight, Check, Loader2, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  defaultPublishingNarrativeIntent,
  publishingNarrativePurposeLabel,
  type PublishingNarrativeIntent,
  type PublishingNarrativePurpose,
} from "@shared/publishingDraft";
import type { StoryIntent } from "@/features/storyAgent/intentTypes";
import { AUDIENCE_LABELS } from "@/features/storyAgent/intentTypes";

type PublishingIntentProposalPresentation = "dialog" | "inline";

const LEGACY_PURPOSE_TO_NARRATIVE: Record<string, PublishingNarrativePurpose> = {
  self_reflection: "preserve",
  raw_record: "preserve",
  personal_memory: "preserve",
  relationship_record: "preserve",
  gift: "gift",
  social_post: "share",
  linkedin_job_search: "persuade",
  portfolio: "persuade",
  product_intro: "persuade",
  fiction: "create",
  creative_expression: "create",
};

export function publishingNarrativeIntentFromStoryIntent(
  intent: StoryIntent,
  fallback = defaultPublishingNarrativeIntent(),
  now = Date.now()
): PublishingNarrativeIntent {
  const primaryPurpose = intent.primaryPurpose ??
    LEGACY_PURPOSE_TO_NARRATIVE[intent.purpose] ??
    fallback.primaryPurpose;
  const coreAudience = intent.coreAudience?.trim() ||
    AUDIENCE_LABELS[intent.audience] ||
    intent.audience.trim() ||
    fallback.coreAudience;
  return {
    primaryPurpose,
    secondaryPurposes: (intent.secondaryPurposes ?? [])
      .filter(purpose => purpose !== primaryPurpose)
      .slice(0, 4),
    coreAudience,
    secondaryAudiences: (intent.secondaryAudiences ?? [])
      .map(value => value.trim())
      .filter(Boolean)
      .filter(value => value !== coreAudience)
      .slice(0, 5),
    status: "confirmed",
    updatedAt: now,
  };
}

type IntentLine = {
  label: string;
  from: string;
  to: string;
  changed: boolean;
};

function inlineIntentCopy(intent: PublishingNarrativeIntent): {
  title: string;
  accept: string;
} {
  if (intent.primaryPurpose === "persuade" && intent.coreAudience === "招聘者") {
    return { title: "听起来你是想做求职片", accept: "对，按求职片来" };
  }
  if (intent.primaryPurpose === "create") {
    return { title: "听起来你是想创造一个虚构故事世界", accept: "对，创造另一个世界" };
  }
  if (intent.primaryPurpose === "share") {
    return { title: "听起来你是想发社交文案", accept: "对，按社交发布来" };
  }
  if (intent.primaryPurpose === "gift") {
    return { title: "听起来你是想做一份送给亲友的礼物", accept: "对，按亲友礼物来" };
  }
  return { title: "听起来你是想先把这段故事留给自己", accept: "对，按留存来" };
}

export function publishingIntentDiff(
  current: PublishingNarrativeIntent,
  proposed: PublishingNarrativeIntent
): IntentLine[] {
  const lines = [
    {
      label: "主要目的",
      from: publishingNarrativePurposeLabel(current.primaryPurpose),
      to: publishingNarrativePurposeLabel(proposed.primaryPurpose),
    },
    {
      label: "最优先给谁看",
      from: current.coreAudience || "待确认",
      to: proposed.coreAudience || "待确认",
    },
    {
      label: "兼顾目的",
      from: current.secondaryPurposes.map(publishingNarrativePurposeLabel).join("、") || "无",
      to: proposed.secondaryPurposes.map(publishingNarrativePurposeLabel).join("、") || "无",
    },
    {
      label: "兼顾观众",
      from: current.secondaryAudiences.join("、") || "无",
      to: proposed.secondaryAudiences.join("、") || "无",
    },
  ];
  return lines.map(line => ({ ...line, changed: line.from !== line.to }));
}

export function PublishingIntentProposalDialog({
  open,
  current,
  proposed,
  evidence = [],
  hasPublishingVersion,
  busy,
  onOpenChange,
  onAccept,
  onReject,
  acceptLabel,
  presentation = "dialog",
}: {
  open: boolean;
  current: PublishingNarrativeIntent;
  proposed: PublishingNarrativeIntent;
  evidence?: string[];
  hasPublishingVersion: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onAccept: () => void;
  onReject: () => void;
  acceptLabel?: string;
  presentation?: PublishingIntentProposalPresentation;
}) {
  const differences = publishingIntentDiff(current, proposed);
  const changed = differences.filter(line => line.changed);
  if (presentation === "inline") {
    const copy = inlineIntentCopy(proposed);
    return (
      <section
        className="rounded-lg border px-3 py-2.5 text-[12px] leading-relaxed"
        style={{ borderColor: "var(--panel-border)", background: "var(--panel-header)" }}
        aria-label="用途变化建议"
      >
        <p className="font-medium text-foreground">{copy.title}</p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {changed.length > 0
            ? changed.map(line => `${line.label}：${line.from} → ${line.to}`).join("；")
            : "我会先把这个判断当成建议，仍由你确认。"}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onAccept}
            disabled={busy}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--nayin-accent)] px-2.5 text-[11px] font-medium text-background disabled:opacity-45"
          >
            <Check className="h-3.5 w-3.5" />
            {acceptLabel ?? copy.accept}
          </button>
          <button
            type="button"
            onClick={onReject}
            disabled={busy}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[11px] text-muted-foreground disabled:opacity-45"
            style={{ borderColor: "var(--panel-border)" }}
          >
            <X className="h-3.5 w-3.5" />
            先不，继续聊
          </button>
        </div>
      </section>
    );
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>写作目的好像变了，要开一个新版本吗？</DialogTitle>
          <DialogDescription>
            {hasPublishingVersion
              ? "接受后会先处理当前未应用修改，再创建新版本；旧版本的文字、封面和故事版都不会被覆盖。"
              : "这是建议，不会自动生成文字稿。接受后只确认用途和观众。"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-1" aria-label="意图变化对比">
          {(changed.length > 0 ? changed : differences.slice(0, 2)).map(line => (
            <div
              key={line.label}
              className="grid grid-cols-[5.5rem_1fr] gap-2 rounded-lg border px-3 py-2 text-xs"
              style={{ borderColor: "var(--panel-border)" }}
            >
              <span className="text-muted-foreground">{line.label}</span>
              <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-foreground">
                <span className="line-through opacity-55">{line.from}</span>
                <ArrowRight className="h-3 w-3 shrink-0 text-[var(--nayin-accent)]" />
                <strong className="font-medium">{line.to}</strong>
              </span>
            </div>
          ))}
        </div>

        {evidence.length > 0 ? (
          <details className="rounded-md bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
            <summary className="cursor-pointer font-medium text-foreground">
              为什么这样判断
            </summary>
            <ul className="mt-2 list-disc space-y-1 pl-4">
              {evidence.slice(0, 5).map((item, index) => (
                <li key={`${index}:${item}`}>{item}</li>
              ))}
            </ul>
          </details>
        ) : null}

        <DialogFooter>
          <button
            type="button"
            onClick={onReject}
            disabled={busy}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35 disabled:opacity-45"
            style={{ borderColor: "var(--panel-border)" }}
          >
            <X className="h-3.5 w-3.5" />
            不采用这次建议
          </button>
          <button
            type="button"
            onClick={onAccept}
            disabled={busy}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[var(--nayin-accent)] px-3 text-xs font-medium text-background hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35 disabled:opacity-45"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            {acceptLabel ??
              (hasPublishingVersion ? "确认并创建新版本" : "确认这个目的")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
