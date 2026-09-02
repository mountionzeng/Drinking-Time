import mysql from "mysql2/promise";

import {
  appendStoryConversationTurn,
  appendMobileStoryConversationTurn,
  generateMobileStoryConversationTurn,
  listStoryConversation,
} from "../services/storyConversation";

type WorkerInput =
  | {
      action: "generate";
      storyId: number;
      userId: number;
      clientTurnId: string;
      requestHash: string;
      userClientMessageId: string;
      assistantClientMessageId: string;
      userContent: string;
      holdMs?: number;
      startAtMs?: number;
    }
  | {
      action: "appendLegacy";
      storyId: number;
      userId: number;
      userMessage: { clientMessageId: string; content: string };
      assistantMessage: { clientMessageId: string; content: string };
      startAtMs?: number;
    }
  | {
      action: "append";
      storyId: number;
      userId: number;
      clientTurnId: string;
      requestHash: string;
    }
  | { action: "list"; storyId: number; userId: number };

function decodeInput(value: string | undefined): WorkerInput {
  if (!value) throw new Error("story conversation worker input is required");
  return JSON.parse(
    Buffer.from(value, "base64url").toString("utf8")
  ) as WorkerInput;
}

async function finish(payload: unknown): Promise<never> {
  await new Promise<void>((resolve, reject) => {
    process.stdout.write(
      `MYSQL_WORKER_RESULT:${JSON.stringify(payload)}\n`,
      error => (error ? reject(error) : resolve())
    );
  });
  process.exit(0);
}

try {
  const input = decodeInput(process.argv[2]);
  if (input.action === "generate") {
    if (input.startAtMs) {
      await new Promise(resolve =>
        setTimeout(resolve, Math.max(0, input.startAtMs! - Date.now()))
      );
    }
    const result = await generateMobileStoryConversationTurn(input, {
      generateReply: async () => {
        const connection = await mysql.createConnection(
          process.env.DATABASE_URL ?? ""
        );
        try {
          await connection.execute(
            "INSERT INTO turn_generation_audit (`clientTurnId`) VALUES (?)",
            [input.clientTurnId]
          );
        } finally {
          await connection.end();
        }
        if (input.holdMs) {
          await new Promise(resolve => setTimeout(resolve, input.holdMs));
        }
        return { reply: `回答:${input.userContent}` };
      },
    });
    await finish({ ok: true, result });
  }
  if (input.action === "append") {
    await finish({
      ok: true,
      result: await appendMobileStoryConversationTurn(input),
    });
  }
  if (input.action === "appendLegacy") {
    if (input.startAtMs) {
      await new Promise(resolve =>
        setTimeout(resolve, Math.max(0, input.startAtMs! - Date.now()))
      );
    }
    await finish({
      ok: true,
      result: await appendStoryConversationTurn(input),
    });
  }
  await finish({
    ok: true,
    result: await listStoryConversation(input),
  });
} catch (error) {
  const value = error as Error;
  await finish({
    ok: false,
    error: { name: value.name, message: value.message },
  });
}
