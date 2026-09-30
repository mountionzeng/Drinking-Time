/**
 * 电脑版工作室的首次使用引导：一步对应界面上的一块。
 *
 * 文案只讲「这块是干什么的、你在这儿能做什么」，不讲实现。
 * anchor 用 `data-tour` 属性定位，找不到的那一步会被自动跳过——
 * 比如没打开故事时左栏是故事列表、未登录时顶栏没有算力余额。
 */
export type StudioTourStep = {
  id: string;
  /** 对应界面元素上的 data-tour 值。 */
  anchor: string;
  title: string;
  body: string;
};

export const STUDIO_TOUR_STEPS: ReadonlyArray<StudioTourStep> = [
  {
    id: "story-menu",
    anchor: "story-menu",
    title: "故事菜单",
    body: "点这颗图标可以新建故事、打开最近写过的，或者浏览全部。这里的每一篇故事，都是一份独立的素材、文字和剪辑。",
  },
  {
    id: "chat",
    anchor: "chat-column",
    title: "聊聊",
    body: "左边这一栏是和聊聊说话的地方。用平常的话讲你想要什么——写一段、换个画面、把这句剪掉——它会帮你动手。还没打开故事时，这里是你的故事列表。",
  },
  {
    id: "publishing",
    anchor: "workspace-publishing",
    title: "文字",
    body: "把一件小事整理成能发出去的成稿。写好的正文会留在这篇故事里，后面做画面和声音都从它出发。",
  },
  {
    id: "editing",
    anchor: "workspace-editing",
    title: "图像和声音",
    body: "剪辑台：看镜头、预览播放、调字幕和声音。按钮底下的「素材仓库」放着这篇故事的图片、视频和音频。",
  },
  {
    id: "export",
    anchor: "export",
    title: "导出成片",
    body: "把当前故事合成为一条完整的视频，导出后会自动打开，可以直接下载。",
  },
  {
    id: "balance",
    anchor: "compute-balance",
    title: "算力余额",
    body: "生成画面和声音会从这里扣。聊天、写正文、读来信都不花钱，所以放心聊。",
  },
  {
    id: "account",
    anchor: "account",
    title: "你的账号",
    body: "账号、界面风格（拾光家忆／纳音五行）都在这里。想再看一遍这份引导，也从这个菜单进。",
  },
];

export function studioTourAnchorSelector(anchor: string): string {
  return `[data-tour="${anchor}"]`;
}

/**
 * 只留下界面上真的能找到的步骤。
 *
 * 引导要跟着当前界面走：指向一个不存在的位置，比少讲一步更让人困惑。
 */
export function visibleStudioTourSteps(
  steps: ReadonlyArray<StudioTourStep>,
  hasAnchor: (anchor: string) => boolean
): StudioTourStep[] {
  return steps.filter(step => hasAnchor(step.anchor));
}

export type TourCardPlacement = {
  left: number;
  top: number;
  /** 说明卡在高亮块的上方还是下方，用来决定小箭头朝向。 */
  side: "above" | "below";
};

export type TourAnchorRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/**
 * 说明卡该贴着哪一块来摆。
 *
 * 像左侧聊聊那样几乎占满整屏高度的区域，「贴在它下面」等于贴到屏幕外；夹回来
 * 又会正好压住它。所以超高的锚点只取顶部一段来定位：卡片落在这一栏的上方附近，
 * 既指得清楚，也不会被挤出视口。高亮框仍然框住整块，不受这里影响。
 */
export function cardAnchorRect(
  rect: TourAnchorRect,
  viewportHeight: number
): TourAnchorRect {
  const maxHeight = viewportHeight * 0.45;
  if (rect.height <= maxHeight) return rect;
  return { ...rect, height: maxHeight };
}

/**
 * 说明卡默认贴在高亮块下方，下方放不住就翻到上方，并始终留在视口里。
 *
 * 拆成纯函数是为了能在没有浏览器的测试环境里验证翻转和夹取。
 */
export function resolveTourCardPosition({
  rect,
  viewportWidth,
  viewportHeight,
  cardWidth,
  cardHeight,
  gap = 14,
  margin = 12,
}: {
  rect: TourAnchorRect;
  viewportWidth: number;
  viewportHeight: number;
  cardWidth: number;
  cardHeight: number;
  gap?: number;
  margin?: number;
}): TourCardPlacement {
  const belowTop = rect.top + rect.height + gap;
  const aboveTop = rect.top - gap - cardHeight;
  const fitsBelow = belowTop + cardHeight + margin <= viewportHeight;
  const fitsAbove = aboveTop >= margin;
  const side: TourCardPlacement["side"] =
    fitsBelow || !fitsAbove ? "below" : "above";

  const rawTop = side === "below" ? belowTop : aboveTop;
  const maxTop = Math.max(margin, viewportHeight - cardHeight - margin);
  const rawLeft = rect.left + rect.width / 2 - cardWidth / 2;
  const maxLeft = Math.max(margin, viewportWidth - cardWidth - margin);

  return {
    left: Math.min(Math.max(rawLeft, margin), maxLeft),
    top: Math.min(Math.max(rawTop, margin), maxTop),
    side,
  };
}
