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

describe("architecture boundaries", () => {
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

  // ────────────────────────────────────────────────────────────────────
  // 架构棘轮（2026-08-23 冻结）
  // 只阻止新增债务，不要求偿还历史债务。基线来历、豁免登记与摘除条件见
  // docs/qa/architecture-ratchet-baseline-2026-08-23.md
  // ────────────────────────────────────────────────────────────────────

  // 单双引号都要匹配：最初一次性 grep 只看了双引号，把 editContext.ts 和
  // semanticAnnotation.ts 这两个用单引号的文件漏掉了，于是基线被低估成 49。
  const directDbImportPattern = /from\s+["'](?:\.\.?\/)+db["']/;

  // 用集合而不是计数：计数挡不住「删一个旧的、加一个新的」把债务平移过去。
  const directDbImportBaseline = new Set([
    "server/_core/context.ts",
    "server/_core/index.ts",
    "server/_core/mediaRouteAuth.ts",
    "server/_core/oauth.ts",
    "server/_core/sdk.ts",
    "server/archive/storyAgent.prompts.ts",
    "server/archive/storyReply.ts",
    "server/routers/_projectAccess.ts",
    "server/routers/_storyShared.ts",
    "server/routers/creationAgent.ts",
    "server/routers/index.ts",
    "server/routers/promptLineage.ts",
    "server/routers/publishingDraft.ts",
    "server/routers/storyAgent.ts",
    "server/services/artPromptLibrary.ts",
    "server/services/chatCutXml.ts",
    "server/services/creationAgent.ts",
    "server/services/directorAdvice.ts",
    "server/services/editContext.ts",
    "server/services/editingTransitionWorkflow.ts",
    "server/services/emotionDailyLetters.ts",
    "server/services/emotionProfileDailyRefresh.ts",
    "server/services/imageAssets.ts",
    "server/services/localMotionVideo.ts",
    "server/services/promptLineage.ts",
    "server/services/promptLineageMigration.ts",
    "server/services/promptLineageStore.ts",
    "server/services/publishingAlbumBackgroundGeneration.ts",
    "server/services/publishingPersistence.ts",
    "server/services/publishingVideoStoryboardPersistence.ts",
    "server/services/renderGate.ts",
    "server/services/resonanceSignal.ts",
    "server/services/semanticAnnotation.ts",
    "server/services/shotConsistency.ts",
    "server/services/shotDerivation.ts",
    "server/services/shotVideoDirection.ts",
    "server/services/startEndShotVideoWorkflow.ts",
    "server/services/storyBodyPersistence.ts",
    "server/services/storyConversation.ts",
    "server/services/storyMaterials.ts",
    "server/services/storyShotFieldPatch.ts",
    "server/services/timelineEditAgent.ts",
    "server/services/videoAssets.ts",
    "server/services/videoConform.ts",
    "server/services/videoEndpointFrames.ts",
    "server/services/videoJobs.ts",
    "server/services/videoTimeline.ts",
    "server/services/visualAssetCreation.ts",
    "server/services/visualAssetGenerationContext.ts",
    "server/services/visualAssetPersistence.ts",
    "server/services/visualClipEditing.ts",
  ]);

  async function currentDirectDbImporters() {
    const sources = await serverSourcesPromise;
    return sources
      .filter(({ content }) => directDbImportPattern.test(content))
      .map(({ file }) => toRepoPath(file))
      .sort();
  }

  it("does not add a new direct server/db.ts importer", async () => {
    const current = await currentDirectDbImporters();
    const added = current.filter(file => !directDbImportBaseline.has(file));

    // 新增一个直接 seam 之前，先问该走哪个领域 persistence；确实没有合适的，
    // 去 docs/qa/architecture-ratchet-baseline-2026-08-23.md 的豁免表登记
    // owner、原因和到期条件，再把文件加进上面的基线集合。
    expect(added).toEqual([]);
  });

  it("does not leave stale entries in the direct-db baseline", async () => {
    const current = new Set(await currentDirectDbImporters());
    const stale = [...directDbImportBaseline].filter(file => !current.has(file)).sort();

    // 这条失败是好消息：某个文件不再直接摸 db 了。请在同一个提交里把它从
    // 基线集合删掉——否则清单会烂掉，几个月后没人知道它还准不准。
    expect(stale).toEqual([]);
  });

  it("the direct-db matcher actually matches what it claims", () => {
    const shouldMatch = [
      'import { getStoryById } from "../db";',
      "import { getStoryById } from '../db';",
      'import type { Story } from "./db";',
      'import { x } from "../../db";',
    ];
    const shouldNotMatch = [
      'import { x } from "../dbHelpers";',
      'import { x } from "@shared/db-contract";',
      'import { x } from "../db/index";',
    ];

    for (const sample of shouldMatch) {
      expect([sample, directDbImportPattern.test(sample)]).toEqual([sample, true]);
    }
    for (const sample of shouldNotMatch) {
      expect([sample, directDbImportPattern.test(sample)]).toEqual([sample, false]);
    }
  });

  // 客户端一旦能上传整份带绝对帧的 items，服务端就无从判断用户想动哪一个 clip，
  // 也就无法保证「只有它该动」——正是 extracted-frame-overlay-video 第 9 条
  // 不变量要禁止的事。
  const timelineItemsArrayPattern = /items:\s*z\.array\(/;
  const clientComputedPositionField = /\btimelineStartFrame\b/;

  // U7 摘除。摘掉这一条就是本轮收敛的完成信号。
  const clientComputedPositionExemptions = new Set([
    "server/routers/creationAgent.ts",
  ]);

  it("does not accept client-computed clip positions in tRPC input", async () => {
    const sources = await serverSourcesPromise;
    const violations: string[] = [];

    for (const { file, content } of sources) {
      const repoPath = toRepoPath(file);
      if (clientComputedPositionExemptions.has(repoPath)) continue;
      const lines = content.split("\n");
      lines.forEach((line, index) => {
        if (!timelineItemsArrayPattern.test(line)) return;
        // 一个 items 数组的 zod 结构在本仓库里通常几十行；取 80 行窗口足够
        // 覆盖它，又不会跨到下一个 procedure 去误报。
        const window = lines.slice(index, Math.min(lines.length, index + 80)).join("\n");
        if (clientComputedPositionField.test(window)) {
          violations.push(`${repoPath}:${index + 1}`);
        }
      });
    }

    expect(violations).toEqual([]);
  });

  it("the client-computed-position matcher actually matches what it claims", () => {
    const offending = [
      "        items: z.array(",
      "          z.object({",
      "            stableShotId: z.string().min(1),",
      "            timelineStartFrame: z.number().int().min(0).optional(),",
      "          })",
      "        ),",
    ].join("\n");
    const acceptable = [
      "        items: z.array(",
      "          z.object({",
      "            stableShotId: z.string().min(1),",
      "            included: z.boolean(),",
      "          })",
      "        ),",
    ].join("\n");

    expect(timelineItemsArrayPattern.test(offending.split("\n")[0])).toBe(true);
    expect(clientComputedPositionField.test(offending)).toBe(true);
    expect(clientComputedPositionField.test(acceptable)).toBe(false);
  });

  // 只设上限，不设下限：变小随时欢迎，也不需要同步下调。
  // 行数是代理指标不是目标——把行搬到没有语义的 helper 里不算改善。
  const hotspotLineCeilings: Record<string, number> = {
    // 2026-08-24：上调 20 行。这不是「文件又长了」，是接线的最小成本——
  // 时间标尺、缩放控件和时间视口都已抽到 StoryboardTimelineRuler.tsx，
  // 留在本文件里的只有「调用两个组件 + 一个 hook」这 20 行，压不下去。
  //
  // 记在这里而不是默默改掉：这条守卫数的是原始行数，分不清 20 行接线和
  // 200 行新职责。它拦住我两次都是对的（第一次 4337 行、第二次 5715 行，
  // 两次都靠把代码放回该在的地方解决），这一次是它的口径不够细。
  //
  // 到期条件：底部时间线（EditingNleWorkspace，4425 行）删除后，本文件会
  // 接手它的部分职责或一并瘦身，届时重新丈量并把基线压回去。
  "client/src/features/storyAgent/views/StoryboardReviewBoard.tsx": 5632,
    "client/src/features/storyAgent/StoryAgentContext.tsx": 4528,
    // 2026-08-24：4425 → 3014。删除 MultiTrackTimeline（1282 行）后的实测值。
  // 上一版曾临时上调到 4464 放行时钟接线，到期条件就是这次删除——现在兑现，
  // 直接压到实际行数，不许退回 4425。
  "client/src/features/creationEditor/views/EditingNleWorkspace.tsx": 3014,
    "client/src/features/creationEditor/CreationEditorContext.tsx": 4329,
    "client/src/features/creationEditor/views/StoryboardEditRow.tsx": 3992,
    "client/src/features/publishingDraft/PublishingDraftWorkspace.tsx": 3305,
  };

  it("keeps hotspot files from growing past their frozen baseline", async () => {
    const overflows: string[] = [];

    for (const [repoPath, ceiling] of Object.entries(hotspotLineCeilings)) {
      const content = await fs.readFile(path.join(repoRoot, repoPath), "utf8");
      // 与 `wc -l` 同口径：末尾换行不算成额外一行。基线文档里的数字是 wc -l
      // 数出来的，差一会让人以为文件凭空长了一行。
      const lines = content.replace(/\n$/, "").split("\n").length;
      if (lines > ceiling) {
        overflows.push(`${repoPath}: ${lines} 行 > 基线 ${ceiling}（+${lines - ceiling}）`);
      }
    }

    expect(overflows).toEqual([]);
  });

  // 只断言「同名符号是否被导出了两次」这种可证明的事，不去猜两段逻辑是不是
  // 一回事。docs/qa/refactor-coupling-baseline-2026-08-14.md 的 2026-08-15
  // 复核证明过：七条「重复」里只有一条成立，照着其余几条做收敛会抹平真实的
  // 语义区分。宁可漏报，不可误报。
  const authoritativeSymbols: Record<string, string> = {
    compareVisualPriority: "shared/timelineVisualPriority.ts",
    pickVisualWinner: "shared/timelineVisualPriority.ts",
    hiddenVisualLayerSet: "shared/timelineVisualPriority.ts",
    normalizeShotIdentity: "shared/shotIdentity.ts",
    isRecoverablePublishingCoverGeneration: "shared/publishingDraft.ts",
  };

  it("keeps one authoritative implementation per cross-cutting semantic", async () => {
    const [sharedSources, serverSources, clientSources] = await Promise.all([
      sharedSourcesPromise,
      serverSourcesPromise,
      activeSourcesPromise,
    ]);
    const allSources = [...sharedSources, ...serverSources, ...clientSources];
    const violations: string[] = [];

    for (const [symbol, owner] of Object.entries(authoritativeSymbols)) {
      const exportPattern = new RegExp(
        `^export\\s+(?:async\\s+)?(?:function|const|class)\\s+${symbol}\\b`,
        "m"
      );
      const owners = allSources
        .filter(({ content }) => exportPattern.test(content))
        .map(({ file }) => toRepoPath(file))
        .sort();

      if (owners.length !== 1 || owners[0] !== owner) {
        violations.push(`${symbol}: 期望只由 ${owner} 导出，实际 ${JSON.stringify(owners)}`);
      }
    }

    expect(violations).toEqual([]);
  });

  it("the authoritative-symbol matcher actually matches what it claims", () => {
    const symbol = "compareVisualPriority";
    const exportPattern = new RegExp(
      `^export\\s+(?:async\\s+)?(?:function|const|class)\\s+${symbol}\\b`,
      "m"
    );
    const shouldMatch = [
      "export function compareVisualPriority(a, b) {}",
      "export const compareVisualPriority = (a, b) => 0;",
      "export async function compareVisualPriority(a, b) {}",
    ];
    const shouldNotMatch = [
      "import { compareVisualPriority } from '@shared/timelineVisualPriority';",
      "export function compareVisualPriorityFallback(a, b) {}",
      "const compareVisualPriority = (a, b) => 0;",
    ];

    for (const sample of shouldMatch) {
      expect([sample, exportPattern.test(sample)]).toEqual([sample, true]);
    }
    for (const sample of shouldNotMatch) {
      expect([sample, exportPattern.test(sample)]).toEqual([sample, false]);
    }
  });

});
