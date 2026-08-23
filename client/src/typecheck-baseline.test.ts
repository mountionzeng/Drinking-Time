import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * 类型检查冻结基线的守卫。
 *
 * 背景：`**\/*.test.ts` 从初始提交起就被 tsconfig 排除在 `tsc --noEmit` 之外，
 * 而 `**\/*.test.tsx` 没有——口径不一致，导致 .ts 测试里的失效 import 只有跑到
 * 那个测试才暴露（例：timelineActions 搬去 shared/ 后，指向旧路径的 import
 * 让 `pnpm check` 依然全绿）。2026-08-24 改成只排除下面这 58 个当时确实报错的文件，
 * 其余 240 个测试文件已纳入类型检查。
 *
 * 这道闸只阻止**新增**：清单只许变短，不许变长。它不要求任何人现在就去还债。
 * 逐条错误清单见 docs/qa/tsconfig-test-exclude-audit-2026-08-24.md。
 */

// 冻结时点（2026-08-24）确实存在类型错误的测试文件，共 208 个错误。
// 用集合而不是计数，是为了防止「修好一个、再豁免一个新的」把债务平移过去还显示达标。
const FROZEN_BASELINE = new Set([
  "client/src/features/creationAgent/imageAssetViewModel.test.ts",
  "client/src/features/creationEditor/imageClipEditorModel.test.ts",
  "client/src/features/creationEditor/rerender.test.ts",
  "client/src/features/creationEditor/storyboardEditRow.test.ts",
  "client/src/features/publishingAlbum/publishingAlbumExport.test.ts",
  "client/src/features/storyAgent/chatStoryContext.test.ts",
  "client/src/features/storyAgent/editingTransitionPersistence.test.ts",
  "client/src/features/storyAgent/selectionPromptCandidate.test.ts",
  "client/src/features/storyAgent/spine/storySpine.test.ts",
  "client/src/features/storyAgent/storyAgentPersistence.test.ts",
  "client/src/features/storyAgent/storyboardLocalMedia.test.ts",
  "client/src/features/storyAgent/views/StoryCardsBoard.intent.test.ts",
  "client/src/features/storyAgent/views/storyboardImageRenderPlan.test.ts",
  "evals/recurringEditAnalysis.test.ts",
  "server/_core/context.test.ts",
  "server/almanac.router.test.ts",
  "server/archive/storyIntent.test.ts",
  "server/db.storyTimelineOverlay.test.ts",
  "server/nayin.test.ts",
  "server/routers.artPromptLibrary.test.ts",
  "server/routers.creationAgentCost.test.ts",
  "server/routers.creationAgentImport.test.ts",
  "server/routers.project.test.ts",
  "server/routers.projectOwnership.test.ts",
  "server/routers.promptLineage.test.ts",
  "server/routers.publishingDraft.test.ts",
  "server/routers.shot.test.ts",
  "server/routers.startEndVideoCost.test.ts",
  "server/routers.storyAgent.test.ts",
  "server/routers.storyConversation.test.ts",
  "server/routers.storyShotFields.test.ts",
  "server/routers.visualAssets.test.ts",
  "server/services/characterContinuity.test.ts",
  "server/services/creationAgent.test.ts",
  "server/services/editingTransitionWorkflow.test.ts",
  "server/services/emotionDailyReference302.test.ts",
  "server/services/imageAssets.test.ts",
  "server/services/imagePromptDirector.test.ts",
  "server/services/publicReferenceHost.test.ts",
  "server/services/publishingDraft.test.ts",
  "server/services/publishingPersistence.test.ts",
  "server/services/publishingVideoStoryboard.test.ts",
  "server/services/publishingVideoStoryboardPersistence.test.ts",
  "server/services/shotImageReferences.test.ts",
  "server/services/storyMaterials.test.ts",
  "server/services/storyVoice302.test.ts",
  "server/services/videoConform.test.ts",
  "server/services/videoJobs.test.ts",
  "server/services/videoPromptDirector.test.ts",
  "server/services/videoTransition302.test.ts",
  "server/services/visionChannel.test.ts",
  "server/services/visualAssetAssociations.test.ts",
  "server/services/visualAssetBoardStructure.test.ts",
  "server/services/visualAssetCreation.test.ts",
  "server/services/visualAssetPersistence.test.ts",
  "shared/publishingVideoStoryboard.test.ts",
  "shared/timelineCommands.test.ts",
  "shared/timelineEditing.test.ts",
]);

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const tsconfigPath = path.join(repoRoot, "tsconfig.json");

function readExclude(): string[] {
  // tsconfig 是 jsonc（带注释），用 TypeScript 自己的解析器，别手搓去注释
  const parsed = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  expect(parsed.error).toBeUndefined();
  const exclude = parsed.config?.exclude;
  expect(Array.isArray(exclude)).toBe(true);
  return exclude as string[];
}

const isTestEntry = (entry: string) => entry.endsWith(".test.ts");

describe("类型检查冻结基线", () => {
  it("exclude 里没有 .test.ts 通配符——否则等于把整批测试重新放出检查范围", () => {
    const wildcards = readExclude().filter(
      entry => entry.includes("*") && entry.includes(".test.")
    );
    expect(wildcards).toEqual([]);
  });

  it("被豁免的测试文件只许是基线里的那些，不许新增", () => {
    const added = readExclude()
      .filter(isTestEntry)
      .filter(entry => !FROZEN_BASELINE.has(entry));
    expect(added).toEqual([]);
  });

  it("基线里的每个文件都还在——文件删了或改名了就得同步摘掉这条豁免", () => {
    const stale = readExclude()
      .filter(isTestEntry)
      .filter(entry => !fs.existsSync(path.join(repoRoot, entry)));
    expect(stale).toEqual([]);
  });

  it("target 没有被摘掉——摘了会退回 ES5，凭空多出 43 个假报", () => {
    const parsed = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
    expect(parsed.config?.compilerOptions?.target).toBe("ES2022");
  });

  it("解析器读的确实是带注释的 tsconfig，不是空对象", () => {
    // 自检：确认 readConfigFile 真的解析出了内容，避免上面几条因为读到空值而假绿
    const exclude = readExclude();
    expect(exclude).toContain("node_modules");
    expect(exclude.filter(isTestEntry).length).toBeGreaterThan(0);
  });
});
