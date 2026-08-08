import { useCallback, type ReactNode } from "react";
import { Check, CircleDot } from "lucide-react";
import { toast } from "sonner";
import {
  useStoryAgent,
  useStoryAgentActions,
} from "@/features/storyAgent/StoryAgentContext";
import { trpc } from "@/lib/trpc";
import { storySpineStore } from "@/features/storyAgent/spine/storySpine";
import {
  PUBLISHING_PLATFORM_IDS,
  PUBLISHING_PLATFORM_REGISTRY,
  type PublishingPlatformId,
} from "@shared/publishingDraft";
import {
  publishingStoryScopeMatches,
  updatePublishingSelection,
} from "./publishingDraftViewModel";

type PublishingPlatformPickerViewProps = {
  activePlatform: PublishingPlatformId;
  selectedPlatforms: PublishingPlatformId[];
  onActivePlatformChange: (platform: PublishingPlatformId) => void;
  onToggleTarget: (platform: PublishingPlatformId) => void;
  disabled?: boolean;
  compact?: boolean;
};

export function PublishingPlatformPickerView({
  activePlatform,
  selectedPlatforms,
  onActivePlatformChange,
  onToggleTarget,
  disabled = false,
  compact = false,
}: PublishingPlatformPickerViewProps) {
  return (
    <section
      className="space-y-2"
      aria-label="发布平台设置"
      data-testid="publishing-platform-picker"
    >
      <PlatformGroup
        compact={compact}
        label="当前写作平台"
        hint={compact ? undefined : "选择不会自动生成"}
        ariaLabel="当前写作平台"
        role="radiogroup"
      >
        {PUBLISHING_PLATFORM_IDS.map(platform => {
          const adapter = PUBLISHING_PLATFORM_REGISTRY[platform];
          const active = platform === activePlatform;
          return (
            <button
              key={platform}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => onActivePlatformChange(platform)}
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full border px-2.5 text-[10.5px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35 disabled:cursor-not-allowed disabled:opacity-50"
              style={
                active
                  ? {
                      borderColor: "var(--nayin-accent)",
                      background: "var(--nayin-glow)",
                      color: "var(--foreground)",
                    }
                  : { borderColor: "var(--panel-border)" }
              }
            >
              {active ? <CircleDot className="h-3 w-3" /> : null}
              {adapter.label}
            </button>
          );
        })}
      </PlatformGroup>

      <PlatformGroup
        compact={compact}
        label="也想发布到"
        ariaLabel="也想发布到"
      >
        {PUBLISHING_PLATFORM_IDS.filter(
          platform => platform !== activePlatform
        ).map(platform => {
          const adapter = PUBLISHING_PLATFORM_REGISTRY[platform];
          const selected = selectedPlatforms.includes(platform);
          return (
            <button
              key={platform}
              type="button"
              aria-pressed={selected}
              disabled={disabled}
              onClick={() => onToggleTarget(platform)}
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-[10px] text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span
                className="flex h-3.5 w-3.5 items-center justify-center rounded-sm border"
                style={{
                  borderColor: selected
                    ? "var(--nayin-accent)"
                    : "var(--panel-border)",
                  background: selected ? "var(--nayin-accent)" : "transparent",
                  color: "var(--background)",
                }}
              >
                {selected ? <Check className="h-2.5 w-2.5" /> : null}
              </span>
              {adapter.shortLabel}
            </button>
          );
        })}
      </PlatformGroup>
    </section>
  );
}

/**
 * 两组平台选择在 compact 下各占一行：标签固定在左，选项在剩余空间里
 * 横向滚动而不是换行，六个平台也不会把面板撑成五六行。非 compact
 * 保持标签在上、选项换行在下的原布局（供未来更宽的展示位复用）。
 */
function PlatformGroup({
  compact,
  label,
  hint,
  ariaLabel,
  role,
  children,
}: {
  compact: boolean;
  label: string;
  hint?: string;
  ariaLabel: string;
  role?: "radiogroup";
  children: ReactNode;
}) {
  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <p className="shrink-0 whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </p>
        <div
          role={role}
          aria-label={ariaLabel}
          className="flex min-w-0 flex-1 flex-nowrap items-center gap-1.5 overflow-x-auto"
        >
          {children}
        </div>
      </div>
    );
  }
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </p>
        {hint ? (
          <p className="text-[10px] text-muted-foreground/80">{hint}</p>
        ) : null}
      </div>
      <div role={role} aria-label={ariaLabel} className="flex flex-wrap gap-1.5">
        {children}
      </div>
    </div>
  );
}

function socialPublishingIntent(platform: PublishingPlatformId) {
  return {
    purpose: "social_post",
    audience: "public",
    platform,
    desiredEffect: "把自己的真实想法整理成愿意公开发布的表达",
    tone: "保留个人判断和语气",
    confidence: 1,
    evidence: ["用户已主动选择发布平台"],
    missingQuestion: "",
    configured: true,
  };
}

export function usePublishingPlatformSelection() {
  const { activeStoryId, publishing } = useStoryAgent();
  const { setPublishing, setConfirmedIntent } = useStoryAgentActions();
  const selectMut = trpc.publishingDraft.selectPlatforms.useMutation();
  const utils = trpc.useUtils();

  const commitSelection = useCallback(
    async (selection: {
      activePlatform: PublishingPlatformId;
      selectedPlatforms: PublishingPlatformId[];
    }) => {
      const next = updatePublishingSelection(publishing, selection);
      setPublishing(next);
      setConfirmedIntent(socialPublishingIntent(next.activePlatform));
      if (activeStoryId == null || activeStoryId <= 0) return;
      try {
        const result = await selectMut.mutateAsync({
          storyId: activeStoryId,
          activePlatform: next.activePlatform,
          selectedPlatforms: next.selectedPlatforms,
          basePublishingRevision: publishing.revision,
        });
        if (
          !publishingStoryScopeMatches(
            activeStoryId,
            storySpineStore.getState().activeStoryId
          )
        ) {
          return;
        }
        setPublishing(result.publishing);
      } catch (error) {
        if (
          publishingStoryScopeMatches(
            activeStoryId,
            storySpineStore.getState().activeStoryId
          )
        ) {
          try {
            const latest = await utils.publishingDraft.read.fetch({
              storyId: activeStoryId,
            });
            if (
              publishingStoryScopeMatches(
                activeStoryId,
                storySpineStore.getState().activeStoryId
              )
            ) {
              setPublishing(latest.publishing);
            }
          } catch {
            // Keep the optimistic choice visible when the recovery read also fails.
          }
        }
        toast.error(
          error instanceof Error ? error.message : "平台设置暂时没有保存"
        );
      }
    },
    [
      activeStoryId,
      publishing,
      selectMut,
      setConfirmedIntent,
      setPublishing,
      utils.publishingDraft.read,
    ]
  );

  const setActivePlatform = useCallback(
    (platform: PublishingPlatformId) => {
      if (platform === publishing.activePlatform || selectMut.isPending) return;
      void commitSelection({
        activePlatform: platform,
        selectedPlatforms: publishing.selectedPlatforms,
      });
    },
    [commitSelection, publishing, selectMut.isPending]
  );

  const toggleTarget = useCallback(
    (platform: PublishingPlatformId) => {
      if (platform === publishing.activePlatform || selectMut.isPending) return;
      const selectedPlatforms = publishing.selectedPlatforms.includes(platform)
        ? publishing.selectedPlatforms.filter(
            candidate => candidate !== platform
          )
        : [...publishing.selectedPlatforms, platform];
      void commitSelection({
        activePlatform: publishing.activePlatform,
        selectedPlatforms,
      });
    },
    [commitSelection, publishing, selectMut.isPending]
  );

  return {
    activePlatform: publishing.activePlatform,
    selectedPlatforms: publishing.selectedPlatforms,
    setActivePlatform,
    toggleTarget,
    isSaving: selectMut.isPending,
  };
}

export default function PublishingPlatformPicker({
  compact = false,
}: {
  compact?: boolean;
}) {
  const selection = usePublishingPlatformSelection();
  return (
    <PublishingPlatformPickerView
      activePlatform={selection.activePlatform}
      selectedPlatforms={selection.selectedPlatforms}
      onActivePlatformChange={selection.setActivePlatform}
      onToggleTarget={selection.toggleTarget}
      disabled={selection.isSaving}
      compact={compact}
    />
  );
}
