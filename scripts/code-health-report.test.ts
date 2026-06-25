import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import {
  analyzeProject,
  analyzeSourceText,
  applyStaticReferences,
  buildMarkdownReport,
  formatBytes,
} from "./code-health-report";

describe("code-health-report source analysis", () => {
  it("counts static function calls and JSX component references", () => {
    const text = `
      export function helper(value: number) {
        return value + 1;
      }

      function Panel() {
        helper(1);
        return <Widget />;
      }

      function Widget() {
        return null;
      }
    `;
    const analysis = analyzeSourceText("/tmp/sample.tsx", "sample.tsx", text);
    applyStaticReferences(analysis.functions, analysis.calls);

    const helper = analysis.functions.find((fn) => fn.simpleName === "helper");
    const widget = analysis.functions.find((fn) => fn.simpleName === "Widget");

    expect(helper?.staticCallRefs).toBe(1);
    expect(widget?.jsxRefs).toBe(1);
  });

  it("does not count built-in property calls as local function references", () => {
    const text = `
      function push(value: number) {
        return value;
      }

      function caller(items: number[]) {
        items.push(1);
        return push(2);
      }
    `;
    const analysis = analyzeSourceText("/tmp/sample.ts", "sample.ts", text);
    applyStaticReferences(analysis.functions, analysis.calls);

    const push = analysis.functions.find((fn) => fn.simpleName === "push");
    expect(push?.staticCallRefs).toBe(1);
    expect(push?.bigO).toBe("O(1)");
  });

  it("prefers same-file matches when local helpers share a name", () => {
    const first = analyzeSourceText(
      "/tmp/a.ts",
      "a.ts",
      `function clean(value: string) { return value.trim(); }\nclean(" a ");`
    );
    const second = analyzeSourceText(
      "/tmp/b.ts",
      "b.ts",
      `function clean(value: string) { return value.toLowerCase(); }`
    );
    const functions = [...first.functions, ...second.functions];
    applyStaticReferences(functions, [...first.calls, ...second.calls]);

    expect(functions.find((fn) => fn.relativePath === "a.ts")?.staticCallRefs).toBe(1);
    expect(functions.find((fn) => fn.relativePath === "b.ts")?.staticCallRefs).toBe(0);
  });

  it("estimates Big-O from loops, nested loops, sorting, and recursion", () => {
    const text = `
      function linear(items: number[]) {
        for (const item of items) console.log(item);
      }

      function quadratic(items: number[]) {
        for (const a of items) {
          for (const b of items) console.log(a + b);
        }
      }

      function sorted(items: number[]) {
        return items.toSorted();
      }

      function recursive(n: number): number {
        if (n <= 1) return 1;
        return n * recursive(n - 1);
      }
    `;
    const functions = analyzeSourceText("/tmp/sample.ts", "sample.ts", text).functions;

    expect(functions.find((fn) => fn.simpleName === "linear")?.bigO).toBe("O(n)");
    expect(functions.find((fn) => fn.simpleName === "quadratic")?.bigO).toBe("O(n^2)");
    expect(functions.find((fn) => fn.simpleName === "sorted")?.bigO).toBe("O(n log n)");
    expect(functions.find((fn) => fn.simpleName === "recursive")?.bigO).toBe("recursive");
  });
});

describe("code-health-report project analysis", () => {
  it("reports repeated domain concepts and tracked directory sizes", () => {
    const root = mkdtempSync(path.join(tmpdir(), "code-health-"));
    mkdirSync(path.join(root, "src"), { recursive: true });
    mkdirSync(path.join(root, ".webdev", "images"), { recursive: true });
    writeFileSync(
      path.join(root, "src", "a.ts"),
      "export interface ShotAsset { id: string }\n",
      { flag: "wx" }
    );
    writeFileSync(
      path.join(root, "src", "b.ts"),
      "export type ShotAsset = { imageUrl: string }\n",
      { flag: "wx" }
    );
    writeFileSync(path.join(root, ".webdev", "images", "one.png"), "x", {
      flag: "wx",
    });

    const report = analyzeProject({
      root,
      sourceDirs: ["src"],
      trackedDirs: [".webdev", ".webdev/images"],
    });
    const markdown = buildMarkdownReport(report, 5);

    expect(report.conceptDuplicates[0]).toMatchObject({
      name: "ShotAsset",
      uniqueFiles: 2,
    });
    expect(report.trackedDirectorySizes.find((entry) => entry.relativePath === ".webdev/images")?.exists).toBe(true);
    expect(markdown).toContain("Repeated Domain Concepts");
    expect(markdown).toContain("Tracked Directory Trend");
  });

  it("merges V8 coverage function counts into runtimeHits", () => {
    const root = mkdtempSync(path.join(tmpdir(), "code-health-"));
    const srcDir = path.join(root, "src");
    const coverageDir = path.join(root, "coverage");
    const sourcePath = path.join(srcDir, "sample.ts");
    const source = `export function hot() {\n  return 42;\n}\n`;
    const startOffset = source.indexOf("function hot");

    mkdirSync(srcDir, { recursive: true });
    mkdirSync(coverageDir, { recursive: true });
    writeFileSync(sourcePath, source, { flag: "wx" });
    writeFileSync(
      path.join(coverageDir, "coverage-1.json"),
      JSON.stringify({
        result: [
          {
            url: pathToFileURL(sourcePath).href,
            functions: [
              {
                functionName: "hot",
                ranges: [{ startOffset, endOffset: source.length, count: 7 }],
              },
            ],
          },
        ],
      }),
      { flag: "wx" }
    );

    const report = analyzeProject({
      root,
      sourceDirs: ["src"],
      coverageDir: "coverage",
    });

    expect(report.coverageFilesLoaded).toBe(1);
    expect(report.functions.find((fn) => fn.simpleName === "hot")?.runtimeHits).toBe(7);
  });
});

describe("formatBytes", () => {
  it("formats common byte ranges", () => {
    expect(formatBytes(512)).toBe("512B");
    expect(formatBytes(2048)).toBe("2.0KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.00MB");
  });
});
