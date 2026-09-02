import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * WXML 与 Page 的静态对账。
 *
 * 「能编译」不等于「点了有反应」：绑定了不存在的处理函数、或者引用了 data 里
 * 没有的字段，微信都不会在编译期报错，只会在真机上安静地什么都不发生。
 * 这里把两边对起来，不依赖开发者工具的人工点击。
 */

const SRC = path.resolve(import.meta.dirname, "..", "src");
const PAGE_NAMES = ["start", "privacy", "workspace"] as const;

/** WXML 表达式里合法的局部变量（wx:for 默认作用域）。 */
const LOCALS = new Set(["item", "index"]);

type PageOptions = Record<string, unknown> & { data?: Record<string, unknown> };

const pages = new Map<string, PageOptions>();

beforeAll(async () => {
  const captured: PageOptions[] = [];
  const globalScope = globalThis as unknown as Record<string, unknown>;
  const memory = new Map<string, string>();
  globalScope.wx = {
    getStorageSync: (key: string) => memory.get(key) ?? "",
    setStorageSync: (key: string, value: string) => memory.set(key, value),
    removeStorageSync: (key: string) => memory.delete(key),
    getStorageInfoSync: () => ({ keys: [], currentSize: 0, limitSize: 0 }),
    getAccountInfoSync: () => ({ miniProgram: { appId: "touristappid" } }),
  };
  globalScope.App = (options: Record<string, unknown>) => {
    globalScope.__app = options;
  };
  globalScope.getApp = () => globalScope.__app;
  globalScope.Page = (options: PageOptions) => captured.push(options);
  globalScope.getCurrentPages = () => [];

  await import("../src/app");
  await import("../src/pages/start/index");
  await import("../src/pages/privacy/index");
  await import("../src/pages/workspace/index");
  PAGE_NAMES.forEach((name, index) => {
    pages.set(name, captured[index] as PageOptions);
  });
});

function wxml(name: string): string {
  return readFileSync(path.join(SRC, "pages", name, "index.wxml"), "utf8");
}

/** 收集 bindtap / catchtap / bind:input 这类事件绑定的处理函数名。 */
function boundHandlers(source: string): string[] {
  const matches = source.matchAll(
    /\b(?:bind|catch|capture-bind|capture-catch):?[a-zA-Z]+\s*=\s*"([^"{}]+)"/g,
  );
  return Array.from(new Set(Array.from(matches, match => match[1] as string)));
}

/** 收集 {{ ... }} 里出现的根标识符。 */
function referencedRoots(source: string): string[] {
  const roots = new Set<string>();
  for (const expression of source.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
    const body = expression[1] ?? "";
    // 去掉字符串字面量，避免把 'chat' 这种当成标识符。
    const withoutStrings = body.replace(/'[^']*'|"[^"]*"/g, " ");
    for (const identifier of withoutStrings.matchAll(
      /(?:^|[^.\w$])([A-Za-z_$][\w$]*)/g,
    )) {
      const name = identifier[1] as string;
      if (["true", "false", "null", "undefined"].includes(name)) continue;
      roots.add(name);
    }
  }
  return Array.from(roots);
}

describe.each(PAGE_NAMES)("%s 页面绑定", name => {
  it("WXML 绑定的每个事件处理函数都存在于 Page", () => {
    const page = pages.get(name);
    expect(page, `${name} 页面没有注册`).toBeTruthy();
    const handlers = boundHandlers(wxml(name));
    // 解析器必须真的抓到东西，否则这条断言是假通过。
    expect(handlers.length).toBeGreaterThan(0);
    const missing = handlers.filter(
      handler => typeof page?.[handler] !== "function",
    );
    expect(missing).toEqual([]);
  });

  it("WXML 引用的每个根字段都存在于 data", () => {
    const page = pages.get(name);
    const data = page?.data ?? {};
    const roots = referencedRoots(wxml(name));
    expect(roots.length).toBeGreaterThan(0);
    const missing = roots.filter(
      root => !(root in data) && !LOCALS.has(root),
    );
    expect(missing).toEqual([]);
  });

  it("每个页面都有配套的 json / wxss，且不引入自定义组件", () => {
    const config = JSON.parse(
      readFileSync(path.join(SRC, "pages", name, "index.json"), "utf8"),
    );
    expect(config.usingComponents).toEqual({});
    expect(
      readFileSync(path.join(SRC, "pages", name, "index.wxss"), "utf8").length,
    ).toBeGreaterThan(0);
  });
});

describe("条件链完整性", () => {
  it("wx:elif / wx:else 之间没有注释节点打断条件链", () => {
    for (const name of PAGE_NAMES) {
      const source = wxml(name);
      // 把注释和条件属性按出现顺序取出来，注释不能夹在 if 与 elif/else 之间。
      const tokens = Array.from(
        source.matchAll(/<!--[\s\S]*?-->|wx:if|wx:elif|wx:else/g),
        match => (match[0].startsWith("<!--") ? "comment" : match[0]),
      );
      tokens.forEach((token, index) => {
        if (token !== "comment") return;
        const next = tokens[index + 1];
        const previous = tokens[index - 1];
        const breaksChain =
          (next === "wx:elif" || next === "wx:else") &&
          (previous === "wx:if" || previous === "wx:elif");
        expect(breaksChain, `${name} 的注释打断了 wx:if 链`).toBe(false);
      });
    }
  });
});
