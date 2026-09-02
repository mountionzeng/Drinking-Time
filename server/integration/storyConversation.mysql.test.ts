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

  it("atomically rejects a client message ID claimed across opposite roles", async () => {
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
          ["mysql-cross-role-owner", "Owner", "cross-role@example.test", "test"]
        );
        userId = userResult.insertId;
        const [storyResult] = await setup.execute<mysql.ResultSetHeader>(
          "INSERT INTO stories (`userId`, `title`, `body`) VALUES (?, ?, ?)",
          [userId, "Cross-role race", JSON.stringify({ cards: [], shots: [] })]
        );
        storyId = storyResult.insertId;
        await setup.execute(
          "INSERT INTO story_prompt_states (`storyId`, `userId`, `version`, `migrationStatus`) VALUES (?, ?, 0, 'migrated')",
          [storyId, userId]
        );
        await setup.execute(
          "INSERT INTO story_conversations (`storyId`, `userId`) VALUES (?, ?)",
          [storyId, userId]
        );
        // Widen the exact INSERT window so the old precheck-then-insert
        // implementation deterministically lets both independent workers pass
        // their collision reads before either new turn is visible. The fixed
        // implementation holds the conversation row lock, so only its winner
        // reaches this trigger and the loser conflicts before model audit.
        // CREATE TRIGGER 走不了 mysql2 的 prepared statement 协议（execute），
        // 必须用 query。之前写成 execute，导致这条用例在真实 MySQL 上从没跑起来过。
        await setup.query(
          "CREATE TRIGGER story_turn_cross_role_race BEFORE INSERT ON story_conversation_turns FOR EACH ROW SET @story_turn_cross_role_race_delay = SLEEP(1)"
        );
      } finally {
        await setup.end();
      }

      const sharedMessageId = "mysql-cross-role-shared-message";
      const startAtMs = Date.now() + 750;
      const leftIdentity = {
        storyId,
        userId,
        clientTurnId: "mysql-cross-role-left",
        userClientMessageId: sharedMessageId,
        assistantClientMessageId: "mysql-cross-role-left-assistant",
        userContent: "左侧问题",
      };
      const rightIdentity = {
        storyId,
        userId,
        clientTurnId: "mysql-cross-role-right",
        userClientMessageId: "mysql-cross-role-right-user",
        assistantClientMessageId: sharedMessageId,
        userContent: "右侧问题",
      };
      const workers = [leftIdentity, rightIdentity].map(identity =>
        startWorker(database.databaseUrl, {
          action: "generate",
          ...identity,
          requestHash: computeStoryConversationTurnRequestHash(identity),
          startAtMs,
        })
      );
      const results = await Promise.all(
        workers.map(worker =>
          workerResult<{
            ok: boolean;
            result?: { status: string };
            error?: { name: string };
          }>(worker)
        )
      );

      expect(results.filter(result => result.ok)).toHaveLength(1);
      expect(results.find(result => result.ok)?.result?.status).toBe(
        "completed"
      );
      expect(results.find(result => !result.ok)?.error?.name).toBe(
        "StoryConversationIdempotencyConflictError"
      );

      const verify = await mysql.createConnection(database.databaseUrl);
      try {
        const [auditRows] = await verify.execute<mysql.RowDataPacket[]>(
          "SELECT COUNT(*) AS count FROM turn_generation_audit WHERE clientTurnId IN (?, ?)",
          [leftIdentity.clientTurnId, rightIdentity.clientTurnId]
        );
        expect(Number(auditRows[0]?.count)).toBe(1);
        const [turnRows] = await verify.execute<mysql.RowDataPacket[]>(
          "SELECT COUNT(*) AS count FROM story_conversation_turns WHERE storyId = ? AND userId = ? AND (userClientMessageId = ? OR assistantClientMessageId = ?)",
          [storyId, userId, sharedMessageId, sharedMessageId]
        );
        expect(Number(turnRows[0]?.count)).toBe(1);
      } finally {
        await verify.end();
      }
    });
  }, 120_000);

  it("serializes legacy turn retries and rejects conflicting payloads", async () => {
    await withMysqlTestDatabase(async database => {
      const setup = await mysql.createConnection(database.databaseUrl);
      let userId = 0;
      let storyId = 0;
      try {
        const [userResult] = await setup.execute<mysql.ResultSetHeader>(
          "INSERT INTO users (`openId`, `name`, `email`, `loginMethod`) VALUES (?, ?, ?, ?)",
          [
            "mysql-legacy-turn-owner",
            "Owner",
            "legacy-turn@example.test",
            "test",
          ]
        );
        userId = userResult.insertId;
        const [storyResult] = await setup.execute<mysql.ResultSetHeader>(
          "INSERT INTO stories (`userId`, `title`, `body`) VALUES (?, ?, ?)",
          [userId, "Legacy turn race", JSON.stringify({ cards: [], shots: [] })]
        );
        storyId = storyResult.insertId;
        await setup.execute(
          "INSERT INTO story_prompt_states (`storyId`, `userId`, `version`, `migrationStatus`) VALUES (?, ?, 0, 'migrated')",
          [storyId, userId]
        );
        await setup.execute(
          "INSERT INTO story_conversations (`storyId`, `userId`) VALUES (?, ?)",
          [storyId, userId]
        );
        await setup.query(
          "CREATE TRIGGER story_message_payload_race BEFORE INSERT ON story_conversation_messages FOR EACH ROW SET @story_message_payload_race_delay = SLEEP(0.5)"
        );
      } finally {
        await setup.end();
      }

      const startAtMs = Date.now() + 750;
      const makeInput = (label: string) => ({
        action: "appendLegacy" as const,
        storyId,
        userId,
        userMessage: {
          clientMessageId: "mysql-legacy-shared-user",
          content: `${label}问题`,
        },
        assistantMessage: {
          clientMessageId: "mysql-legacy-shared-assistant",
          content: `${label}回答`,
        },
        startAtMs,
      });
      const workers = [makeInput("左侧"), makeInput("右侧")].map(input =>
        startWorker(database.databaseUrl, input)
      );
      const results = await Promise.all(
        workers.map(worker =>
          workerResult<{
            ok: boolean;
            error?: { name: string };
          }>(worker)
        )
      );

      expect(results.filter(result => result.ok)).toHaveLength(1);
      expect(results.find(result => !result.ok)?.error?.name).toBe(
        "StoryConversationIdempotencyConflictError"
      );

      const verify = await mysql.createConnection(database.databaseUrl);
      try {
        const [messages] = await verify.execute<mysql.RowDataPacket[]>(
          "SELECT role, content FROM story_conversation_messages WHERE storyId = ? AND userId = ? ORDER BY id",
          [storyId, userId]
        );
        expect(messages).toHaveLength(2);
        expect(messages.map(message => String(message.content))).toEqual(
          messages[0]?.content === "左侧问题"
            ? ["左侧问题", "左侧回答"]
            : ["右侧问题", "右侧回答"]
        );
      } finally {
        await verify.end();
      }
    });
  }, 120_000);
});
