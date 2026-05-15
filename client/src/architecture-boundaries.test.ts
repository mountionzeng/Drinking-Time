import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";

const srcRoot = import.meta.dirname;
const repoRoot = path.resolve(srcRoot, "..", "..");
const componentsRoot = path.join(srcRoot, "components");
const archiveRoot = path.join(srcRoot, "archive");

const allowedTopLevelComponents = new Set(["ErrorBoundary.tsx", "ui"]);
const sourceExtensions = new Set([".ts", ".tsx"]);

function toRepoPath(filePath: string) {
  return path.relative(repoRoot, filePath).split(path.sep).join("/");
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => !entry.name.startsWith("."))
      .map(async (entry) => {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) return listFiles(fullPath);
        return [fullPath];
      }),
  );
  return files.flat();
}

function isUnder(child: string, parent: string) {
  const relative = path.relative(parent, child);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function activeSourceFiles() {
  const files = await listFiles(srcRoot);
  return files.filter((file) => {
    if (isUnder(file, archiveRoot)) return false;
    if (path.basename(file) === "architecture-boundaries.test.ts") return false;
    return sourceExtensions.has(path.extname(file));
  });
}

describe("frontend architecture boundaries", () => {
  it("keeps top-level components limited to shared platform UI", async () => {
    const entries = await fs.readdir(componentsRoot, { withFileTypes: true });
    const unexpected = entries
      .filter((entry) => !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .filter((name) => !allowedTopLevelComponents.has(name));

    expect(unexpected).toEqual([]);
  });

  it("does not import from retired frontend paths", async () => {
    const files = await activeSourceFiles();
    const retiredImportPattern =
      /from\s+["'](?:@\/contexts\/(?:NayinContext|ThemeContext)|@\/lib\/(?:nayin|favicon|mockData)|@\/features\/analysis\/hooks\/useAnalysisWorkspace)["']/;
    const violations: string[] = [];

    for (const file of files) {
      const content = await fs.readFile(file, "utf8");
      if (retiredImportPattern.test(content)) {
        violations.push(toRepoPath(file));
      }
    }

    expect(violations).toEqual([]);
  });

  it("does not import feature-specific files from components", async () => {
    const files = await activeSourceFiles();
    const componentImportPattern = /from\s+["']@\/components\/(?!ui\/|ErrorBoundary["'])/;
    const violations: string[] = [];

    for (const file of files) {
      const content = await fs.readFile(file, "utf8");
      if (componentImportPattern.test(content)) {
        violations.push(toRepoPath(file));
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps Story Agent client traffic on tRPC", async () => {
    const files = await activeSourceFiles();
    const archiveStoryApiPattern = /\/api\/archive\/(?:story-agent|stories)/;
    const violations: string[] = [];

    for (const file of files) {
      const content = await fs.readFile(file, "utf8");
      if (archiveStoryApiPattern.test(content)) {
        violations.push(toRepoPath(file));
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps analysis display views free of direct tRPC imports", async () => {
    const viewFiles = [
      path.join(srcRoot, "features", "analysis", "views", "DropZone.tsx"),
      path.join(srcRoot, "features", "analysis", "views", "Timeline.tsx"),
    ];
    const violations: string[] = [];

    for (const file of viewFiles) {
      const content = await fs.readFile(file, "utf8");
      if (/from\s+["']@\/lib\/trpc["']/.test(content)) {
        violations.push(toRepoPath(file));
      }
    }

    expect(violations).toEqual([]);
  });
});
