import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";

const srcRoot = import.meta.dirname;
const repoRoot = path.resolve(srcRoot, "..", "..");
const componentsRoot = path.join(srcRoot, "components");
const archiveRoot = path.join(srcRoot, "archive");
const sharedRoot = path.join(repoRoot, "shared");
const serverRoot = path.join(repoRoot, "server");

const allowedTopLevelComponents = new Set(["ErrorBoundary.tsx", "ui"]);
const sourceExtensions = new Set([".ts", ".tsx"]);

function toRepoPath(filePath: string) {
  return path.relative(repoRoot, filePath).split(path.sep).join("/");
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter(entry => !entry.name.startsWith("."))
      .map(async entry => {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) return listFiles(fullPath);
        return [fullPath];
      })
  );
  return files.flat();
}

function isUnder(child: string, parent: string) {
  const relative = path.relative(parent, child);
  return (
    Boolean(relative) &&
    !relative.startsWith("..") &&
    !path.isAbsolute(relative)
  );
}

async function activeSourceFiles() {
  const files = await listFiles(srcRoot);
  return files.filter(file => {
    if (isUnder(file, archiveRoot)) return false;
    if (path.basename(file) === "architecture-boundaries.test.ts") return false;
    return sourceExtensions.has(path.extname(file));
  });
}

async function readSources(files: string[]) {
  return Promise.all(
    files.map(async file => ({
      file,
      content: await fs.readFile(file, "utf8"),
    }))
  );
}

// Start the two repository walks during collection and reuse their contents.
// Re-scanning and reading every frontend file once per assertion made these
// guards contend with unrelated test transforms and hit Vitest's 5s timeout.
const activeSourcesPromise = activeSourceFiles().then(readSources);
const sharedSourcesPromise = listFiles(sharedRoot)
  .then(files => files.filter(file => sourceExtensions.has(path.extname(file))))
  .then(readSources);
const serverSourcesPromise = listFiles(serverRoot)
  .then(files =>
    files.filter(
      file =>
        sourceExtensions.has(path.extname(file)) &&
        !file.endsWith(".test.ts")
    )
  )
  .then(readSources);

describe("frontend architecture boundaries", () => {
  it("keeps shared contracts independent from client and server implementations", async () => {
    const sources = await sharedSourcesPromise;
    const implementationImportPattern =
      /(?:from\s+|import\s*\()\s*["'](?:@\/|(?:\.\.\/)+(?:client|server)\/)/;
    const violations: string[] = [];

    for (const { file, content } of sources) {
      if (implementationImportPattern.test(content)) {
        violations.push(toRepoPath(file));
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps top-level components limited to shared platform UI", async () => {
    const entries = await fs.readdir(componentsRoot, { withFileTypes: true });
    const unexpected = entries
      .filter(entry => !entry.name.startsWith("."))
      .map(entry => entry.name)
      .filter(name => !allowedTopLevelComponents.has(name));

    expect(unexpected).toEqual([]);
  });

  it("does not import from retired frontend paths", async () => {
    const sources = await activeSourcesPromise;
    const retiredImportPattern =
      /from\s+["'](?:@\/contexts\/(?:NayinContext|ThemeContext)|@\/lib\/(?:nayin|favicon|mockData)|@\/features\/analysis\/hooks\/useAnalysisWorkspace)["']/;
    const violations: string[] = [];

    for (const { file, content } of sources) {
      if (retiredImportPattern.test(content)) {
        violations.push(toRepoPath(file));
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps ScopeKey free of a userId field", async () => {
    const scopedResourcePath = path.join(sharedRoot, "scopedResource.ts");
    const content = await fs.readFile(scopedResourcePath, "utf8");
    const start = content.indexOf("export type ScopeKey");
    const end = content.indexOf("export type ScopedRevision");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const scopeKeyBlock = content.slice(start, end);

    expect(/\buserId\s*:/.test(scopeKeyBlock)).toBe(false);
  });

  it("does not construct a ScopeKey-shaped object with an embedded client userId in server code", async () => {
    // A regex line-window heuristic, not an AST check — it catches the
    // realistic case (userId set near a resourceKind-discriminated object
    // literal or via a helper) but not every possible construction (e.g.
    // userId assigned many lines away, or via spread from an unrelated
    // variable). Revisit with a real AST check once U3 starts wiring
    // ScopeKey into server code and this guard has real violations to catch.
    const sources = await serverSourcesPromise;
    // Matches a `resourceKind:` key regardless of whether its value is a
    // string literal or an identifier/expression (e.g. `resourceKind: kind`),
    // since the latter is the realistic shape once server code builds
    // ScopeKeys through a helper instead of inline literals.
    const resourceKindLinePattern = /\bresourceKind\s*:\s*\S/;
    const userIdKeyPattern = /\buserId\s*:/;
    const violations: string[] = [];

    for (const { file, content } of sources) {
      const lines = content.split("\n");
      lines.forEach((line, index) => {
        if (!resourceKindLinePattern.test(line)) return;
        const windowStart = Math.max(0, index - 6);
        const windowEnd = Math.min(lines.length, index + 7);
        const window = lines.slice(windowStart, windowEnd).join("\n");
        if (userIdKeyPattern.test(window)) {
          violations.push(`${toRepoPath(file)}:${index + 1}`);
        }
      });
    }

    expect(violations).toEqual([]);
  });

  it("does not import feature-specific files from components", async () => {
    const sources = await activeSourcesPromise;
    const componentImportPattern =
      /from\s+["']@\/components\/(?!ui\/|ErrorBoundary["'])/;
    const violations: string[] = [];

    for (const { file, content } of sources) {
      if (componentImportPattern.test(content)) {
        violations.push(toRepoPath(file));
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps Story Agent client traffic on tRPC", async () => {
    const sources = await activeSourcesPromise;
    const archiveStoryApiPattern = /\/api\/archive\/(?:story-agent|stories)/;
    const violations: string[] = [];

    for (const { file, content } of sources) {
      if (archiveStoryApiPattern.test(content)) {
        violations.push(toRepoPath(file));
      }
    }

    expect(violations).toEqual([]);
  });

  // Invalidating a query without narrowing it drops EVERY cached entry for that
  // procedure, so editing story A silently blows away story B's cache — the
  // cross-scope coupling this refactor exists to remove.
  //
  // This guard fails CLOSED: it flags every unnarrowed `utils.*.invalidate()`
  // and then subtracts the procedures verified to carry no scope input. A newly
  // added story-scoped procedure therefore breaks the build until someone
  // decides which side it belongs on, instead of silently going unguarded.
  //
  // Only add a procedure here after confirming its router input takes no
  // scoping field (a pagination-only input like `{ limit }` still counts as
  // unscoped). See docs/qa/refactor-coupling-baseline-2026-08-14.md section D2.
  const unscopedQueryProcedures = new Set([
    "auth.me",
    "project.list",
    "storyAgent.storyList",
    "emotionAnalysis.getProfile",
    "emotionAnalysis.listDailyLetters",
  ]);

  // `utils.a.b.invalidate()` / `.invalidate(undefined)` / `.invalidate({})` all
  // wipe the whole procedure. A router-level `utils.shot.invalidate()` wipes an
  // entire namespace, so it is matched too (2+ segments, shortest match wins).
  const unnarrowedInvalidatePattern =
    /\butils((?:\.[A-Za-z0-9_]+)+)\.invalidate\(\s*(?:undefined|\{\s*\})?\s*\)/g;

  it("never invalidates a query without narrowing it to its scope", async () => {
    const sources = await activeSourcesPromise;
    const violations: string[] = [];

    for (const { file, content } of sources) {
      for (const match of content.matchAll(unnarrowedInvalidatePattern)) {
        const procedure = match[1].replace(/^\./, "");
        if (!unscopedQueryProcedures.has(procedure)) {
          violations.push(`${toRepoPath(file)} -> ${procedure}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("the unnarrowed-invalidate matcher actually matches what it claims", () => {
    // Locks the matcher itself down: a regex that silently stops matching would
    // make the guard above pass vacuously forever.
    const shouldMatch = [
      "utils.shot.list.invalidate()",
      "utils.shot.list.invalidate( )",
      "utils.shot.list.invalidate(undefined)",
      "utils.shot.list.invalidate({})",
      "utils.shot.invalidate()",
    ];
    const shouldNotMatch = [
      "utils.shot.list.invalidate({ storyId })",
      "utils.shot.list.invalidate({ storyId: activeStoryId })",
    ];

    for (const sample of shouldMatch) {
      expect([sample, new RegExp(unnarrowedInvalidatePattern.source).test(sample)]).toEqual([
        sample,
        true,
      ]);
    }
    for (const sample of shouldNotMatch) {
      expect([sample, new RegExp(unnarrowedInvalidatePattern.source).test(sample)]).toEqual([
        sample,
        false,
      ]);
    }
  });

  it("routes every login entry point through the identity-change cache reset", async () => {
    // Logging in swaps the session cookie without destroying the JS heap
    // (wouter SPA navigation), so the previous identity's cached queries — the
    // no-input ones like project.list / storyAgent.storyList / auth.me are keyed
    // identically for every user — would otherwise be served to the new user.
    // `useAuth().refresh` is `refreshAfterIdentityChange`, which clears the
    // whole query cache first. A new login path that skips it silently
    // reintroduces cross-identity reads, so require the two to travel together.
    const sources = await activeSourcesPromise;
    const loginEndpointPattern = /["'`][^"'`]*\/api\/auth\/[^"'`]*login[^"'`]*["'`]/;
    const violations: string[] = [];

    for (const { file, content } of sources) {
      if (!loginEndpointPattern.test(content)) continue;
      if (!/\brefresh\s*\(\s*\)/.test(content)) {
        violations.push(toRepoPath(file));
      }
    }

    expect(violations).toEqual([]);
  });

});
