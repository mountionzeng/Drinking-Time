/** Explicit, bounded live language check. No story, account or memory writes. */
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { invokeAgent } from "../server/_core/agentChannel";
import type { Message } from "../server/_core/llm";
import { replyAsWritingCompanion } from "../server/services/writingCompanion";

if (!process.argv.includes("--live"))
  throw new Error("Use --live to authorize up to six real text calls.");
if (process.env.NODE_ENV === "production")
  throw new Error("Local evaluation only.");
const miniArg = process.argv.find(arg => arg.startsWith("--mini-root="));
const miniRoot =
  miniArg?.slice("--mini-root=".length) ||
  resolve("../shiguang-jiayi-hackathon");
const limit = Number(
  process.argv.find(arg => arg.startsWith("--limit="))?.slice(8) || 6
);
if (!Number.isInteger(limit) || limit < 1 || limit > 6)
  throw new Error("--limit must be between 1 and 6.");
const require = createRequire(import.meta.url);
const daily = require(
  resolve(miniRoot, "cloudfunctions/chatInterview/dailyQuestion.js")
);
const interview = require(
  resolve(miniRoot, "cloudfunctions/chatInterview/index.js")
)._test;
const output = resolve(
  `.webdev/qa/conversation-exploration-live-${Date.now()}.json`
);
const records: unknown[] = [];
const invoke = (messages: Message[], maxTokens: number) =>
  invokeAgent(messages, maxTokens, undefined, {
    deadlineMs: 45_000,
    reasoningEffort: "low",
    replaySafe: false,
  });
async function save() {
  await mkdir(resolve(".webdev/qa"), { recursive: true });
  await writeFile(
    output,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        nativeProviderNote:
          "Native prompts evaluated through the local Web text provider; not a deployed TokenHub or phone test.",
        records,
      },
      null,
      2
    )
  );
}
try {
  const history: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const message of [
    "这是虚构人物阿青：不是母亲，是外婆给她的蓝色旧书。我记不清年份了，但想聊她为什么一直留着它。",
    "不是舍不得人，是她喜欢书页翻动的声音。别写得伤感，给我两种很短的表达试试。",
    "先到这里，今天不聊了，也先不要生成文章。",
  ]) {
    const result = await replyAsWritingCompanion(
      {
        message,
        history,
        writingContext: {
          draft: "虚构故事：阿青在雨天翻开一本蓝色旧书。",
          cursor: 23,
          openingQuestion: "这本书是母亲送的吗？",
        },
      },
      invoke
    );
    records.push({ kind: "web-companion", message, ...result });
    history.push(
      { role: "user", content: message },
      { role: "assistant", content: result.reply }
    );
    await save();
    console.log(`Completed language sample ${records.length}/6`);
    if (records.length >= limit) {
      console.log(output);
      process.exit(0);
    }
  }
  const source = {
    id: "m1",
    memoryId: "m1",
    text: "虚构人物阿青把外婆送的蓝色旧书留在窗边。她喜欢书页翻动的声音。她说这并不伤感，雨天翻书让她安心。",
  };
  const previous = ["这本书是谁送的？", "留着这本书，是因为舍不得外婆吗？"];
  const priorTopics = [
    { anchor: "外婆送的蓝色旧书", focus: "experience", gap: "赠书人的身份" },
  ];
  const generated = await invoke(
    daily.dailyMessages(
      { title: "虚构旧书", sources: [source] },
      previous,
      priorTopics
    ),
    2048
  );
  const question = daily.validateDailyQuestion(
    generated.text,
    [source],
    previous,
    priorTopics
  );
  records.push({
    kind: "native-daily-prompt-via-web-provider",
    ...generated,
    question,
  });
  await save();
  console.log(`Completed language sample ${records.length}/6`);
  if (records.length >= limit) {
    console.log(output);
    process.exit(0);
  }
  const conversation = [{ role: "assistant", text: question.text }];
  for (const answer of [
    "这个问题我想先跳过。我只想让她的雨声和翻书声交织，不知道文字、画还是音乐更适合。",
    "先只试一句文字，不要画图。我喜欢简单一点，但不要把这个当成我永远的风格。",
  ]) {
    const result = await invoke(
      interview.buildOutputMessages({
        answer,
        history: conversation,
        mode: "personal",
        memoryType: "note",
        memberName: "虚构验收者",
        storyTitle: "虚构旧书",
        sourceText: source.text,
      }),
      2048
    );
    const reply = interview.parseInterviewPrompt(result.text, "event");
    records.push({
      kind: "native-followup-prompt-via-web-provider",
      answer,
      ...result,
      reply,
    });
    conversation.push(
      { role: "user", text: answer },
      { role: "assistant", text: reply.text }
    );
    await save();
    console.log(`Completed language sample ${records.length}/6`);
    if (records.length >= limit) {
      console.log(output);
      process.exit(0);
    }
  }
} catch (error) {
  records.push({
    kind: "failure",
    error: error instanceof Error ? error.name : "unknown",
  });
  await save();
  process.exitCode = 1;
  console.error(
    "Live check incomplete; no automatic rerun. Inspect the saved evidence."
  );
}
console.log(output);
