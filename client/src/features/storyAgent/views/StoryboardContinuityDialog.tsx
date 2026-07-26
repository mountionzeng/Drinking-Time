import { useEffect, useState } from "react";
import { Check, ShieldCheck } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  ShotConsistencyFinding,
  ShotConsistencyMismatch,
} from "@shared/shotConsistency";
import { CONSISTENCY_DIMENSION_LABELS } from "@shared/shotConsistency";

const CHARACTER_DIMENSIONS = new Set(["face", "hairstyle", "clothing"]);

export type StoryboardContinuityOption = {
  key: string;
  label: string;
  detail: string;
  imageUrl: string;
  imageId?: number;
  kind: "anchor" | "current" | "version";
};

export function characterContinuityMismatches(
  finding: ShotConsistencyFinding | null | undefined
): ShotConsistencyMismatch[] {
  return (finding?.mismatches ?? []).filter(mismatch =>
    CHARACTER_DIMENSIONS.has(mismatch.dimension)
  );
}

export function storyboardContinuityOptions(input: {
  anchor: { label: string; imageUrl: string };
  frames: ReadonlyArray<{ id: number; imageUrl: string }>;
  currentImageId?: number | null;
  maxVersions?: number;
}): StoryboardContinuityOption[] {
  const options: StoryboardContinuityOption[] = [
    {
      key: "anchor",
      label: input.anchor.label || "人物基准",
      detail: "故事人物基准",
      imageUrl: input.anchor.imageUrl,
      kind: "anchor",
    },
  ];
  const seenUrls = new Set([input.anchor.imageUrl]);
  const current = input.frames.find(frame => frame.id === input.currentImageId);
  const orderedFrames = [
    ...(current ? [current] : []),
    ...[...input.frames]
      .sort((left, right) => right.id - left.id)
      .filter(frame => frame.id !== current?.id),
  ];
  for (const frame of orderedFrames) {
    if (!frame.imageUrl || seenUrls.has(frame.imageUrl)) continue;
    const isCurrent = frame.id === input.currentImageId;
    options.push({
      key: `image-${frame.id}`,
      label: isCurrent ? "当前镜头版本" : `本镜版本 #${frame.id}`,
      detail: isCurrent ? `当前主图 #${frame.id}` : `历史画面 #${frame.id}`,
      imageUrl: frame.imageUrl,
      imageId: frame.id,
      kind: isCurrent ? "current" : "version",
    });
    seenUrls.add(frame.imageUrl);
    if (options.length >= 1 + (input.maxVersions ?? 3)) break;
  }
  return options;
}

export function StoryboardContinuityDialog({
  open,
  shotLabel,
  renderKind,
  options,
  mismatches,
  onChoose,
  onCancel,
}: {
  open: boolean;
  shotLabel: string;
  renderKind: "image" | "video";
  options: StoryboardContinuityOption[];
  mismatches: ShotConsistencyMismatch[];
  onChoose: (option: StoryboardContinuityOption) => void;
  onCancel: () => void;
}) {
  const preferredKey =
    options.find(option => option.kind === "anchor")?.key ??
    options[0]?.key ??
    "";
  const [selectedKey, setSelectedKey] = useState(preferredKey);

  useEffect(() => {
    if (open) setSelectedKey(preferredKey);
  }, [open, preferredKey]);

  const selected =
    options.find(option => option.key === selectedKey) ?? options[0];
  const mismatchLabels = Array.from(
    new Set(
      mismatches.map(
        mismatch => CONSISTENCY_DIMENSION_LABELS[mismatch.dimension]
      )
    )
  );

  return (
    <Dialog open={open} onOpenChange={nextOpen => !nextOpen && onCancel()}>
      <DialogContent className="max-w-[calc(100vw-1rem)] gap-3 rounded-md p-4 duration-0 sm:max-w-xl">
        <DialogHeader className="gap-1 pr-7">
          <DialogTitle className="flex items-center gap-2 text-sm">
            <ShieldCheck className="h-4 w-4 text-amber-600" />
            先确认人物版本
          </DialogTitle>
          <DialogDescription className="text-xs leading-5">
            {shotLabel} 的{mismatchLabels.join("、") || "人物外观"}
            与人物基准不一致。请选择本次
            {renderKind === "image" ? "图片" : "视频"}要遵循的版本。
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {options.map(option => {
            const selectedOption = option.key === selectedKey;
            return (
              <button
                key={option.key}
                type="button"
                onClick={() => setSelectedKey(option.key)}
                aria-pressed={selectedOption}
                className={`min-w-0 overflow-hidden rounded-md border bg-background text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/40 ${
                  selectedOption
                    ? "border-[var(--nayin-accent)]"
                    : "border-border hover:border-foreground/35"
                }`}
              >
                <div className="relative aspect-square overflow-hidden bg-muted">
                  <img
                    src={option.imageUrl}
                    alt={option.label}
                    className="h-full w-full object-cover"
                  />
                  {selectedOption ? (
                    <span className="absolute right-1.5 top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-[var(--nayin-accent)] text-white">
                      <Check className="h-3 w-3" />
                    </span>
                  ) : null}
                </div>
                <span className="block px-2 py-1.5">
                  <span className="block truncate text-[11px] font-semibold text-foreground">
                    {option.label}
                  </span>
                  <span className="block truncate text-[9px] text-muted-foreground">
                    {option.detail}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="space-y-1 text-[10px] leading-4 text-muted-foreground">
          {mismatches.slice(0, 3).map(mismatch => (
            <p key={`${mismatch.dimension}:${mismatch.note}`}>
              <span className="font-medium text-foreground">
                {CONSISTENCY_DIMENSION_LABELS[mismatch.dimension]}：
              </span>
              {mismatch.note}
            </p>
          ))}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-8 items-center justify-center rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            取消
          </button>
          <button
            type="button"
            disabled={!selected}
            onClick={() => selected && onChoose(selected)}
            className="inline-flex h-8 items-center justify-center rounded-md bg-[var(--nayin-accent)] px-3 text-xs font-semibold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/45 disabled:opacity-50"
          >
            按这一版继续
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
