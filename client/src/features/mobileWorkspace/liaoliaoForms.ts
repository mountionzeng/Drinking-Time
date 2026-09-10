/**
 * 聊聊的五种外形，以及每种外形专属的底部导航图标。
 *
 * 外形就是既有的五行角色，不是新造的一套：金啤酒杯、木茶碗、水椰子、火茶壶、
 * 土咖啡杯——`WUXING_DRINK_ART` 里本来就是这五个不同的身体，`EmotiveWuxingIcon`
 * 又在它们身上叠了 11 个表情（含「想着呢」）。所以聊天里的聊聊继续用那套 SVG，
 * 换外形＝换五行，思考／回复／失败的状态反馈一个都不丢。
 *
 * 设计稿另给了一张水彩横排图（`/liaoliao/five-forms.png`），是同样这五个角色的
 * 另一种画法，但只有静态形象、没有表情。所以它只用在「我 → 聊聊的外形」的
 * 预览里，不进聊天——否则等回信时就没有脸可换了。
 */
import type { NayinElement } from "@/features/nayin/nayin";

export type LiaoliaoForm = {
  element: NayinElement;
  /** 「金 · 啤酒杯」 */
  label: string;
  /** 水彩横排图里的第几格（0-4），顺序即金木水火土 */
  spriteIndex: number;
};

export const LIAOLIAO_FORMS: readonly LiaoliaoForm[] = [
  { element: "metal", label: "金 · 啤酒杯", spriteIndex: 0 },
  { element: "wood", label: "木 · 茶碗", spriteIndex: 1 },
  { element: "water", label: "水 · 椰子", spriteIndex: 2 },
  { element: "fire", label: "火 · 茶壶", spriteIndex: 3 },
  { element: "earth", label: "土 · 咖啡杯", spriteIndex: 4 },
];

export function liaoliaoForm(element: NayinElement): LiaoliaoForm {
  return (
    LIAOLIAO_FORMS.find(form => form.element === element) ?? LIAOLIAO_FORMS[4]
  );
}

/**
 * 水彩横排图的定位样式。
 *
 * 五格等宽横排：背景放大到 500%，第 n 格的水平位置是 n/(5-1) = n*25%。
 */
export function liaoliaoSpriteStyle(element: NayinElement) {
  const { spriteIndex } = liaoliaoForm(element);
  return {
    backgroundImage: "url('/liaoliao/five-forms.png')",
    backgroundSize: "500% auto",
    backgroundRepeat: "no-repeat",
    backgroundPosition: `${spriteIndex * 25}% center`,
  } as const;
}

export type MobilePage = "stories" | "chat" | "me";

export const MOBILE_PAGE_LABEL: Record<MobilePage, string> = {
  stories: "故事",
  chat: "聊聊",
  me: "我",
};

/**
 * 导航图标：三个入口 × 五种外形，各画各的。
 *
 * 不是同一个图标改颜色——书页的装订、对话框的形状、人物的下摆都跟着外形走，
 * 但含义和视觉重量保持一致（同一 28 视框、同一描边粗细）。
 * 路径取自设计演示 `liaoliao-pages-prototype.html` 的 `navIcon()`。
 */
const STORIES_PATHS: Record<NayinElement, string> = {
  metal:
    "M6 4h12a2 2 0 0 1 2 2v17H7a3 3 0 0 1-3-3V7a3 3 0 0 1 2-3ZM7 4v15M4 20h16M11 8h5M11 12h4",
  wood: "M13 7C9 4 5 4 2 5v16c4-1 8 0 11 2 3-2 7-3 11-2V5c-4-1-8 0-11 2Zm0 0v16M17 10c4-1 4 3 0 4-1-2-1-3 0-4Z",
  water: "M6 3h10l5 5v16H6V3Zm10 0v6h5M10 14c2-3 3 3 6 0M10 18c2-3 3 3 6 0",
  fire: "M5 4h16v20H5zM9 4v20M13 4v9l3-2 3 2V4",
  earth:
    "M5 6c3-1 6 0 8 2 3-2 6-3 9-2v17c-4-1-6-1-9 1-3-2-5-2-8-1V6Zm8 2v16M17 6v7l2-1 2 1V6",
};

const CHAT_PATHS: Record<NayinElement, string> = {
  metal: "M4 5h18v14H11l-6 5v-5H4zM8 10h10M8 14h7",
  wood: "M23 12c0 6-5 9-11 8l-6 3 1-6C1 10 6 4 13 4c6 0 10 3 10 8ZM10 9c5-1 6 4 1 5-1-2-2-3-1-5Z",
  water: "M4 12a9 9 0 0 1 18 0c0 6-5 9-11 8l-6 3 1-6M8 12c3-4 5 4 10 0",
  fire: "M6 4h14l4 6v10h-9l-7 4v-4H3V9zM9 12h0M14 12h0M19 12h0",
  earth: "M4 7Q4 4 8 4h12q4 0 4 4v9q0 4-4 4h-8l-6 3v-4q-2-1-2-4ZM9 11h9M9 15h6",
};

/** 人物：头和肩是共用的，下摆按外形不同。 */
const ME_BASE = "M13 8m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0M4 24v-3a9 9 0 0 1 18 0v3Z";
const ME_DETAIL_PATHS: Record<NayinElement, string> = {
  metal: "M9 18h8M13 15v7",
  wood: "M10 19q5-5 7 0-4 5-7 0Z",
  water: "M7 20q3-4 6 0t6 0",
  fire: "m10 21 3-6 3 6Z",
  earth: "M9 17v5h8v-5",
};

export function navIconPaths(
  page: MobilePage,
  element: NayinElement
): readonly string[] {
  if (page === "stories") return [STORIES_PATHS[element]];
  if (page === "chat") return [CHAT_PATHS[element]];
  return [ME_BASE, ME_DETAIL_PATHS[element]];
}
