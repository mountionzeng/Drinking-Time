import type { StoryTimelineVisualClip } from "@shared/storyMaterial";

import {
  clampStoryboardDurationMs,
  formatStoryboardTimestamp,
  type StoryboardTimingRow,
} from "@/features/storyAgent/storyboardTiming";

/** 短于这个长度的拖拽当成「点一下定位」，而不是「选一段」。 */
export const STORYBOARD_EDIT_MIN_SELECTION_MS = 80;

/** 走带和微调时长的最小步长，按 30fps 算一帧。 */
export const STORYBOARD_EDIT_FRAME_MS = 1000 / 30;

export type StoryboardEditSegment = {
  id: string;
  kind: "primary" | "clip";
  leftPct: number;
  widthPct: number;
  label: string;
  clip: StoryTimelineVisualClip | null;
};

export type StoryboardEditRange = {
  startMs: number;
  endMs: number;
};

/** 剪辑条上的一个镜头块：位置和宽度都按时长在整条里的占比算。 */
export type StoryboardEditBlock = {
  timing: StoryboardTimingRow;
  leftPct: number;
  widthPct: number;
};

/** 把鼠标横坐标换算成整条时间线上的绝对毫秒。 */
export function storyboardEditTrackMs(input: {
  clientX: number;
  rectLeft: number;
  rectWidth: number;
  totalMs: number;
}): number {
  if (!(input.rectWidth > 0) || !(input.totalMs > 0)) return 0;
  const ratio = (input.clientX - input.rectLeft) / input.rectWidth;
  return Math.min(
    input.totalMs,
    Math.max(0, Math.round(ratio * input.totalMs))
  );
}

/**
 * 剪辑条不跟镜头列对齐，它按时间等比铺满一整行：
 * 长镜头就宽，短镜头就窄，和上面固定列宽的镜头信息靠编号与选中状态关联。
 */
export function storyboardEditBlocks(
  timings: readonly StoryboardTimingRow[],
  totalMs: number
): StoryboardEditBlock[] {
  if (!(totalMs > 0)) return [];
  return timings.map(timing => ({
    timing,
    leftPct: (timing.startMs / totalMs) * 100,
    widthPct: (timing.durationMs / totalMs) * 100,
  }));
}

/** 拖右边缘改时长：时间条上横向走多少像素，就等价于多少毫秒。 */
export function storyboardTrimmedDurationMs(input: {
  baseDurationMs: number;
  trackWidthPx: number;
  totalMs: number;
  deltaPx: number;
}): number {
  if (!(input.trackWidthPx > 0) || !(input.totalMs > 0)) {
    return clampStoryboardDurationMs(input.baseDurationMs);
  }
  const deltaMs = (input.deltaPx / input.trackWidthPx) * input.totalMs;
  return clampStoryboardDurationMs(input.baseDurationMs + deltaMs);
}

/**
 * 一个镜头块内部画成哪些段：主画面铺满，视频片段按 offset 叠在上面。
 * 片段完全替代主画面时（visualClipsReplacePrimary）就不画主画面段。
 */
export function storyboardEditSegments(input: {
  durationMs: number;
  label: string;
  visualClips?: readonly StoryTimelineVisualClip[] | null;
  visualClipsReplacePrimary?: boolean;
}): StoryboardEditSegment[] {
  const durationMs = Math.max(1, input.durationMs);
  const clips = [...(input.visualClips ?? [])].sort(
    (left, right) => left.offsetMs - right.offsetMs
  );
  const clipSegments = clips.flatMap<StoryboardEditSegment>(clip => {
    const leftPct = Math.min(
      100,
      Math.max(0, (clip.offsetMs / durationMs) * 100)
    );
    const widthPct = Math.min(
      100 - leftPct,
      Math.max(0, (clip.durationMs / durationMs) * 100)
    );
    if (widthPct <= 0) return [];
    return [
      {
        id: clip.id,
        kind: "clip",
        leftPct,
        widthPct,
        label: clip.label,
        clip,
      },
    ];
  });
  if (input.visualClipsReplacePrimary && clipSegments.length > 0) {
    return clipSegments;
  }
  return [
    {
      id: "primary",
      kind: "primary",
      leftPct: 0,
      widthPct: 100,
      label: input.label,
      clip: null,
    },
    ...clipSegments,
  ];
}

/** 拖出来的区间；太短就返回 null，让调用方按「点一下」处理。 */
export function storyboardEditSelectionRange(
  anchorMs: number,
  focusMs: number
): StoryboardEditRange | null {
  const startMs = Math.min(anchorMs, focusMs);
  const endMs = Math.max(anchorMs, focusMs);
  return endMs - startMs < STORYBOARD_EDIT_MIN_SELECTION_MS
    ? null
    : { startMs, endMs };
}

/** 选区在整条时间线上的位置，用来画高亮；空区间返回 null。 */
export function storyboardEditRangePct(
  range: StoryboardEditRange,
  totalMs: number
): { leftPct: number; widthPct: number } | null {
  if (!(totalMs > 0)) return null;
  const startMs = Math.max(0, Math.min(range.startMs, totalMs));
  const endMs = Math.max(startMs, Math.min(range.endMs, totalMs));
  if (endMs <= startMs) return null;
  return {
    leftPct: (startMs / totalMs) * 100,
    widthPct: ((endMs - startMs) / totalMs) * 100,
  };
}

/** 播放头在整条时间线上的位置。 */
export function storyboardEditPlayheadPct(
  playheadMs: number,
  totalMs: number
): number | null {
  if (!(totalMs > 0) || playheadMs < 0 || playheadMs > totalMs) return null;
  return (playheadMs / totalMs) * 100;
}

/** 键盘微调时长：在故事版允许的范围内加减，取整到毫秒。 */
export function storyboardEditNudgedDurationMs(
  baseDurationMs: number,
  deltaMs: number
): number {
  return Math.round(clampStoryboardDurationMs(baseDurationMs + deltaMs));
}

/** 走带：在 [0, totalMs] 里挪播放头。 */
export function storyboardEditSeekMs(
  playheadMs: number,
  deltaMs: number,
  totalMs: number
): number {
  return Math.max(0, Math.min(totalMs, Math.round(playheadMs + deltaMs)));
}

/**
 * 跳到上一个／下一个剪辑点（镜头的开头）。主流剪辑软件的上下方向键就是这个，
 * 比一帧一帧挪快得多。往回跳时容差 1 帧，免得刚跳过去就被自己挡住。
 */
export function storyboardEditEdgeMs(
  timings: readonly StoryboardTimingRow[],
  playheadMs: number,
  direction: "prev" | "next"
): number | null {
  const edges = [
    ...timings.map(timing => timing.startMs),
    timings.at(-1)?.endMs,
  ]
    .filter((edge): edge is number => typeof edge === "number")
    .sort((left, right) => left - right);
  if (direction === "next") {
    return edges.find(edge => edge > playheadMs + 1) ?? null;
  }
  return (
    [...edges]
      .reverse()
      .find(edge => edge < playheadMs - STORYBOARD_EDIT_FRAME_MS) ?? null
  );
}

/** 左边／右边紧挨着的那一镜，用来做「前移一位 / 后移一位」。 */
export function storyboardEditNeighborShotId(
  timings: readonly StoryboardTimingRow[],
  stableShotId: string,
  direction: "prev" | "next"
): string | null {
  const index = timings.findIndex(
    timing => timing.stableShotId === stableShotId
  );
  if (index < 0) return null;
  return (
    timings[direction === "prev" ? index - 1 : index + 1]?.stableShotId ?? null
  );
}

/** 落在这个时间点上的镜头。 */
export function storyboardEditTimingAt(
  timings: readonly StoryboardTimingRow[],
  timeMs: number
): StoryboardTimingRow | null {
  return (
    timings.find(timing => timeMs >= timing.startMs && timeMs < timing.endMs) ??
    (timings.at(-1)?.endMs === timeMs ? (timings.at(-1) ?? null) : null)
  );
}

/**
 * 选中一段之后交给对话框的说明文字。选区可以横跨几个镜头，所以这里分两种写法：
 * 落在一个镜头里就写镜头内部的相对时间，跨镜头就把跨到的镜头都点名，
 * 免得纳音以为「2.77–6.93 秒」全都发生在只有 3 秒长的那一镜里。
 */
export function storyboardEditSelectionSummary(input: {
  shotLabels: readonly string[];
  range: StoryboardEditRange;
  timing: { startMs: number; durationMs: number };
}): { selectedText: string; fullText: string } {
  const firstLabel = input.shotLabels[0] ?? "镜头";
  const lastLabel = input.shotLabels.at(-1) ?? firstLabel;
  const filmTime = `${formatStoryboardTimestamp(input.range.startMs)}–${formatStoryboardTimestamp(input.range.endMs)}`;
  const lengthSec = (input.range.endMs - input.range.startMs) / 1000;
  const localStartMs = Math.max(0, input.range.startMs - input.timing.startMs);

  if (input.shotLabels.length > 1) {
    return {
      selectedText: `${firstLabel}–${lastLabel} · ${filmTime}`,
      fullText: `从 ${firstLabel} 的 ${(localStartMs / 1000).toFixed(
        2
      )} 秒起，一直到 ${lastLabel}，跨 ${input.shotLabels.length} 个镜头（${input.shotLabels.join(
        "、"
      )}；成片 ${filmTime}，共 ${lengthSec.toFixed(2)} 秒）`,
    };
  }

  const localEndMs = Math.min(
    input.timing.durationMs,
    Math.max(localStartMs, input.range.endMs - input.timing.startMs)
  );
  return {
    selectedText: `${firstLabel} · ${filmTime}`,
    fullText: `${firstLabel} 的 ${(localStartMs / 1000).toFixed(2)}–${(
      localEndMs / 1000
    ).toFixed(2)} 秒（成片 ${filmTime}，共 ${lengthSec.toFixed(2)} 秒）`,
  };
}

/** 右键菜单里能做的事。 */
export type StoryboardEditAction =
  | "split"
  | "extract"
  | "selectShot"
  | "trimMinusFrame"
  | "trimPlusFrame"
  | "trimMinusHalfSec"
  | "trimPlusHalfSec"
  | "moveLeft"
  | "moveRight"
  | "insertAfter"
  | "delete";

export type StoryboardEditMenuItem = {
  action: StoryboardEditAction;
  label: string;
  /** 展示用的快捷键，和 storyboardEditShortcut 的映射保持一致。 */
  shortcut: string;
  /** 不为 null 就是灰的，文案直接告诉用户为什么点不了。 */
  disabledReason: string | null;
  danger: boolean;
  groupStart: boolean;
};

/**
 * 右键点在某一镜上时能做什么。灰掉的项也留在菜单里并写明原因——
 * 之前「按了小剪刀没反应」就是因为那一镜还没有视频，报错被别的横幅盖住了。
 */
export function storyboardEditMenuItems(input: {
  shotLabel: string;
  /** 右键点下去的那个时间点上有没有可切的视频。 */
  canSplitHere: boolean;
  isFirst: boolean;
  isLast: boolean;
  shotCount: number;
  canInsert: boolean;
  canDelete: boolean;
}): StoryboardEditMenuItem[] {
  const noVideo = input.canSplitHere
    ? null
    : "这一处还没有视频，先给这一镜生成或采用视频";
  const items: StoryboardEditMenuItem[] = [
    {
      action: "split",
      label: "在这里切一刀",
      shortcut: "S",
      disabledReason: noVideo,
      danger: false,
      groupStart: false,
    },
    {
      action: "extract",
      label: "把这一帧存成画面",
      shortcut: "F",
      disabledReason: noVideo,
      danger: false,
      groupStart: false,
    },
    {
      action: "selectShot",
      label: `选中 ${input.shotLabel} 交给聊聊`,
      shortcut: "X",
      disabledReason: null,
      danger: false,
      groupStart: false,
    },
    {
      action: "trimMinusFrame",
      label: "时长 −1 帧",
      shortcut: ",",
      disabledReason: null,
      danger: false,
      groupStart: true,
    },
    {
      action: "trimPlusFrame",
      label: "时长 +1 帧",
      shortcut: ".",
      disabledReason: null,
      danger: false,
      groupStart: false,
    },
    {
      action: "trimMinusHalfSec",
      label: "时长 −0.5 秒",
      shortcut: "⇧,",
      disabledReason: null,
      danger: false,
      groupStart: false,
    },
    {
      action: "trimPlusHalfSec",
      label: "时长 +0.5 秒",
      shortcut: "⇧.",
      disabledReason: null,
      danger: false,
      groupStart: false,
    },
    {
      action: "moveLeft",
      label: "往前挪一位",
      shortcut: "⌥←",
      disabledReason: input.isFirst ? "已经是第一镜" : null,
      danger: false,
      groupStart: true,
    },
    {
      action: "moveRight",
      label: "往后挪一位",
      shortcut: "⌥→",
      disabledReason: input.isLast ? "已经是最后一镜" : null,
      danger: false,
      groupStart: false,
    },
  ];
  if (input.canInsert) {
    items.push({
      action: "insertAfter",
      label: "在后面加一镜",
      shortcut: "⏎",
      disabledReason: null,
      danger: false,
      groupStart: true,
    });
  }
  if (input.canDelete) {
    items.push({
      action: "delete",
      label: `删掉 ${input.shotLabel}`,
      shortcut: "⌫",
      disabledReason: input.shotCount <= 1 ? "至少保留一个镜头" : null,
      danger: true,
      groupStart: !input.canInsert,
    });
  }
  return items;
}

/** 键盘敲下去要干的事。 */
export type StoryboardEditShortcut =
  | { kind: "togglePlay" }
  | { kind: "play" }
  | { kind: "pause" }
  | { kind: "seekBy"; deltaMs: number }
  | { kind: "seekTo"; position: "start" | "end" }
  | { kind: "seekEdge"; direction: "prev" | "next" }
  | { kind: "markIn" }
  | { kind: "markOut" }
  | { kind: "clearSelection" }
  | { kind: "action"; action: StoryboardEditAction };

/**
 * 快捷键照搬主流剪辑软件：空格走带、JKL、左右一帧、上下跳切点、
 * I/O 打入出点、S 切割、⌫ 删除。只在剪辑条拿到焦点时生效，所以不会抢聊天框的输入。
 */
export function storyboardEditShortcut(event: {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}): StoryboardEditShortcut | null {
  const modified = event.metaKey || event.ctrlKey;
  // ⌘Z 之类的留给全局撤销，这里一律不拦。
  if (modified && event.key.toLowerCase() !== "k") return null;
  if (modified && event.key.toLowerCase() === "k") {
    return { kind: "action", action: "split" };
  }

  if (event.altKey) {
    if (event.key === "ArrowLeft")
      return { kind: "action", action: "moveLeft" };
    if (event.key === "ArrowRight")
      return { kind: "action", action: "moveRight" };
    return null;
  }

  switch (event.key) {
    case " ":
      return { kind: "togglePlay" };
    case "ArrowLeft":
      return {
        kind: "seekBy",
        deltaMs: event.shiftKey ? -1000 : -STORYBOARD_EDIT_FRAME_MS,
      };
    case "ArrowRight":
      return {
        kind: "seekBy",
        deltaMs: event.shiftKey ? 1000 : STORYBOARD_EDIT_FRAME_MS,
      };
    case "ArrowUp":
      return { kind: "seekEdge", direction: "prev" };
    case "ArrowDown":
      return { kind: "seekEdge", direction: "next" };
    case "Home":
      return { kind: "seekTo", position: "start" };
    case "End":
      return { kind: "seekTo", position: "end" };
    case "Escape":
      return { kind: "clearSelection" };
    case "Backspace":
    case "Delete":
      return { kind: "action", action: "delete" };
    case "Enter":
      return { kind: "action", action: "insertAfter" };
    case ",":
      return { kind: "action", action: "trimMinusFrame" };
    case ".":
      return { kind: "action", action: "trimPlusFrame" };
    case "<":
      return { kind: "action", action: "trimMinusHalfSec" };
    case ">":
      return { kind: "action", action: "trimPlusHalfSec" };
    default:
      break;
  }

  switch (event.key.toLowerCase()) {
    case "j":
      return { kind: "seekBy", deltaMs: -1000 };
    case "k":
      return { kind: "pause" };
    case "l":
      return { kind: "play" };
    case "i":
      return { kind: "markIn" };
    case "o":
      return { kind: "markOut" };
    case "x":
      return { kind: "action", action: "selectShot" };
    case "s":
      return { kind: "action", action: "split" };
    case "f":
      return { kind: "action", action: "extract" };
    default:
      return null;
  }
}

/** 入点／出点凑成一个选区；只打了一半就还不成区间。 */
export function storyboardEditMarkedRange(
  inMs: number | null,
  outMs: number | null
): StoryboardEditRange | null {
  if (inMs == null || outMs == null) return null;
  return storyboardEditSelectionRange(inMs, outMs);
}
