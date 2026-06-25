import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const DEFAULT_SOURCE_DIRS = ["client/src", "server", "shared"];
const DEFAULT_TOP = 20;
const DEFAULT_SNAPSHOT_DIR = ".code-health/snapshots";
const MAX_SNAPSHOTS = 40;
const COMMAND_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_TRACKED_DIRS = [
  ".webdev",
  ".webdev/images",
  "node_modules",
  "dist",
  "art-repository",
  "client/src/assets",
  "client/public",
  "client/public/archive",
  "drinking-time-vision",
  ".worktrees",
];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);
const DOMAIN_CONCEPT_PATTERN =
  /(Agent|Asset|Card|Chat|Creation|Editor|Image|Material|Message|Project|Prompt|Selection|Shot|Story|Video|Workspace)/;
const GENERIC_CONCEPT_NAMES = new Set([
  "Config",
  "Context",
  "Error",
  "Input",
  "Item",
  "Options",
  "Output",
  "Props",
  "Result",
  "State",
]);
const EXCLUDED_DIRS = new Set([
  ".code-health",
  ".git",
  ".manus-logs",
  ".next",
  ".pnpm-store",
  ".webdev",
  ".worktrees",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);
const LINEAR_METHODS = new Set([
  "concat",
  "every",
  "filter",
  "find",
  "findIndex",
  "flat",
  "flatMap",
  "forEach",
  "includes",
  "indexOf",
  "join",
  "lastIndexOf",
  "map",
  "match",
  "matchAll",
  "reduce",
  "reduceRight",
  "slice",
  "some",
  "split",
]);
const SORT_METHODS = new Set(["sort", "toSorted"]);
const MUTATING_LINEAR_METHODS = new Set(["reverse", "shift", "splice", "unshift"]);
const COMMON_BUILTIN_PROPERTY_CALLS = new Set([
  "add",
  "catch",
  "concat",
  "delete",
  "entries",
  "error",
  "every",
  "exec",
  "filter",
  "finally",
  "find",
  "findIndex",
  "flat",
  "flatMap",
  "forEach",
  "get",
  "has",
  "includes",
  "indexOf",
  "info",
  "join",
  "keys",
  "lastIndexOf",
  "log",
  "map",
  "match",
  "matchAll",
  "now",
  "parse",
  "pop",
  "push",
  "random",
  "reduce",
  "reduceRight",
  "reject",
  "replace",
  "resolve",
  "reverse",
  "set",
  "shift",
  "slice",
  "some",
  "sort",
  "splice",
  "split",
  "stringify",
  "test",
  "then",
  "toSorted",
  "unshift",
  "values",
  "warn",
]);

export interface CliOptions {
  root: string;
  sourceDirs: string[];
  trackedDirs: string[];
  includeTests: boolean;
  measureCommands: boolean;
  saveSnapshot: boolean;
  snapshotDir: string;
  top: number;
  outFile?: string;
  jsonFile?: string;
  coverageDir?: string;
}

export interface SizeEntry {
  path: string;
  relativePath: string;
  bytes: number;
  isDirectory: boolean;
  exists?: boolean;
}

export interface SourceFileSummary {
  path: string;
  relativePath: string;
  bytes: number;
  lineCount: number;
}

export interface FunctionMetric {
  id: string;
  filePath: string;
  relativePath: string;
  name: string;
  simpleName: string;
  kind: string;
  startLine: number;
  endLine: number;
  startOffset: number;
  endOffset: number;
  loc: number;
  exported: boolean;
  async: boolean;
  cyclomatic: number;
  loops: number;
  maxIterationDepth: number;
  collectionOps: number;
  collectionOpsInIterations: number;
  sortOps: number;
  recursive: boolean;
  staticCallRefs: number;
  jsxRefs: number;
  runtimeHits: number | null;
  bigO: string;
  riskScore: number;
  riskTags: string[];
}

export interface CallReference {
  name: string;
  kind: "call" | "jsx";
  access: "identifier" | "property" | "element" | "jsx";
  relativePath: string;
  line: number;
}

export interface SourceAnalysis {
  file: SourceFileSummary;
  functions: FunctionMetric[];
  calls: CallReference[];
  conceptDeclarations: ConceptDeclaration[];
}

export interface ProjectReport {
  generatedAt: string;
  root: string;
  sourceDirs: string[];
  includeTests: boolean;
  coverageDir?: string;
  coverageFilesLoaded: number;
  sourceFiles: SourceFileSummary[];
  topLevelSizes: SizeEntry[];
  trackedDirectorySizes: SizeEntry[];
  functions: FunctionMetric[];
  calls: CallReference[];
  conceptDuplicates: ConceptDuplicate[];
  environment: EnvironmentHealth;
  commandTimings: CommandTiming[];
  history?: SnapshotComparison;
}

export interface ConceptDeclaration {
  name: string;
  kind: "class" | "enum" | "interface" | "type";
  relativePath: string;
  line: number;
  exported: boolean;
}

export interface ConceptDuplicate {
  name: string;
  declarations: ConceptDeclaration[];
  uniqueFiles: number;
  exportedCount: number;
  score: number;
}

export interface DataFileHealth {
  exists: boolean;
  path: string;
  sizeBytes?: number;
  mtimeMs?: number;
}

export interface WorktreeHealth {
  path: string;
  branch: string;
  head: string;
  dataFile: DataFileHealth;
}

export interface ListenerHealth {
  command: string;
  pid: number;
  port: number;
  cwd: string | null;
  worktreePath: string | null;
}

export interface EnvironmentHealth {
  currentBranch: string | null;
  head: string | null;
  dirtyFileCount: number | null;
  worktrees: WorktreeHealth[];
  listeners: ListenerHealth[];
  warnings: string[];
}

export interface CommandTiming {
  name: string;
  command: string;
  durationMs: number;
  status: "passed" | "failed" | "skipped";
  exitCode: number | null;
  outputTail?: string;
}

export interface SnapshotMetricDelta {
  name: string;
  current: number;
  previous?: number;
  delta?: number;
  baseline?: number;
  sinceBaseline?: number;
}

export interface DirectoryTrend {
  path: string;
  currentBytes: number;
  previousBytes?: number;
  deltaBytes?: number;
  baselineBytes?: number;
  sinceBaselineBytes?: number;
}

export interface SnapshotComparison {
  snapshotCount: number;
  previousGeneratedAt?: string;
  baselineGeneratedAt?: string;
  metrics: SnapshotMetricDelta[];
  directories: DirectoryTrend[];
}

export interface HealthSnapshot {
  generatedAt: string;
  sourceFiles: number;
  sourceBytes: number;
  functions: number;
  highRiskFunctions: number;
  possibleUnusedFunctions: number;
  trackedDirectories: Array<{ path: string; bytes: number; exists: boolean }>;
  largestSourceFiles: Array<{ path: string; bytes: number; lines: number }>;
  highRiskFunctionIds: Array<{
    id: string;
    name: string;
    file: string;
    line: number;
    score: number;
    bigO: string;
  }>;
  duplicateConcepts: Array<{ name: string; uniqueFiles: number; declarations: number }>;
  environmentWarnings: string[];
  commandTimings: CommandTiming[];
}

interface ComplexityMetric {
  cyclomatic: number;
  loops: number;
  maxIterationDepth: number;
  collectionOps: number;
  collectionOpsInIterations: number;
  sortOps: number;
  recursive: boolean;
}

type AnyFunction =
  | ts.ArrowFunction
  | ts.ConstructorDeclaration
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.GetAccessorDeclaration
  | ts.MethodDeclaration
  | ts.SetAccessorDeclaration;

interface V8Coverage {
  result?: V8ScriptCoverage[];
}

interface V8ScriptCoverage {
  url: string;
  functions?: V8FunctionCoverage[];
}

interface V8FunctionCoverage {
  functionName: string;
  ranges: V8RangeCoverage[];
}

interface V8RangeCoverage {
  startOffset: number;
  endOffset: number;
  count: number;
}

export function analyzeProject(input: Partial<CliOptions> = {}): ProjectReport {
  const options = normalizeOptions(input);
  const sourceFiles = discoverSourceFiles(
    options.root,
    options.sourceDirs,
    options.includeTests
  );
  const analyses = sourceFiles.map((file) =>
    analyzeSourceText(file.path, file.relativePath, readFileSync(file.path, "utf-8"))
  );
  const functions = analyses.flatMap((analysis) => analysis.functions);
  const calls = analyses.flatMap((analysis) => analysis.calls);
  const conceptDeclarations = analyses.flatMap((analysis) => analysis.conceptDeclarations);
  applyStaticReferences(functions, calls);
  const coverageFilesLoaded = options.coverageDir
    ? applyRuntimeCoverage(functions, options.root, options.coverageDir)
    : 0;

  functions.forEach(finalizeRisk);

  const report: ProjectReport = {
    generatedAt: new Date().toISOString(),
    root: options.root,
    sourceDirs: options.sourceDirs,
    includeTests: options.includeTests,
    coverageDir: options.coverageDir,
    coverageFilesLoaded,
    sourceFiles: analyses.map((analysis) => analysis.file),
    topLevelSizes: collectTopLevelSizes(options.root),
    trackedDirectorySizes: collectTrackedSizes(options.root, options.trackedDirs),
    functions,
    calls,
    conceptDuplicates: buildConceptDuplicates(conceptDeclarations),
    environment: collectEnvironmentHealth(options.root),
    commandTimings: options.measureCommands
      ? collectCommandTimings(options.root)
      : skippedCommandTimings(),
  };
  report.history = compareSnapshots(makeHealthSnapshot(report), readSnapshots(options.snapshotDir));
  return report;
}

export function analyzeSourceText(
  filePath: string,
  relativePath: string,
  text: string
): SourceAnalysis {
  const scriptKind = scriptKindForFile(filePath);
  const sourceFile = ts.createSourceFile(
    filePath,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKind
  );
  const file: SourceFileSummary = {
    path: filePath,
    relativePath,
    bytes: Buffer.byteLength(text),
    lineCount: countLines(text),
  };
  const functions: FunctionMetric[] = [];
  const calls: CallReference[] = [];
  const conceptDeclarations: ConceptDeclaration[] = [];

  function visit(node: ts.Node): void {
    if (isAnyFunction(node)) {
      functions.push(buildFunctionMetric(node, sourceFile, filePath, relativePath));
    }
    const concept = getConceptDeclaration(node, sourceFile, relativePath);
    if (concept) conceptDeclarations.push(concept);

    if (ts.isCallExpression(node)) {
      const call = getCallReference(node.expression);
      if (call) {
        calls.push({
          name: call.name,
          kind: "call",
          access: call.access,
          relativePath,
          line: lineOf(sourceFile, node.getStart(sourceFile)),
        });
      }
    } else if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const name = getJsxTagName(node.tagName);
      if (name) {
        calls.push({
          name,
          kind: "jsx",
          access: "jsx",
          relativePath,
          line: lineOf(sourceFile, node.getStart(sourceFile)),
        });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  functions.forEach(finalizeRisk);
  return { file, functions, calls, conceptDeclarations };
}

export function applyStaticReferences(
  functions: FunctionMetric[],
  calls: CallReference[]
): void {
  const byName = new Map<string, FunctionMetric[]>();
  for (const fn of functions) {
    if (!fn.simpleName || fn.simpleName.startsWith("callback@")) continue;
    const list = byName.get(fn.simpleName) ?? [];
    list.push(fn);
    byName.set(fn.simpleName, list);
  }

  for (const call of calls) {
    const targets = narrowStaticTargets(
      call,
      byName.get(call.name)?.filter((fn) => shouldCountCallForFunction(call, fn)) ?? []
    );
    if (!targets) continue;
    for (const target of targets) {
      if (call.kind === "jsx") target.jsxRefs += 1;
      else target.staticCallRefs += 1;
    }
  }
}

export function buildMarkdownReport(report: ProjectReport, top = DEFAULT_TOP): string {
  const sourceBytes = sum(report.sourceFiles.map((file) => file.bytes));
  const runtimeMode = report.coverageDir
    ? `${report.coverageFilesLoaded} V8 coverage file(s) loaded`
    : "no runtime coverage loaded";
  const runtimeHitFunctionCount = report.functions.filter((fn) => (fn.runtimeHits ?? 0) > 0)
    .length;
  const functions = [...report.functions].sort((a, b) => b.riskScore - a.riskScore);
  const hasRuntimeHits = runtimeHitFunctionCount > 0;
  const callHotspots = [...report.functions]
    .filter((fn) =>
      hasRuntimeHits
        ? (fn.runtimeHits ?? 0) > 0
        : fn.staticCallRefs + fn.jsxRefs > 0
    )
    .sort((a, b) => {
      if (hasRuntimeHits) return (b.runtimeHits ?? 0) - (a.runtimeHits ?? 0);
      return b.staticCallRefs + b.jsxRefs - (a.staticCallRefs + a.jsxRefs);
    });
  const risky = functions.filter((fn) => fn.riskScore >= 15);
  const unused = possibleUnusedFunctions(report.functions);
  const largestSources = [...report.sourceFiles].sort((a, b) => b.bytes - a.bytes);
  const directoryTrends: DirectoryTrend[] =
    report.history?.directories ??
    report.trackedDirectorySizes.map((entry) => ({
      path: entry.relativePath,
      currentBytes: entry.bytes,
    }));

  const lines: string[] = [];
  lines.push("# Code Health Report", "");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Root: \`${report.root}\``);
  lines.push(`Sources: ${report.sourceDirs.map((dir) => `\`${dir}\``).join(", ")}`);
  lines.push(`Runtime mode: ${runtimeMode}`);
  lines.push("");
  lines.push("## What This Measures", "");
  lines.push(
    "- Static call references are AST matches for function calls and JSX component usage. They are useful for triage, but they are not proof of runtime traffic."
  );
  lines.push(
    "- Runtime hits are merged from Node/V8 coverage output when `--coverage` is provided. Those counts reflect code executed during that sampled run only."
  );
  lines.push(
    "- Some TS runners hide source file URLs from Node's native coverage. If coverage files load but runtime hits stay at zero, use the static report or sample a plain Node/compiled entry."
  );
  lines.push(
    "- Big-O is a heuristic from loops, collection methods, sorting, and recursion. Treat it as a shortlist for review, not a formal proof."
  );
  lines.push("");
  lines.push("## Summary", "");
  lines.push(
    markdownTable(
      ["Metric", "Value"],
      [
        ["Source files", String(report.sourceFiles.length)],
        ["Source bytes", formatBytes(sourceBytes)],
        ["Functions indexed", String(report.functions.length)],
        ["Call references indexed", String(report.calls.length)],
        ["Runtime coverage files", String(report.coverageFilesLoaded)],
        ["Runtime-hit functions", String(runtimeHitFunctionCount)],
        ["High-risk functions", String(risky.length)],
        ["Possible unused local functions", String(unused.length)],
      ]
    )
  );
  if (report.coverageDir && report.coverageFilesLoaded > 0 && runtimeHitFunctionCount === 0) {
    lines.push("");
    lines.push(
      "> Runtime coverage files were loaded, but none mapped back to indexed source functions. This usually means the runner emitted coverage for transformed/internal modules instead of project file URLs."
    );
  }
  lines.push("");
  lines.push("## Trend Since Last Snapshot", "");
  if (!report.history || report.history.snapshotCount === 0) {
    lines.push("No previous snapshots yet. Run with `--snapshot` on monitoring days to build trend history.");
  } else {
    lines.push(
      `Compared with previous snapshot: ${report.history.previousGeneratedAt ?? "n/a"}`
    );
    lines.push(
      markdownTable(
        ["Metric", "Current", "Prev delta", "Since baseline"],
        report.history.metrics.map((metric) => [
          metric.name,
          formatMetricValue(metric.name, metric.current),
          formatMetricDelta(metric.name, metric.delta),
          formatMetricDelta(metric.name, metric.sinceBaseline),
        ])
      )
    );
  }
  lines.push("");
  lines.push("## Tracked Directory Trend", "");
  lines.push(
    markdownTable(
      ["Path", "Current", "Prev delta", "Since baseline"],
      directoryTrends.map((entry) => [
        `\`${entry.path}\``,
        formatBytes(entry.currentBytes),
        formatBytesDelta(entry.deltaBytes),
        formatBytesDelta(entry.sinceBaselineBytes),
      ])
    )
  );
  lines.push("");
  lines.push("## Environment Split Check", "");
  lines.push(
    markdownTable(
      ["Signal", "Value"],
      [
        ["Branch", report.environment.currentBranch ?? "unknown"],
        ["HEAD", report.environment.head ?? "unknown"],
        ["Dirty files", report.environment.dirtyFileCount === null ? "unknown" : String(report.environment.dirtyFileCount)],
        ["Worktrees", String(report.environment.worktrees.length)],
        ["Project node listeners", String(report.environment.listeners.filter((listener) => listener.worktreePath !== null).length)],
        [
          "Data files",
          String(report.environment.worktrees.filter((worktree) => worktree.dataFile.exists).length),
        ],
      ]
    )
  );
  if (report.environment.warnings.length > 0) {
    lines.push("");
    for (const warning of report.environment.warnings) lines.push(`- ${warning}`);
  }
  lines.push("");
  lines.push("## Command Timing", "");
  lines.push(
    markdownTable(
      ["Command", "Status", "Duration", "Exit"],
      report.commandTimings.map((timing) => [
        `\`${timing.command}\``,
        timing.status,
        timing.status === "skipped" ? "skipped" : formatDuration(timing.durationMs),
        timing.exitCode === null ? "-" : String(timing.exitCode),
      ])
    )
  );
  lines.push("");
  lines.push("## Repeated Domain Concepts", "");
  if (report.conceptDuplicates.length === 0) {
    lines.push("No repeated domain concept declarations found by the current heuristic.");
  } else {
    lines.push(
      markdownTable(
        ["Concept", "Files", "Declarations", "Examples"],
        report.conceptDuplicates.slice(0, top).map((concept) => [
          `\`${concept.name}\``,
          String(concept.uniqueFiles),
          String(concept.declarations.length),
          concept.declarations
            .slice(0, 3)
            .map((item) => `${item.relativePath}:${item.line}`)
            .join(", "),
        ])
      )
    );
  }
  lines.push("");
  lines.push("## Disk Footprint", "");
  lines.push(
    markdownTable(
      ["Path", "Size", "Kind"],
      report.topLevelSizes
        .slice(0, top)
        .map((entry) => [
          `\`${entry.relativePath}\``,
          formatBytes(entry.bytes),
          entry.isDirectory ? "dir" : "file",
        ])
    )
  );
  lines.push("");
  lines.push("## Call Hotspots", "");
  if (callHotspots.length === 0) {
    lines.push("No call hotspot data yet. Run with `--coverage <dir>` for runtime hits.");
  } else {
    lines.push(
      markdownTable(
        hasRuntimeHits
          ? ["runtimeHits", "staticRefs", "Big-O", "Complexity", "LOC", "Function"]
          : ["staticRefs", "JSX refs", "Big-O", "Complexity", "LOC", "Function"],
        callHotspots.slice(0, top).map((fn) =>
          hasRuntimeHits
            ? [
                String(fn.runtimeHits ?? 0),
                String(fn.staticCallRefs + fn.jsxRefs),
                fn.bigO,
                String(fn.cyclomatic),
                String(fn.loc),
                functionLink(fn),
              ]
            : [
                String(fn.staticCallRefs),
                String(fn.jsxRefs),
                fn.bigO,
                String(fn.cyclomatic),
                String(fn.loc),
                functionLink(fn),
              ]
        )
      )
    );
  }
  lines.push("");
  lines.push("## Optimization Candidates", "");
  if (risky.length === 0) {
    lines.push("No high-risk functions crossed the default risk threshold.");
  } else {
    lines.push(
      markdownTable(
        ["Score", "Big-O", "Complexity", "LOC", "Signals", "Function"],
        risky.slice(0, top).map((fn) => [
          String(fn.riskScore),
          fn.bigO,
          String(fn.cyclomatic),
          String(fn.loc),
          fn.riskTags.join(", "),
          functionLink(fn),
        ])
      )
    );
  }
  lines.push("");
  lines.push("## Largest Source Files", "");
  lines.push(
    markdownTable(
      ["Size", "Lines", "File"],
      largestSources.slice(0, top).map((file) => [
        formatBytes(file.bytes),
        String(file.lineCount),
        `\`${file.relativePath}\``,
      ])
    )
  );
  lines.push("");
  lines.push("## Possible Cleanup Candidates", "");
  if (unused.length === 0) {
    lines.push("No unused local functions found by the static reference pass.");
  } else {
    lines.push(
      markdownTable(
        ["LOC", "Big-O", "Function"],
        unused.slice(0, top).map((fn) => [
          String(fn.loc),
          fn.bigO,
          functionLink(fn),
        ])
      )
    );
  }
  lines.push("");
  lines.push("## Next Sampling Commands", "");
  lines.push("```bash");
  lines.push("node_modules/.bin/tsx scripts/code-health-report.ts --out .code-health/static.md --json .code-health/static.json");
  lines.push("node_modules/.bin/tsx scripts/code-health-report.ts --snapshot --out .code-health/latest.md --json .code-health/latest.json");
  lines.push("node_modules/.bin/tsx scripts/code-health-report.ts --snapshot --measure-commands --out .code-health/weekly.md --json .code-health/weekly.json");
  lines.push("mkdir -p .code-health/v8");
  lines.push("# Run a plain Node entry or compiled server while exercising the workflow you care about:");
  lines.push("NODE_V8_COVERAGE=.code-health/v8 node --enable-source-maps dist/index.js");
  lines.push("node_modules/.bin/tsx scripts/code-health-report.ts --coverage .code-health/v8 --out .code-health/runtime.md --json .code-health/runtime.json");
  lines.push("```");
  lines.push("");
  return lines.join("\n");
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${bytes}B`;
}

function normalizeOptions(input: Partial<CliOptions>): CliOptions {
  const root = path.resolve(input.root ?? process.cwd());
  return {
    root,
    sourceDirs: input.sourceDirs?.length ? input.sourceDirs : DEFAULT_SOURCE_DIRS,
    trackedDirs: input.trackedDirs?.length ? input.trackedDirs : DEFAULT_TRACKED_DIRS,
    includeTests: input.includeTests ?? false,
    measureCommands: input.measureCommands ?? false,
    saveSnapshot: input.saveSnapshot ?? false,
    snapshotDir: input.snapshotDir
      ? path.resolve(root, input.snapshotDir)
      : path.resolve(root, DEFAULT_SNAPSHOT_DIR),
    top: input.top ?? DEFAULT_TOP,
    outFile: input.outFile,
    jsonFile: input.jsonFile,
    coverageDir: input.coverageDir ? path.resolve(root, input.coverageDir) : undefined,
  };
}

function discoverSourceFiles(
  root: string,
  sourceDirs: string[],
  includeTests: boolean
): SourceFileSummary[] {
  const files: SourceFileSummary[] = [];
  for (const sourceDir of sourceDirs) {
    const abs = path.resolve(root, sourceDir);
    if (!existsSync(abs)) continue;
    walk(abs, (filePath) => {
      const ext = path.extname(filePath);
      if (!SOURCE_EXTENSIONS.has(ext)) return;
      if (!includeTests && isTestFile(filePath)) return;
      const text = readFileSync(filePath, "utf-8");
      files.push({
        path: filePath,
        relativePath: relative(root, filePath),
        bytes: Buffer.byteLength(text),
        lineCount: countLines(text),
      });
    });
  }
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function walk(dir: string, onFile: (path: string) => void): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && EXCLUDED_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      walk(fullPath, onFile);
    } else if (entry.isFile()) {
      onFile(fullPath);
    }
  }
}

function collectTopLevelSizes(root: string): SizeEntry[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.name !== "." && entry.name !== "..")
    .map((entry) => {
      const fullPath = path.join(root, entry.name);
      return {
        path: fullPath,
        relativePath: entry.name,
        bytes: diskUsageBytes(fullPath),
        isDirectory: entry.isDirectory(),
      };
    })
    .sort((a, b) => b.bytes - a.bytes);
}

function collectTrackedSizes(root: string, trackedDirs: string[]): SizeEntry[] {
  return trackedDirs.map((dir) => {
    const fullPath = path.resolve(root, dir);
    if (!existsSync(fullPath)) {
      return {
        path: fullPath,
        relativePath: dir,
        bytes: 0,
        isDirectory: false,
        exists: false,
      };
    }
    const stat = statSync(fullPath);
    return {
      path: fullPath,
      relativePath: dir,
      bytes: diskUsageBytes(fullPath),
      isDirectory: stat.isDirectory(),
      exists: true,
    };
  });
}

function diskUsageBytes(target: string): number {
  try {
    const output = execFileSync("du", ["-sk", target], { encoding: "utf-8" });
    const kb = Number(output.trim().split(/\s+/)[0]);
    if (Number.isFinite(kb)) return kb * 1024;
  } catch {
    // Fall through to a slower JS stat walk.
  }
  return recursiveSizeBytes(target);
}

function recursiveSizeBytes(target: string): number {
  const stat = statSync(target);
  if (!stat.isDirectory()) return stat.size;
  let total = stat.size;
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    total += recursiveSizeBytes(path.join(target, entry.name));
  }
  return total;
}

function getConceptDeclaration(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  relativePath: string
): ConceptDeclaration | null {
  let name = "";
  let kind: ConceptDeclaration["kind"] | null = null;

  if (ts.isInterfaceDeclaration(node)) {
    name = node.name.text;
    kind = "interface";
  } else if (ts.isTypeAliasDeclaration(node)) {
    name = node.name.text;
    kind = "type";
  } else if (ts.isEnumDeclaration(node)) {
    name = node.name.text;
    kind = "enum";
  } else if (ts.isClassDeclaration(node) && node.name) {
    name = node.name.text;
    kind = "class";
  }

  if (!kind || !name) return null;
  return {
    name,
    kind,
    relativePath,
    line: lineOf(sourceFile, node.getStart(sourceFile)),
    exported: hasModifier(node, ts.SyntaxKind.ExportKeyword),
  };
}

function buildConceptDuplicates(declarations: ConceptDeclaration[]): ConceptDuplicate[] {
  const byName = new Map<string, ConceptDeclaration[]>();
  for (const declaration of declarations) {
    if (GENERIC_CONCEPT_NAMES.has(declaration.name)) continue;
    if (!DOMAIN_CONCEPT_PATTERN.test(declaration.name)) continue;
    const list = byName.get(declaration.name) ?? [];
    list.push(declaration);
    byName.set(declaration.name, list);
  }

  return [...byName.entries()]
    .map(([name, items]) => {
      const uniqueFiles = new Set(items.map((item) => item.relativePath)).size;
      const exportedCount = items.filter((item) => item.exported).length;
      return {
        name,
        declarations: items.sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
        uniqueFiles,
        exportedCount,
        score: uniqueFiles * 10 + items.length + exportedCount * 2,
      };
    })
    .filter((duplicate) => duplicate.uniqueFiles >= 2)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

function collectEnvironmentHealth(root: string): EnvironmentHealth {
  const warnings: string[] = [];
  const currentBranch = safeExec("git", ["branch", "--show-current"], root)?.trim() || null;
  const head = safeExec("git", ["rev-parse", "--short", "HEAD"], root)?.trim() || null;
  const dirtyOutput = safeExec("git", ["status", "--porcelain"], root);
  const dirtyFileCount = dirtyOutput === null ? null : dirtyOutput.split("\n").filter(Boolean).length;
  const worktrees = collectWorktreeHealth(root);
  const listeners = collectListenerHealth(worktrees);
  const projectListeners = listeners.filter((listener) => listener.worktreePath !== null);
  const dataFiles = worktrees.filter((worktree) => worktree.dataFile.exists);

  if (projectListeners.length >= 2) {
    warnings.push(`检测到 ${projectListeners.length} 个项目内 node 监听进程，可能存在 dev server 并行。`);
  }
  if (dataFiles.length >= 2) {
    warnings.push(`检测到 ${dataFiles.length} 个 worktree 拥有 .webdev/local-persist.json，存在数据分裂风险。`);
  }
  const nonRootDataFiles = dataFiles.filter((worktree) => path.resolve(worktree.path) !== root);
  if (nonRootDataFiles.length > 0) {
    warnings.push("非主目录 worktree 存在本地数据文件，需要确认是否仍在使用。");
  }
  if ((dirtyFileCount ?? 0) > 30) {
    warnings.push(`当前工作树有 ${dirtyFileCount} 个改动项，跨 agent 冲突风险较高。`);
  }

  return { currentBranch, head, dirtyFileCount, worktrees, listeners, warnings };
}

function collectWorktreeHealth(root: string): WorktreeHealth[] {
  const output = safeExec("git", ["worktree", "list", "--porcelain"], root);
  if (!output) return [];
  return parseWorktreePorcelain(output).map((worktree) => ({
    ...worktree,
    dataFile: statDataFile(worktree.path),
  }));
}

function parseWorktreePorcelain(text: string): Array<{
  path: string;
  branch: string;
  head: string;
}> {
  const result: Array<{ path: string; branch: string; head: string }> = [];
  for (const block of text.split(/\n\s*\n/)) {
    const lines = block.split("\n").filter(Boolean);
    if (lines.length === 0) continue;
    let wtPath = "";
    let branch = "(detached)";
    let head = "";
    for (const line of lines) {
      if (line.startsWith("worktree ")) wtPath = line.slice("worktree ".length);
      else if (line.startsWith("HEAD ")) head = line.slice("HEAD ".length);
      else if (line.startsWith("branch ")) {
        branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
      }
    }
    if (wtPath) result.push({ path: wtPath, branch, head });
  }
  return result;
}

function statDataFile(worktreePath: string): DataFileHealth {
  const dataPath = path.join(worktreePath, ".webdev", "local-persist.json");
  try {
    const stat = statSync(dataPath);
    return {
      exists: true,
      path: dataPath,
      sizeBytes: stat.size,
      mtimeMs: stat.mtimeMs,
    };
  } catch {
    return { exists: false, path: dataPath };
  }
}

function collectListenerHealth(worktrees: WorktreeHealth[]): ListenerHealth[] {
  const lsofOutput = safeExec("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN"], process.cwd());
  if (!lsofOutput) return [];
  const listeners: Array<{ command: string; pid: number; port: number }> = [];
  const seen = new Set<string>();
  for (const line of lsofOutput.split("\n")) {
    if (!line.includes("(LISTEN)")) continue;
    const cols = line.trim().split(/\s+/);
    if (cols.length < 9) continue;
    const command = cols[0];
    const pid = Number(cols[1]);
    if (!command.toLowerCase().includes("node") || !Number.isFinite(pid)) continue;
    const name = cols[cols.length - 2];
    const port = Number(name.slice(name.lastIndexOf(":") + 1));
    if (!Number.isFinite(port)) continue;
    const key = `${pid}:${port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    listeners.push({ command, pid, port });
  }

  const byDepth = [...worktrees].sort((a, b) => b.path.length - a.path.length);
  return listeners.map((listener) => {
    const cwd = pidCwd(listener.pid);
    const worktreePath =
      cwd === null
        ? null
        : byDepth.find(
            (worktree) => cwd === worktree.path || cwd.startsWith(worktree.path + path.sep)
          )?.path ?? null;
    return { ...listener, cwd, worktreePath };
  });
}

function pidCwd(pid: number): string | null {
  const output = safeExec("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], process.cwd());
  if (!output) return null;
  const line = output.split("\n").find((item) => item.startsWith("n"));
  return line ? line.slice(1) : null;
}

function collectCommandTimings(root: string): CommandTiming[] {
  return [
    runTimedCommand("typecheck", "node_modules/.bin/tsc", ["--noEmit"], root),
    runTimedCommand("test", "node_modules/.bin/vitest", ["run"], root),
    runTimedCommand("build", "node_modules/.bin/pnpm", ["build"], root),
  ];
}

function skippedCommandTimings(): CommandTiming[] {
  return [
    {
      name: "typecheck",
      command: "node_modules/.bin/tsc --noEmit",
      durationMs: 0,
      status: "skipped",
      exitCode: null,
    },
    {
      name: "test",
      command: "node_modules/.bin/vitest run",
      durationMs: 0,
      status: "skipped",
      exitCode: null,
    },
    {
      name: "build",
      command: "node_modules/.bin/pnpm build",
      durationMs: 0,
      status: "skipped",
      exitCode: null,
    },
  ];
}

function runTimedCommand(
  name: string,
  command: string,
  args: string[],
  cwd: string
): CommandTiming {
  const start = Date.now();
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf-8",
    timeout: COMMAND_TIMEOUT_MS,
    maxBuffer: 5 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  const exitCode =
    typeof result.status === "number"
      ? result.status
      : result.error
        ? 1
        : null;
  return {
    name,
    command: [command, ...args].join(" "),
    durationMs: Date.now() - start,
    status: exitCode === 0 ? "passed" : "failed",
    exitCode,
    outputTail: tailLines(output, 18),
  };
}

function safeExec(command: string, args: string[], cwd: string): string | null {
  try {
    return execFileSync(command, args, {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

function makeHealthSnapshot(report: ProjectReport): HealthSnapshot {
  const sourceBytes = sum(report.sourceFiles.map((file) => file.bytes));
  const highRisk = report.functions
    .filter((fn) => fn.riskScore >= 15)
    .sort((a, b) => b.riskScore - a.riskScore);
  const unused = possibleUnusedFunctions(report.functions);
  const largestSources = [...report.sourceFiles].sort((a, b) => b.bytes - a.bytes);

  return {
    generatedAt: report.generatedAt,
    sourceFiles: report.sourceFiles.length,
    sourceBytes,
    functions: report.functions.length,
    highRiskFunctions: highRisk.length,
    possibleUnusedFunctions: unused.length,
    trackedDirectories: report.trackedDirectorySizes.map((entry) => ({
      path: entry.relativePath,
      bytes: entry.bytes,
      exists: entry.exists ?? true,
    })),
    largestSourceFiles: largestSources.slice(0, DEFAULT_TOP).map((file) => ({
      path: file.relativePath,
      bytes: file.bytes,
      lines: file.lineCount,
    })),
    highRiskFunctionIds: highRisk.slice(0, DEFAULT_TOP).map((fn) => ({
      id: fn.id,
      name: fn.name,
      file: fn.relativePath,
      line: fn.startLine,
      score: fn.riskScore,
      bigO: fn.bigO,
    })),
    duplicateConcepts: report.conceptDuplicates.slice(0, DEFAULT_TOP).map((concept) => ({
      name: concept.name,
      uniqueFiles: concept.uniqueFiles,
      declarations: concept.declarations.length,
    })),
    environmentWarnings: report.environment.warnings,
    commandTimings: report.commandTimings,
  };
}

function compareSnapshots(
  current: HealthSnapshot,
  previousSnapshots: HealthSnapshot[]
): SnapshotComparison {
  const sorted = [...previousSnapshots].sort((a, b) =>
    a.generatedAt.localeCompare(b.generatedAt)
  );
  const previous = sorted[sorted.length - 1];
  const baseline = sorted[0];
  const metricInputs: Array<[string, keyof HealthSnapshot]> = [
    ["Source bytes", "sourceBytes"],
    ["Source files", "sourceFiles"],
    ["Functions indexed", "functions"],
    ["High-risk functions", "highRiskFunctions"],
    ["Possible unused local functions", "possibleUnusedFunctions"],
  ];

  return {
    snapshotCount: sorted.length,
    previousGeneratedAt: previous?.generatedAt,
    baselineGeneratedAt: baseline?.generatedAt,
    metrics: metricInputs.map(([name, key]) => {
      const currentValue = Number(current[key]);
      const previousValue = previous ? Number(previous[key]) : undefined;
      const baselineValue = baseline ? Number(baseline[key]) : undefined;
      return {
        name,
        current: currentValue,
        previous: previousValue,
        delta:
          previousValue === undefined ? undefined : currentValue - previousValue,
        baseline: baselineValue,
        sinceBaseline:
          baselineValue === undefined ? undefined : currentValue - baselineValue,
      };
    }),
    directories: current.trackedDirectories.map((entry) => {
      const previousEntry = previous?.trackedDirectories.find((item) => item.path === entry.path);
      const baselineEntry = baseline?.trackedDirectories.find((item) => item.path === entry.path);
      return {
        path: entry.path,
        currentBytes: entry.bytes,
        previousBytes: previousEntry?.bytes,
        deltaBytes:
          previousEntry === undefined ? undefined : entry.bytes - previousEntry.bytes,
        baselineBytes: baselineEntry?.bytes,
        sinceBaseline:
          baselineEntry === undefined ? undefined : entry.bytes - baselineEntry.bytes,
      };
    }),
  };
}

function readSnapshots(snapshotDir: string): HealthSnapshot[] {
  if (!existsSync(snapshotDir)) return [];
  const snapshots: HealthSnapshot[] = [];
  for (const entry of readdirSync(snapshotDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    try {
      snapshots.push(
        JSON.parse(readFileSync(path.join(snapshotDir, entry.name), "utf-8")) as HealthSnapshot
      );
    } catch {
      // Ignore partial/corrupt snapshots; the next run will write a fresh one.
    }
  }
  return snapshots;
}

function writeSnapshot(snapshotDir: string, snapshot: HealthSnapshot): string {
  mkdirSync(snapshotDir, { recursive: true });
  const stamp = snapshot.generatedAt.replace(/[:.]/g, "-");
  const filePath = path.join(snapshotDir, `snapshot-${stamp}.json`);
  writeFileSync(filePath, JSON.stringify(snapshot, null, 2));
  pruneSnapshots(snapshotDir);
  return filePath;
}

function pruneSnapshots(snapshotDir: string): void {
  const files = readdirSync(snapshotDir)
    .filter((name) => name.endsWith(".json"))
    .sort();
  for (const name of files.slice(0, Math.max(0, files.length - MAX_SNAPSHOTS))) {
    try {
      // Keep the history bounded; snapshots are generated artifacts.
      unlinkSync(path.join(snapshotDir, name));
    } catch {
      // Ignore cleanup failures.
    }
  }
}

function buildFunctionMetric(
  node: AnyFunction,
  sourceFile: ts.SourceFile,
  filePath: string,
  relativePath: string
): FunctionMetric {
  const startOffset = node.getStart(sourceFile);
  const endOffset = node.getEnd();
  const startLine = lineOf(sourceFile, startOffset);
  const endLine = lineOf(sourceFile, endOffset);
  const name = getFunctionName(node, sourceFile);
  const simpleName = getSimpleFunctionName(node, name);
  const complexity = analyzeComplexity(node, sourceFile, simpleName);
  const metric: FunctionMetric = {
    id: `${relativePath}:${startLine}:${name}`,
    filePath,
    relativePath,
    name,
    simpleName,
    kind: functionKind(node),
    startLine,
    endLine,
    startOffset,
    endOffset,
    loc: Math.max(1, endLine - startLine + 1),
    exported: hasModifier(node, ts.SyntaxKind.ExportKeyword),
    async: hasModifier(node, ts.SyntaxKind.AsyncKeyword),
    cyclomatic: complexity.cyclomatic,
    loops: complexity.loops,
    maxIterationDepth: complexity.maxIterationDepth,
    collectionOps: complexity.collectionOps,
    collectionOpsInIterations: complexity.collectionOpsInIterations,
    sortOps: complexity.sortOps,
    recursive: complexity.recursive,
    staticCallRefs: 0,
    jsxRefs: 0,
    runtimeHits: null,
    bigO: estimateBigO(complexity),
    riskScore: 0,
    riskTags: [],
  };
  finalizeRisk(metric);
  return metric;
}

function analyzeComplexity(
  rootFunction: AnyFunction,
  sourceFile: ts.SourceFile,
  simpleName: string
): ComplexityMetric {
  const metric: ComplexityMetric = {
    cyclomatic: 1,
    loops: 0,
    maxIterationDepth: 0,
    collectionOps: 0,
    collectionOpsInIterations: 0,
    sortOps: 0,
    recursive: false,
  };
  const body = getFunctionBody(rootFunction);
  if (!body) return metric;

  function visitFunctionBody(fn: AnyFunction, iterationDepth: number): void {
    const fnBody = getFunctionBody(fn);
    if (!fnBody) return;
    visit(fnBody, iterationDepth);
  }

  function visit(node: ts.Node, iterationDepth: number): void {
    if (node !== body && isAnyFunction(node)) return;

    if (isLoop(node)) {
      metric.loops += 1;
      metric.cyclomatic += 1;
      const nextDepth = iterationDepth + 1;
      metric.maxIterationDepth = Math.max(metric.maxIterationDepth, nextDepth);
      ts.forEachChild(node, (child) => visit(child, nextDepth));
      return;
    }

    if (ts.isIfStatement(node) || ts.isConditionalExpression(node) || ts.isCatchClause(node)) {
      metric.cyclomatic += 1;
    } else if (ts.isCaseClause(node)) {
      metric.cyclomatic += 1;
    } else if (ts.isBinaryExpression(node) && isBranchingOperator(node.operatorToken.kind)) {
      metric.cyclomatic += 1;
    }

    if (ts.isCallExpression(node)) {
      if (isRecursiveCall(node.expression, simpleName)) metric.recursive = true;

      const method = getPropertyAccessName(node.expression);
      const isLinear = method ? LINEAR_METHODS.has(method) || MUTATING_LINEAR_METHODS.has(method) : false;
      const isSort = method ? SORT_METHODS.has(method) : false;
      if (isLinear || isSort) {
        metric.collectionOps += 1;
        if (isSort) metric.sortOps += 1;
        const nextDepth = iterationDepth + 1;
        metric.maxIterationDepth = Math.max(metric.maxIterationDepth, nextDepth);
        if (iterationDepth > 0) metric.collectionOpsInIterations += 1;

        visit(node.expression, iterationDepth);
        for (const arg of node.arguments) {
          if (isAnyFunction(arg)) visitFunctionBody(arg, nextDepth);
          else visit(arg, iterationDepth);
        }
        return;
      }
    }

    ts.forEachChild(node, (child) => visit(child, iterationDepth));
  }

  visit(body, 0);
  return metric;
}

function estimateBigO(metric: ComplexityMetric): string {
  if (metric.recursive) return "recursive";
  if (metric.sortOps > 0 && metric.maxIterationDepth >= 2) return "O(n^2 log n)";
  if (metric.maxIterationDepth >= 3) return "O(n^3+)";
  if (metric.maxIterationDepth === 2) return "O(n^2)";
  if (metric.sortOps > 0) return "O(n log n)";
  if (metric.maxIterationDepth === 1) return "O(n)";
  return "O(1)";
}

function finalizeRisk(metric: FunctionMetric): void {
  const tags: string[] = [];
  let score = 0;

  if (metric.bigO === "recursive") {
    tags.push("recursive");
    score += 35;
  } else if (metric.bigO.includes("n^3")) {
    tags.push("cubic+");
    score += 45;
  } else if (metric.bigO.includes("n^2")) {
    tags.push("quadratic");
    score += 30;
  } else if (metric.bigO.includes("n log n")) {
    tags.push("sort");
    score += 10;
  } else if (metric.bigO === "O(n)") {
    score += 4;
  }

  if (metric.cyclomatic >= 20) {
    tags.push("very-high-branching");
    score += 25;
  } else if (metric.cyclomatic >= 12) {
    tags.push("high-branching");
    score += 15;
  } else if (metric.cyclomatic >= 8) {
    score += 8;
  }

  if (metric.loc >= 160) {
    tags.push("very-large");
    score += 20;
  } else if (metric.loc >= 80) {
    tags.push("large");
    score += 10;
  } else if (metric.loc >= 40) {
    score += 4;
  }

  if (metric.collectionOpsInIterations > 0) {
    tags.push("collection-in-loop");
    score += metric.collectionOpsInIterations * 8;
  }

  const staticRefs = metric.staticCallRefs + metric.jsxRefs;
  if (staticRefs >= 20) {
    tags.push("widely-referenced");
    score += 12;
  } else if (staticRefs >= 8) {
    score += 6;
  }

  if ((metric.runtimeHits ?? 0) >= 1000) {
    tags.push("runtime-hot");
    score += 25;
  } else if ((metric.runtimeHits ?? 0) >= 100) {
    tags.push("runtime-warm");
    score += 15;
  }

  metric.riskScore = score;
  metric.riskTags = tags.length ? tags : ["review-low"];
}

function applyRuntimeCoverage(
  functions: FunctionMetric[],
  root: string,
  coverageDir: string
): number {
  if (!existsSync(coverageDir)) return 0;
  const coverageFiles: string[] = [];
  walkCoverageFiles(coverageDir, coverageFiles);
  const byFile = new Map<string, FunctionMetric[]>();
  for (const fn of functions) {
    const list = byFile.get(fn.filePath) ?? [];
    list.push(fn);
    byFile.set(fn.filePath, list);
    fn.runtimeHits = 0;
  }

  let loaded = 0;
  for (const coverageFile of coverageFiles) {
    let parsed: V8Coverage;
    try {
      parsed = JSON.parse(readFileSync(coverageFile, "utf-8")) as V8Coverage;
    } catch {
      continue;
    }
    loaded += 1;
    for (const script of parsed.result ?? []) {
      const filePath = coverageUrlToPath(script.url, root);
      if (!filePath) continue;
      const candidates = byFile.get(filePath);
      if (!candidates) continue;
      for (const fnCoverage of script.functions ?? []) {
        const range = fnCoverage.ranges[0];
        if (!range || range.count <= 0) continue;
        const match = matchCoverageFunction(candidates, fnCoverage, range);
        if (match) match.runtimeHits = (match.runtimeHits ?? 0) + range.count;
      }
    }
  }
  return loaded;
}

function walkCoverageFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walkCoverageFiles(fullPath, out);
    else if (entry.isFile() && entry.name.endsWith(".json")) out.push(fullPath);
  }
}

function coverageUrlToPath(url: string, root: string): string | null {
  if (!url || url.startsWith("node:") || url.includes("/node_modules/")) return null;
  try {
    const cleanUrl = url.split("?")[0].split("#")[0];
    if (cleanUrl.startsWith("file://")) {
      const filePath = fileURLToPath(cleanUrl);
      return path.normalize(filePath);
    }
    if (path.isAbsolute(cleanUrl)) return path.normalize(cleanUrl);
    const resolved = path.resolve(root, cleanUrl);
    return existsSync(resolved) ? resolved : null;
  } catch {
    return null;
  }
}

function matchCoverageFunction(
  candidates: FunctionMetric[],
  coverage: V8FunctionCoverage,
  range: V8RangeCoverage
): FunctionMetric | null {
  const byOffset = candidates
    .filter((fn) => range.startOffset >= fn.startOffset && range.startOffset <= fn.endOffset)
    .sort((a, b) => a.endOffset - a.startOffset - (b.endOffset - b.startOffset))[0];
  if (byOffset) return byOffset;

  const byName = candidates.find(
    (fn) =>
      coverage.functionName &&
      (fn.simpleName === coverage.functionName || fn.name.endsWith(`.${coverage.functionName}`))
  );
  return byName ?? null;
}

function isAnyFunction(node: ts.Node): node is AnyFunction {
  return (
    ts.isArrowFunction(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

function getFunctionBody(node: AnyFunction): ts.ConciseBody | ts.Block | undefined {
  if (ts.isConstructorDeclaration(node)) return node.body;
  if (ts.isFunctionDeclaration(node)) return node.body;
  if (ts.isFunctionExpression(node)) return node.body;
  if (ts.isMethodDeclaration(node)) return node.body;
  if (ts.isGetAccessorDeclaration(node)) return node.body;
  if (ts.isSetAccessorDeclaration(node)) return node.body;
  return node.body;
}

function functionKind(node: AnyFunction): string {
  if (ts.isArrowFunction(node)) return "arrow";
  if (ts.isConstructorDeclaration(node)) return "constructor";
  if (ts.isFunctionDeclaration(node)) return "function";
  if (ts.isFunctionExpression(node)) return "function-expression";
  if (ts.isGetAccessorDeclaration(node)) return "getter";
  if (ts.isMethodDeclaration(node)) return "method";
  if (ts.isSetAccessorDeclaration(node)) return "setter";
  return "function";
}

function getFunctionName(node: AnyFunction, sourceFile: ts.SourceFile): string {
  if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) {
    if (node.name) return node.name.text;
    return contextualFunctionName(node, sourceFile);
  }

  if (ts.isArrowFunction(node)) return contextualFunctionName(node, sourceFile);

  if (ts.isConstructorDeclaration(node)) {
    const owner = className(node.parent);
    return `${owner}.constructor`;
  }

  const method = propertyNameText(node.name);
  const owner = className(node.parent);
  return owner ? `${owner}.${method}` : method;
}

function getSimpleFunctionName(node: AnyFunction, displayName: string): string {
  if (ts.isConstructorDeclaration(node)) return "constructor";
  if (ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
    return propertyNameText(node.name);
  }
  if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) {
    if (node.name) return node.name.text;
  }
  const dot = displayName.lastIndexOf(".");
  return dot >= 0 ? displayName.slice(dot + 1) : displayName;
}

function contextualFunctionName(node: ts.Node, sourceFile: ts.SourceFile): string {
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  if (ts.isPropertyAssignment(parent)) {
    return propertyNameText(parent.name);
  }
  if (ts.isBinaryExpression(parent)) {
    if (ts.isIdentifier(parent.left)) return parent.left.text;
    if (ts.isPropertyAccessExpression(parent.left)) return parent.left.name.text;
  }
  if (ts.isCallExpression(parent)) {
    return `callback@${lineOf(sourceFile, node.getStart(sourceFile))}`;
  }
  return `anonymous@${lineOf(sourceFile, node.getStart(sourceFile))}`;
}

function className(node: ts.Node | undefined): string {
  if (node && ts.isClassDeclaration(node) && node.name) return node.name.text;
  return "";
}

function propertyNameText(name: ts.PropertyName | ts.BindingName | undefined): string {
  if (!name) return "anonymous";
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name)) return "computed";
  return "anonymous";
}

function getCallReference(
  expression: ts.Expression
): { name: string; access: "identifier" | "property" | "element" } | null {
  if (ts.isIdentifier(expression)) return { name: expression.text, access: "identifier" };
  if (ts.isPropertyAccessExpression(expression)) {
    return { name: expression.name.text, access: "property" };
  }
  if (ts.isElementAccessExpression(expression)) {
    const arg = expression.argumentExpression;
    if (arg && ts.isStringLiteralLike(arg)) return { name: arg.text, access: "element" };
  }
  return null;
}

function shouldCountCallForFunction(call: CallReference, fn: FunctionMetric): boolean {
  if (call.kind === "jsx") return true;
  if (call.access === "identifier") {
    return !["getter", "method", "setter"].includes(fn.kind);
  }
  if (COMMON_BUILTIN_PROPERTY_CALLS.has(call.name)) {
    return fn.kind === "method" || fn.kind === "getter" || fn.kind === "setter";
  }
  return fn.exported || fn.kind === "method" || fn.kind === "getter" || fn.kind === "setter";
}

function narrowStaticTargets(call: CallReference, targets: FunctionMetric[]): FunctionMetric[] {
  if (targets.length <= 1) return targets;
  const sameFile = targets.filter((fn) => fn.relativePath === call.relativePath);
  if (sameFile.length > 0) return sameFile;
  return targets.filter((fn) => fn.exported);
}

function isRecursiveCall(expression: ts.Expression, simpleName: string): boolean {
  if (ts.isIdentifier(expression)) return expression.text === simpleName;
  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text === simpleName && expression.expression.kind === ts.SyntaxKind.ThisKeyword;
  }
  return false;
}

function getPropertyAccessName(expression: ts.Expression): string | null {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (ts.isElementAccessExpression(expression)) {
    const arg = expression.argumentExpression;
    if (arg && ts.isStringLiteralLike(arg)) return arg.text;
  }
  return null;
}

function getJsxTagName(name: ts.JsxTagNameExpression): string | null {
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isPropertyAccessExpression(name)) return name.name.text;
  return null;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return Boolean(ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((m) => m.kind === kind));
}

function isLoop(node: ts.Node): boolean {
  return (
    ts.isDoStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isForStatement(node) ||
    ts.isWhileStatement(node)
  );
}

function isBranchingOperator(kind: ts.SyntaxKind): boolean {
  return (
    kind === ts.SyntaxKind.AmpersandAmpersandToken ||
    kind === ts.SyntaxKind.BarBarToken ||
    kind === ts.SyntaxKind.QuestionQuestionToken
  );
}

function scriptKindForFile(filePath: string): ts.ScriptKind {
  const ext = path.extname(filePath);
  if (ext === ".tsx") return ts.ScriptKind.TSX;
  if (ext === ".jsx") return ts.ScriptKind.JSX;
  if (ext === ".js") return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function isTestFile(filePath: string): boolean {
  return /\.(test|spec)\.[cm]?[tj]sx?$/.test(filePath);
}

function countLines(text: string): number {
  if (text.length === 0) return 0;
  return text.split(/\r\n|\r|\n/).length;
}

function lineOf(sourceFile: ts.SourceFile, offset: number): number {
  return sourceFile.getLineAndCharacterOfPosition(offset).line + 1;
}

function relative(root: string, target: string): string {
  return path.relative(root, target).split(path.sep).join("/");
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function possibleUnusedFunctions(functions: FunctionMetric[]): FunctionMetric[] {
  return functions
    .filter(
      (fn) =>
        !fn.exported &&
        fn.staticCallRefs === 0 &&
        fn.jsxRefs === 0 &&
        !fn.simpleName.startsWith("callback@") &&
        !fn.name.includes(".constructor")
    )
    .sort((a, b) => b.loc - a.loc);
}

function formatMetricValue(name: string, value: number): string {
  if (name.includes("bytes")) return formatBytes(value);
  return String(value);
}

function formatMetricDelta(name: string, value: number | undefined): string {
  if (value === undefined) return "-";
  if (name.includes("bytes")) return formatBytesDelta(value);
  if (value === 0) return "0";
  return value > 0 ? `+${value}` : String(value);
}

function formatBytesDelta(value: number | undefined): string {
  if (value === undefined) return "-";
  if (value === 0) return "0B";
  return `${value > 0 ? "+" : "-"}${formatBytes(Math.abs(value))}`;
}

function formatDuration(ms: number): string {
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

function tailLines(text: string, count: number): string | undefined {
  const lines = text.split("\n").filter(Boolean);
  const tail = lines.slice(-count).join("\n");
  return tail || undefined;
}

function markdownTable(headers: string[], rows: string[][]): string {
  const escape = (value: string) => value.replace(/\|/g, "\\|").replace(/\n/g, " ");
  const header = `| ${headers.map(escape).join(" | ")} |`;
  const separator = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.map(escape).join(" | ")} |`);
  return [header, separator, ...body].join("\n");
}

function functionLink(fn: FunctionMetric): string {
  return `\`${fn.name}\` (${fn.relativePath}:${fn.startLine})`;
}

function parseCliArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    root: process.cwd(),
    sourceDirs: [...DEFAULT_SOURCE_DIRS],
    trackedDirs: [...DEFAULT_TRACKED_DIRS],
    includeTests: false,
    measureCommands: false,
    saveSnapshot: false,
    snapshotDir: DEFAULT_SNAPSHOT_DIR,
    top: DEFAULT_TOP,
  };
  let sourceOverridden = false;
  let trackedOverridden = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (!value) throw new Error(`Missing value for ${arg}`);
      i += 1;
      return value;
    };

    if (arg === "--root") options.root = next();
    else if (arg === "--source") {
      if (!sourceOverridden) {
        options.sourceDirs = [];
        sourceOverridden = true;
      }
      options.sourceDirs.push(...next().split(",").map((item) => item.trim()).filter(Boolean));
    } else if (arg === "--tracked-dir") {
      if (!trackedOverridden) {
        options.trackedDirs = [];
        trackedOverridden = true;
      }
      options.trackedDirs.push(...next().split(",").map((item) => item.trim()).filter(Boolean));
    } else if (arg === "--include-tests") options.includeTests = true;
    else if (arg === "--measure-commands") options.measureCommands = true;
    else if (arg === "--snapshot") options.saveSnapshot = true;
    else if (arg === "--snapshot-dir") options.snapshotDir = next();
    else if (arg === "--top") options.top = Number(next());
    else if (arg === "--out") options.outFile = next();
    else if (arg === "--json") options.jsonFile = next();
    else if (arg === "--coverage") options.coverageDir = next();
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(options.top) || options.top <= 0) {
    throw new Error("--top must be a positive number");
  }

  return normalizeOptions(options);
}

function printHelp(): void {
  console.log(`Usage:
  tsx scripts/code-health-report.ts [options]

Options:
  --root <dir>          Project root. Defaults to cwd.
  --source <dirs>       Comma-separated source roots. Can be repeated.
  --tracked-dir <dirs>  Comma-separated tracked disk paths. Can be repeated.
  --include-tests       Include *.test.* and *.spec.* files.
  --snapshot            Save a compact trend snapshot.
  --snapshot-dir <dir>  Snapshot directory. Default ${DEFAULT_SNAPSHOT_DIR}.
  --measure-commands    Time typecheck, full tests, and build.
  --coverage <dir>      Merge Node/V8 coverage JSON from NODE_V8_COVERAGE.
  --out <file>          Write Markdown report.
  --json <file>         Write full JSON inventory.
  --top <n>             Rows per table. Default ${DEFAULT_TOP}.
`);
}

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  const report = analyzeProject(options);
  const markdown = buildMarkdownReport(report, options.top);

  if (options.outFile) {
    writeText(options.outFile, markdown);
    console.log(`Wrote ${options.outFile}`);
  } else {
    console.log(markdown);
  }

  if (options.jsonFile) {
    writeText(options.jsonFile, JSON.stringify(report, null, 2));
    console.log(`Wrote ${options.jsonFile}`);
  }

  if (options.saveSnapshot) {
    const snapshotPath = writeSnapshot(options.snapshotDir, makeHealthSnapshot(report));
    console.log(`Wrote ${snapshotPath}`);
  }
}

function writeText(filePath: string, text: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, text);
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(entry) === path.resolve(fileURLToPath(import.meta.url));
}

if (isMainModule()) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
