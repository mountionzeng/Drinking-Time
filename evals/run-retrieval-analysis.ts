/** `pnpm eval:retrieval [--persist <路径>] [--json <路径>]` */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { loadRetrievalCorpus } from "./retrievalCorpus";

function readFlag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

const { path, report } = loadRetrievalCorpus(readFlag("persist"));
console.log("Story Card 检索对比（旧重叠余弦 vs TF-IDF）");
console.log("=".repeat(62));
console.log(`语料：${path}`);
console.log(
  `卡池：${report.stories} 个故事 / ${report.cardPools} 个非空卡池 / ${report.cards} 张卡` +
    `（按 storyId+cardId 识别，重复键 ${report.duplicateStoryCardKeys}）`,
);
if (report.invalidStories > 0 || report.duplicateStoryIds > 0) {
  console.log(
    `跳过损坏或缺 ID 的故事 ${report.invalidStories} 个、重复 storyId ${report.duplicateStoryIds} 个`,
  );
}
if (report.invalidCards > 0) {
  console.log(`跳过缺少必要字段的卡片 ${report.invalidCards} 张`);
}
console.log(
  `用户发言：现代 ${report.messages.modernUser} / 旧版 ${report.messages.legacyUser}` +
    `；排除空消息 ${report.messages.emptyExcluded}；保留重复事件 ${report.messages.duplicateEventsRetained}`,
);
console.log(
  `评测事件：${report.messages.evaluated}（无卡池 ${report.messages.withoutCards}` +
    `，无可分词内容 ${report.messages.withoutTokens}，无词面命中 ${report.messages.noLexicalMatch}）`,
);
console.log(
  `per-story 词表：${report.idf.vocabularyEntries} 项；df=1 ${report.idf.singleDocumentEntries}` +
    `（${pct(report.idf.singleDocumentRatio)}）`,
);
console.log(
  `有命中的 top-1：一致 ${report.top1.same} / 不同 ${report.top1.different}` +
    `（差异率 ${pct(report.messages.matched > 0 ? report.top1.different / report.messages.matched : 0)}）`,
);
console.log(
  `  现代 role=user：${report.top1.bySource["role=user"].same} 一致 / ` +
    `${report.top1.bySource["role=user"].different} 不同；` +
    `旧版 who=u：${report.top1.bySource["who=u"].same} 一致 / ` +
    `${report.top1.bySource["who=u"].different} 不同`,
);
if (report.differences.length > 0) {
  console.log("差异定位（不打印用户原文）：");
  report.differences.slice(0, 20).forEach(item => {
    console.log(
      `  story ${item.storyId} / message[${item.messageIndex}] / ${item.source}: ` +
        `${item.oldCardId ?? "无"} → ${item.tfidfCardId ?? "无"}`,
    );
  });
}

const jsonOut = readFlag("json");
if (jsonOut) {
  const outputPath = resolve(jsonOut);
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`已写出 JSON：${outputPath}`);
}
