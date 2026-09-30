import { describe, expect, it } from "vitest";

import {
  STUDIO_TOUR_STEPS,
  cardAnchorRect,
  resolveTourCardPosition,
  studioTourAnchorSelector,
  visibleStudioTourSteps,
} from "./studioTourSteps";

describe("studioTourSteps", () => {
  it("每一步都有唯一 id、锚点和中文说明", () => {
    const ids = STUDIO_TOUR_STEPS.map(step => step.id);
    expect(new Set(ids).size).toBe(ids.length);
    const anchors = STUDIO_TOUR_STEPS.map(step => step.anchor);
    expect(new Set(anchors).size).toBe(anchors.length);
    for (const step of STUDIO_TOUR_STEPS) {
      expect(step.title.trim().length).toBeGreaterThan(0);
      expect(step.body.trim().length).toBeGreaterThan(8);
    }
  });

  it("锚点选择器按 data-tour 生成", () => {
    expect(studioTourAnchorSelector("export")).toBe('[data-tour="export"]');
  });

  it("界面上找不到的那一步直接跳过，不指向空位置", () => {
    const present = new Set(["story-menu", "export"]);
    const steps = visibleStudioTourSteps(STUDIO_TOUR_STEPS, anchor =>
      present.has(anchor)
    );
    expect(steps.map(step => step.id)).toEqual(["story-menu", "export"]);
  });

  it("一块都认不出来时返回空，调用方据此放弃这次播放", () => {
    expect(visibleStudioTourSteps(STUDIO_TOUR_STEPS, () => false)).toEqual([]);
  });
});

describe("resolveTourCardPosition", () => {
  const card = { cardWidth: 288, cardHeight: 188 };

  it("默认贴在高亮块下方并水平居中", () => {
    const placement = resolveTourCardPosition({
      rect: { left: 500, top: 100, width: 120, height: 40 },
      viewportWidth: 1440,
      viewportHeight: 900,
      ...card,
    });
    expect(placement.side).toBe("below");
    expect(placement.top).toBe(154);
    expect(placement.left).toBe(416);
  });

  it("下方放不住就翻到上方", () => {
    const placement = resolveTourCardPosition({
      rect: { left: 500, top: 700, width: 120, height: 40 },
      viewportWidth: 1440,
      viewportHeight: 900,
      ...card,
    });
    expect(placement.side).toBe("above");
    expect(placement.top).toBe(498);
  });

  it("上下都放不住时仍留在视口里，不会被挤出屏幕", () => {
    const placement = resolveTourCardPosition({
      rect: { left: 40, top: 60, width: 80, height: 300 },
      viewportWidth: 1440,
      viewportHeight: 420,
      ...card,
    });
    expect(placement.top).toBeGreaterThanOrEqual(12);
    expect(placement.top + card.cardHeight).toBeLessThanOrEqual(420 - 12 + 1);
  });

  it("靠最右边的元素（头像、余额）说明卡会被夹回屏幕内", () => {
    const placement = resolveTourCardPosition({
      rect: { left: 1390, top: 20, width: 40, height: 40 },
      viewportWidth: 1440,
      viewportHeight: 900,
      ...card,
    });
    expect(placement.left).toBe(1440 - 288 - 12);
  });

  it("靠最左边时不会给出负数左偏移", () => {
    const placement = resolveTourCardPosition({
      rect: { left: 0, top: 20, width: 60, height: 60 },
      viewportWidth: 1440,
      viewportHeight: 900,
      ...card,
    });
    expect(placement.left).toBe(12);
  });
});

describe("cardAnchorRect", () => {
  it("普通大小的块原样使用", () => {
    const rect = { left: 100, top: 20, width: 120, height: 44 };
    expect(cardAnchorRect(rect, 900)).toEqual(rect);
  });

  it("几乎占满整屏高的左栏只取顶部一段来摆卡片", () => {
    const tall = { left: -6, top: 94, width: 352, height: 812 };
    const anchor = cardAnchorRect(tall, 900);
    expect(anchor.height).toBe(405);
    // 左右和顶部不动，只压高度：高亮框仍然框住整块
    expect(anchor.left).toBe(tall.left);
    expect(anchor.top).toBe(tall.top);
    expect(anchor.width).toBe(tall.width);
  });

  it("超高左栏的说明卡因此能完整留在视口里", () => {
    const tall = { left: -6, top: 94, width: 352, height: 812 };
    const placement = resolveTourCardPosition({
      rect: cardAnchorRect(tall, 900),
      viewportWidth: 1440,
      viewportHeight: 900,
      cardWidth: 288,
      cardHeight: 200,
    });
    expect(placement.top).toBeGreaterThanOrEqual(12);
    expect(placement.top + 200).toBeLessThanOrEqual(900 - 12);
  });

  it("很矮的窗口里同样放得下", () => {
    const tall = { left: -6, top: 94, width: 352, height: 392 };
    const placement = resolveTourCardPosition({
      rect: cardAnchorRect(tall, 480),
      viewportWidth: 1280,
      viewportHeight: 480,
      cardWidth: 288,
      cardHeight: 200,
    });
    expect(placement.top).toBeGreaterThanOrEqual(12);
    expect(placement.top + 200).toBeLessThanOrEqual(480 - 12);
  });
});
