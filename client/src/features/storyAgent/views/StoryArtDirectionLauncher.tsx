import { useState } from "react";
import {
  Check,
  Heart,
  Images,
  Lock,
  Palette,
  Sparkles,
} from "lucide-react";
import type { StoryArtDirectionPhase } from "@shared/artDirection";
import { useStoryAgent } from "@/features/storyAgent/StoryAgentContext";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import StoryArtDirectionStudio from "./StoryArtDirectionStudio";
import DrawThisMomentPanel from "./DrawThisMomentPanel";

type EntryCopy = {
  label: string;
  detail: string;
};

export function artStudioEntryCopy(
  phase: StoryArtDirectionPhase,
  cardCount: number,
  isWorking: boolean,
): EntryCopy {
  if (isWorking || phase === "generating") {
    return {
      label: "正在生成 6 张独立图片",
      detail: "保持故事不变，只比较画法",
    };
  }
  if (cardCount === 0) {
    return {
      label: "先聊出一个故事画面",
      detail: "有具体场景后即可出图",
    };
  }
  if (phase === "references") {
    return {
      label: "生成 6 张独立图片",
      detail: "先确认照片与故事材料",
    };
  }
  if (phase === "selecting") {
    return {
      label: "筛选 6 张画面",
      detail: "喜欢与淘汰会形成审美倾向",
    };
  }
  if (phase === "recipe-review") {
    return {
      label: "确认视觉配方",
      detail: "锁定后整篇故事保持一致",
    };
  }
  if (phase === "locked") {
    return {
      label: "视觉风格已锁定",
      detail: "后续画面沿用这套美术倾向",
    };
  }
  return {
    label: "生成画面",
    detail: "从已有照片和故事材料开始",
  };
}

function PhaseMark({
  active,
  done,
  icon,
  label,
}: {
  active: boolean;
  done: boolean;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <div
      className="flex min-w-0 flex-1 items-center gap-1.5 text-[10px] font-medium"
      style={{
        color:
          active || done
            ? "var(--nayin-accent-bright)"
            : "var(--muted-foreground)",
      }}
    >
      <span
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border"
        style={{
          borderColor:
            active || done ? "var(--nayin-accent)" : "var(--panel-border)",
          background:
            active || done ? "var(--nayin-glow)" : "var(--background)",
        }}
      >
        {done ? <Check className="h-3 w-3" /> : icon}
      </span>
      <span className="truncate">{label}</span>
    </div>
  );
}

export default function StoryArtDirectionLauncher() {
  const {
    artDirection,
    cards,
    prepareArtDirection,
  } = useStoryAgent();
  const [open, setOpen] = useState(false);
  const [drawOpen, setDrawOpen] = useState(false);

  const phaseIndex =
    artDirection.phase === "empty"
      ? 0
      : artDirection.phase === "references" ||
          artDirection.phase === "generating"
        ? 1
        : artDirection.phase === "selecting"
          ? 2
          : 3;

  // 主入口：把这一刻画出来（单图，故事页已对齐故事，无需手动选）。
  const openDraw = () => {
    if (cards.length === 0) return;
    setDrawOpen(true);
  };

  // 进阶入口：6 张候选探索 / 锁定整篇视觉风格（保留但不再是主路径）。
  const openStudio = () => {
    if (cards.length === 0) return;
    if (artDirection.phase === "empty") prepareArtDirection();
    setOpen(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={openDraw}
        disabled={cards.length === 0}
        className="mt-2.5 flex w-full items-center gap-2.5 rounded-md border px-3 py-2 text-left transition hover:bg-[var(--nayin-glow)] disabled:cursor-not-allowed disabled:opacity-55"
        style={{
          borderColor: "var(--panel-border)",
          background: "var(--panel-header)",
        }}
        aria-label="把这一刻画出来"
      >
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
          style={{
            background: "var(--nayin-accent)",
            color: "var(--background)",
          }}
        >
          <Sparkles className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-semibold text-foreground">
            {cards.length === 0 ? "先聊出一个故事画面" : "把这一刻画出来"}
          </span>
          <span className="mt-0.5 block truncate text-[9px] text-muted-foreground">
            {cards.length === 0 ? "有具体场景后即可出图" : "出一张，满意就收下，不满意再来一张"}
          </span>
        </span>
        <Sparkles className="h-4 w-4 shrink-0 text-nayin-bright" />
      </button>

      {/* 进阶：6 张候选探索 / 锁定整篇视觉风格 */}
      {cards.length > 0 ? (
        <button
          type="button"
          onClick={openStudio}
          className="mt-1.5 flex w-full items-center justify-center gap-1.5 text-[10px] text-muted-foreground transition hover:text-foreground"
        >
          {artDirection.phase === "locked" ? (
            <Lock className="h-3 w-3" />
          ) : (
            <Images className="h-3 w-3" />
          )}
          {artDirection.phase === "locked"
            ? "视觉风格已锁定 · 重新探索"
            : "或用 6 张候选锁定整篇视觉风格（进阶）"}
        </button>
      ) : null}

      {/* 把这一刻画出来：单图 swipe 面板 */}
      <Dialog open={drawOpen} onOpenChange={setDrawOpen}>
        <DialogContent className="flex max-w-[min(640px,calc(100%-1rem))] flex-col gap-0 overflow-hidden p-0">
          <DialogHeader
            className="shrink-0 border-b px-4 py-3 pr-12 text-left"
            style={{ borderColor: "var(--panel-border)" }}
          >
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Sparkles className="h-4 w-4 text-nayin-bright" />
              把这一刻画出来
            </DialogTitle>
            <DialogDescription className="text-[10px]">
              出一张 → 满意「收下」成为故事画面，不满意「再来一张」直到满意
            </DialogDescription>
          </DialogHeader>
          {drawOpen ? <DrawThisMomentPanel onDone={() => setDrawOpen(false)} /> : null}
        </DialogContent>
      </Dialog>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex h-[min(92dvh,860px)] max-w-[min(960px,calc(100%-1rem))] grid-rows-none flex-col gap-0 overflow-hidden p-0">
          <DialogHeader
            className="shrink-0 border-b px-4 py-3 pr-12 text-left"
            style={{ borderColor: "var(--panel-border)" }}
          >
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Palette className="h-4 w-4 text-nayin-bright" />
              画面工坊
            </DialogTitle>
            <DialogDescription className="text-[10px]">
              参考材料 → 6 张独立图片 → 喜欢 / 淘汰 → 锁定故事风格
            </DialogDescription>
            <div className="mt-2 flex items-center gap-2">
              <PhaseMark
                active={phaseIndex === 1}
                done={phaseIndex > 1}
                icon={<Images className="h-3 w-3" />}
                label="参考"
              />
              <PhaseMark
                active={phaseIndex === 2}
                done={phaseIndex > 2}
                icon={<Heart className="h-3 w-3" />}
                label="筛选"
              />
              <PhaseMark
                active={phaseIndex === 3}
                done={artDirection.phase === "locked"}
                icon={<Lock className="h-3 w-3" />}
                label="锁定"
              />
            </div>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto py-2 custom-scrollbar">
            <StoryArtDirectionStudio />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
