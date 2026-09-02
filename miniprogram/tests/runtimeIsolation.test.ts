import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 状态层的运行时隔离守门。
 *
 * `src/core/**` 与 `src/services/**` 必须是纯 TypeScript：
 * 不引 React、不碰 DOM、不用浏览器 `localStorage`、不用 Node-only API。
 * 微信 API 只允许出现在两处窄适配器里（storage.ts 与 pages/、app.ts）。
 */

const SRC_ROOT = path.resolve(import.meta.dirname, "..", "src");

function collectFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return collectFiles(full);
    return full.endsWith(".ts") ? [full] : [];
  });
}

const CORE_FILES = collectFiles(path.join(SRC_ROOT, "core"));
const SERVICE_FILES = collectFiles(path.join(SRC_ROOT, "services"));

/** storage.ts 是唯一允许触碰 wx 存储 API 的适配器。 */
const WX_ADAPTER = path.join(SRC_ROOT, "services", "storage.ts");

const FORBIDDEN = [
  { name: "React", pattern: /\bfrom ["']react["']|useState|useEffect|JSX\./ },
  // 注意：`document` 在本项目是业务名词（发布正文），不能整词禁掉，
  // 所以只拦真正的 DOM 用法。
  {
    name: "DOM",
    pattern:
      /\b(window|navigator)\s*\.|document\.(querySelector|getElementById|createElement|addEventListener)/,
  },
  {
    name: "浏览器 localStorage",
    pattern: /\b(localStorage|sessionStorage)\s*[.[]/,
  },
  {
    name: "Node-only API",
    pattern: /\bfrom ["']node:|require\(["']fs["']\)|\bprocess\.env\b|__dirname/,
  },
  { name: "@shared 别名", pattern: /from ["']@shared\// },
];

describe("状态层运行时隔离", () => {
  it("扫描到的文件数量非零，否则守门是假通过", () => {
    expect(CORE_FILES.length).toBeGreaterThan(3);
    expect(SERVICE_FILES.length).toBeGreaterThan(0);
  });

  it("core/ 与 services/ 不引用 React、DOM、localStorage、Node API 或 @shared", () => {
    const violations: string[] = [];
    for (const file of [...CORE_FILES, ...SERVICE_FILES]) {
      const content = readFileSync(file, "utf8");
      for (const rule of FORBIDDEN) {
        if (rule.pattern.test(content)) {
          violations.push(`${path.relative(SRC_ROOT, file)} → ${rule.name}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("core/ 不调用任何 wx API，微信 API 只在 services/storage.ts 这个适配器里", () => {
    // 只匹配真正的调用 `wx.foo(`；文档和错误信息里提到 wx.login 不算。
    const wxCall = /\bwx\.[A-Za-z]+\s*\(/;
    const coreUsingWx = CORE_FILES.filter(file =>
      wxCall.test(readFileSync(file, "utf8")),
    ).map(file => path.relative(SRC_ROOT, file));
    expect(coreUsingWx).toEqual([]);

    const servicesUsingWx = SERVICE_FILES.filter(file =>
      wxCall.test(readFileSync(file, "utf8")),
    );
    expect(servicesUsingWx).toEqual([WX_ADAPTER]);
  });
});
