import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import StudioTour from "./StudioTour";

vi.stubGlobal("React", React);

const authState = vi.hoisted(() => ({
  user: null as { id: number } | null,
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: authState.user }),
}));

describe("StudioTour", () => {
  it("首屏不抢渲染：还没量到位置时什么都不画", () => {
    authState.user = { id: 7 };
    expect(renderToStaticMarkup(<StudioTour />)).toBe("");
  });

  it("没有登录用户时也不画", () => {
    authState.user = null;
    expect(renderToStaticMarkup(<StudioTour />)).toBe("");
  });
});

describe("引导用到的样式都在 index.css 里", () => {
  const css = readFileSync(
    resolve(import.meta.dirname, "../../index.css"),
    "utf-8"
  );

  it("遮罩、高亮框和说明卡的类名都有对应样式", () => {
    for (const className of [
      ".studio-tour-layer",
      ".studio-tour-spotlight",
      ".studio-tour-card",
      ".studio-tour-title",
      ".studio-tour-body",
      ".studio-tour-primary",
      ".studio-tour-secondary",
      ".studio-tour-skip",
    ]) {
      expect(css).toContain(className);
    }
  });

  it("高亮框靠超大投影压暗四周，保证遮罩和元素严格对齐", () => {
    expect(css).toContain("0 0 0 9999px");
  });

  it("弹跳动画存在，并在用户要求减少动效时关掉", () => {
    expect(css).toContain("@keyframes studio-tour-pop");
    const reduced = css.slice(css.indexOf(".studio-tour-layer"));
    expect(reduced).toContain("prefers-reduced-motion");
  });

  it("跟着主题变量走，不写死颜色", () => {
    const block = css.slice(css.indexOf(".studio-tour-spotlight"));
    expect(block).toContain("var(--nayin-accent)");
  });
});

describe("不和别的弹层叠在一起", () => {
  const source = readFileSync(
    resolve(import.meta.dirname, "StudioTour.tsx"),
    "utf-8"
  );

  it("开场前检查屏幕上有没有别的弹层", () => {
    expect(source).toContain('[role="dialog"][aria-modal="true"]');
  });

  it("判断时排除引导自己的说明卡，否则会立刻自我退场", () => {
    expect(source).toContain(":not(.studio-tour-card)");
  });

  it("开场之后也盯着 DOM，晚一步弹出的每日来信同样让开", () => {
    expect(source).toContain("MutationObserver");
    const guard = source.slice(source.indexOf("yieldScreen"));
    expect(guard).toContain("anotherDialogOpen()");
  });

  it("让开时不写 seen，下次进来还会再讲一遍", () => {
    const yieldBlock = source.slice(
      source.indexOf("const yieldScreen"),
      source.indexOf("observer.disconnect")
    );
    expect(yieldBlock).not.toContain("writeStudioTourSeen");
  });
});
