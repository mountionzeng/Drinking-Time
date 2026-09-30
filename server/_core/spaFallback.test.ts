import { describe, expect, it } from "vitest";

import { shouldServeSpaShell } from "./spaFallback";

const navigation = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  secFetchDest: "document",
  secFetchMode: "navigate",
};

describe("shouldServeSpaShell", () => {
  it("前端路由回 HTML 外壳", () => {
    for (const path of [
      "/",
      "/editing",
      "/stories",
      "/stories/12",
      "/personal-memory",
      "/admin/users",
      "/m",
    ]) {
      expect(
        shouldServeSpaShell({ path, headers: navigation }),
        `${path} 应该回外壳`
      ).toBe(true);
    }
  });

  it("模块脚本请求不回 HTML：这正是旧标签页白屏的原因", () => {
    expect(
      shouldServeSpaShell({
        path: "/node_modules/.vite/deps/chunk-ABC123.js?v=08b6f0dd",
        headers: { accept: "*/*", secFetchDest: "script" },
      })
    ).toBe(false);
  });

  it("换版本后失效的产物文件回 404 而不是外壳", () => {
    expect(
      shouldServeSpaShell({
        path: "/assets/index-OLDHASH1.js",
        headers: { accept: "*/*", secFetchDest: "script" },
      })
    ).toBe(false);
  });

  it("Vite 内部地址一律不是页面", () => {
    for (const path of [
      "/@vite/client",
      "/@react-refresh",
      "/@fs/Users/someone/project/client/src/main.tsx",
      "/@id/__x00__virtual:thing",
    ]) {
      expect(shouldServeSpaShell({ path }), `${path} 不该回外壳`).toBe(false);
    }
  });

  it("常见静态资源按后缀识别，即使没有 Sec-Fetch-Dest", () => {
    for (const path of [
      "/src/main.tsx",
      "/src/index.css",
      "/assets/app.js",
      "/fonts/inter.woff2",
      "/shiguang/memory-bird.png",
      "/data.json",
      "/app.js.map",
      "/video.mp4",
    ]) {
      expect(shouldServeSpaShell({ path }), `${path} 不该回外壳`).toBe(false);
    }
  });

  it("浏览器说是取样式或字体就不回外壳", () => {
    expect(
      shouldServeSpaShell({
        path: "/some/path",
        headers: { accept: "*/*", secFetchDest: "style" },
      })
    ).toBe(false);
    expect(
      shouldServeSpaShell({
        path: "/some/path",
        headers: { accept: "*/*", secFetchDest: "font" },
      })
    ).toBe(false);
  });

  it("查询串不影响判断", () => {
    expect(
      shouldServeSpaShell({
        path: "/src/main.tsx?v=abc123",
        headers: { accept: "*/*", secFetchDest: "script" },
      })
    ).toBe(false);
    expect(
      shouldServeSpaShell({
        path: "/editing?letterDate=2026-09-25",
        headers: navigation,
      })
    ).toBe(true);
  });

  it("带点的前端路径在明确是导航时仍回外壳", () => {
    expect(
      shouldServeSpaShell({
        path: "/stories/my.story.draft",
        headers: navigation,
      })
    ).toBe(true);
  });

  it("只接受 JSON 的请求不回 HTML", () => {
    expect(
      shouldServeSpaShell({
        path: "/some/api/like/path",
        headers: { accept: "application/json" },
      })
    ).toBe(false);
  });

  it("没有任何头的裸请求按路径判断，前端路由照常给外壳", () => {
    expect(shouldServeSpaShell({ path: "/editing" })).toBe(true);
  });
});
