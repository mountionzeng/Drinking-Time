import path from "node:path";

import mysql from "mysql2/promise";
import { describe, expect, it } from "vitest";

import { computeStoryConversationTurnRequestHash } from "../../shared/promptLineage";
import {
  spawnMysqlTestWorker,
  withMysqlTestDatabase,
  type MysqlTestWorker,
} from "./mysqlTestHarness";

const describeMysql = process.env.TEST_MYSQL_DATABASE_URL
  ? describe
  : describe.skip;
const workerScript = path.resolve(
  process.cwd(),
  "server/integration/storyConversationMysqlWorker.ts"
);

function encodedWorkerInput(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function startWorker(databaseUrl: string, input: unknown): MysqlTestWorker {
  return spawnMysqlTestWorker({
    databaseUrl,
    script: workerScript,
    args: [encodedWorkerInput(input)],
  });
}

async function workerResult<T>(worker: MysqlTestWorker): Promise<T> {
  const { stdout } = await worker.completion;
  const marker = stdout
    .split("\n")
    .find(line => line.startsWith("MYSQL_WORKER_RESULT:"));
  if (!marker) throw new Error(`MySQL worker returned no result:\n${stdout}`);
  return JSON.parse(marker.slice("MYSQL_WORKER_RESULT:".length)) as T;
}

describeMysql("Story conversation logical turns on MySQL", () => {
  it("keeps legacy messages readable and converges concurrent claims to one result", async () => {
    await withMysqlTestDatabase(async database => {
      const setup = await mysql.createConnection(database.databaseUrl);
      let userId = 0;
      let storyId = 0;
      try {
        await setup.execute(
          "CREATE TABLE turn_generation_audit (`id` int AUTO_INCREMENT PRIMARY KEY, `clientTurnId` varchar(128) NOT NULL)"
        );
        const [userResult] = await setup.execute<mysql.ResultSetHeader>(
          "INSERT INTO users (`openId`, `name`, `email`, `loginMethod`) VALUES (?, ?, ?, ?)",
          ["mysql-turn-owner", "Owner", "owner@example.test", "test"]
        );
        userId = userResult.insertId;
        const [storyResult] = await setup.execute<mysql.ResultSetHeader>(
          "INSERT INTO stories (`userId`, `title`, `body`) VALUES (?, ?, ?)",
          [userId, "Story", JSON.stringify({ cards: [], shots: [] })]
        );
        storyId = storyResult.insertId;
        await setup.execute(
          "INSERT INTO story_prompt_states (`storyId`, `userId`, `version`, `migrationStatus`) VALUES (?, ?, 0, 'migrated')",
          [storyId, userId]
        );
        const [conversationResult] = await setup.execute<mysql.ResultSetHeader>(
          "INSERT INTO story_conversations (`storyId`, `userId`) VALUES (?, ?)",
          [storyId, userId]
        );
        await setup.execute(
          "INSERT INTO story_conversation_messages (`conversationId`, `storyId`, `userId`, `role`, `content`, `clientMessageId`) VALUES (?, ?, ?, 'user', '旧问题', 'legacy-user'), (?, ?, ?, 'assistant', '旧回答', 'legacy-assistant')",
          [
            conversationResult.insertId,
            storyId,
            userId,
            conversationResult.insertId,
            storyId,
            userId,
          ]
        );
      } finally {
        await setup.end();
      }

      const legacy = await workerResult<{
        ok: boolean;
        result: { messages: Array<{ content: string; turnId: number | null }> };
      }>(
        startWorker(database.databaseUrl, { action: "list", storyId, userId })
      );
      expect(legacy.ok).toBe(true);
      expect(
        legacy.result.messages.map(message => ({
          content: message.content,
          turnId: message.turnId,
        }))
      ).toEqual([
        { content: "旧问题", turnId: null },
        { content: "旧回答", turnId: null },
      ]);

      const identity = {
        storyId,
        userId,
        clientTurnId: "mysql-shared-turn",
        userClientMessageId: "mysql-user-message",
        assistantClientMessageId: "mysql-assistant-message",
        userContent: "并发问题",
      };
      const input = {
        action: "generate" as const,
        ...identity,
        requestHash: computeStoryConversationTurnRequestHash(identity),
        holdMs: 300,
      };
      const left = startWorker(database.databaseUrl, input);
      const right = startWorker(database.databaseUrl, input);
      const results = await Promise.all([
        workerResult<{ ok: boolean; result: { status: string } }>(left),
        workerResult<{ ok: boolean; result: { status: string } }>(right),
      ]);
      expect(results.every(result => result.ok)).toBe(true);
      expect(results.some(result => result.result.status === "completed")).toBe(
        true
      );
      expect(
        results.every(
          result =>
            result.result.status === "completed" ||
            result.result.status === "pending"
        )
      ).toBe(true);

      const verify = await mysql.createConnection(database.databaseUrl);
      try {
        const [auditRows] = await verify.execute<mysql.RowDataPacket[]>(
          "SELECT COUNT(*) AS count FROM turn_generation_audit WHERE clientTurnId = ?",
          [identity.clientTurnId]
        );
        expect(Number(auditRows[0]?.count)).toBe(1);
        const [turnRows] = await verify.execute<mysql.RowDataPacket[]>(
          "SELECT generationStatus, assistantContent, generationAttempt FROM story_conversation_turns WHERE storyId = ? AND userId = ? AND clientTurnId = ?",
          [storyId, userId, identity.clientTurnId]
        );
        expect(turnRows[0]).toMatchObject({
          generationStatus: "completed",
          assistantContent: "回答:并发问题",
          generationAttempt: 1,
        });
      } finally {
        await verify.end();
      }

      const appendInput = {
        action: "append" as const,
        storyId,
        userId,
        clientTurnId: identity.clientTurnId,
        requestHash: input.requestHash,
      };
      const firstAppend = await workerResult<{ ok: boolean }>(
        startWorker(database.databaseUrl, appendInput)
      );
      const retryAppend = await workerResult<{ ok: boolean }>(
        startWorker(database.databaseUrl, appendInput)
      );
      expect(firstAppend.ok).toBe(true);
      expect(retryAppend.ok).toBe(true);

      const changedIdentity = { ...identity, userContent: "篡改问题" };
      const collision = await workerResult<{
        ok: boolean;
        error: { name: string };
      }>(
        startWorker(database.databaseUrl, {
          action: "generate",
          ...changedIdentity,
          requestHash: computeStoryConversationTurnRequestHash(changedIdentity),
        })
      );
      expect(collision).toMatchObject({
        ok: false,
        error: { name: "StoryConversationIdempotencyConflictError" },
      });

      const finalList = await workerResult<{
        ok: boolean;
        result: {
          messages: Array<{
            role: string;
            content: string;
            turnId: number | null;
          }>;
        };
      }>(
        startWorker(database.databaseUrl, { action: "list", storyId, userId })
      );
      expect(
        finalList.result.messages.slice(-2).map(message => ({
          role: message.role,
          content: message.content,
          bound: message.turnId != null,
        }))
      ).toEqual([
        { role: "user", content: "并发问题", bound: true },
        { role: "assistant", content: "回答:并发问题", bound: true },
      ]);
    });
  }, 120_000);

  it("installs scoped turn and message-pair uniqueness", async () => {
    await withMysqlTestDatabase(async database => {
      const connection = await mysql.createConnection(database.databaseUrl);
      try {
        const [rows] = await connection.execute<mysql.RowDataPacket[]>(
          "SELECT DISTINCT index_name AS indexName FROM information_schema.statistics WHERE table_schema = ? AND table_name IN ('story_conversation_turns', 'story_conversation_messages')",
          [database.databaseName]
        );
        const indexes = new Set(rows.map(row => String(row.indexName)));
        [
          "story_conversation_turns_story_turn_unique",
          "story_conversation_turns_user_message_unique",
          "story_conversation_turns_assistant_message_unique",
          "story_conversation_messages_turn_role_unique",
        ].forEach(indexName => expect(indexes.has(indexName)).toBe(true));
      } finally {
        await connection.end();
      }
    });
  }, 120_000);
});
