import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { MemoryCard } from "../../drizzle/schema";
import { getStoryById } from "../repositories/stories";
import {
  insertChatMemoryCards,
  listMemorySourceStoryIds,
} from "../repositories/memoryCards";
import { loadStoryPromptAggregate } from "./promptLineageStore";

type Owner = { storyId: number; userId: number };
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
function sourceUuid(value: string) {
  const hex = hash(value);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Raw conversation, no model, classification or inference. Each edit is a new snapshot. */
export function buildChatMemoryCards(
  input: Owner & {
    messages: unknown[];
    durableMessages: unknown[];
    fallbackDate: Date;
  }
): MemoryCard[] {
  const messages = new Map<string, Record<string, unknown>>();
  for (const raw of [...input.messages, ...input.durableMessages]) {
    const message = record(raw);
    if (
      (message.role !== "user" && message.role !== "assistant") ||
      typeof message.content !== "string" ||
      !message.content.trim()
    )
      continue;
    // Shared background is never the recipient's own conversation.
    if (
      message.source === "story-context-share" ||
      message.source === "inherited-story"
    )
      continue;
    const identity = String(
      message.clientMessageId ??
        (typeof message.id === "string" ? message.id : hash(message.content))
    );
    messages.set(`${message.role}:${identity}`, message);
  }
  const rows: MemoryCard[] = [];
  for (const [identity, message] of messages) {
    const text = message.content as string;
    const date = new Date(
      (message.timestamp ?? message.createdAt ?? input.fallbackDate) as
        | string
        | number
        | Date
    );
    // Split long messages without losing text or breaking surrogate pairs.
    const points = Array.from(text);
    for (let offset = 0; offset < points.length; offset += 6000) {
      const content = points.slice(offset, offset + 6000).join("");
      rows.push({
        id: sourceUuid(
          JSON.stringify([
            input.userId,
            input.storyId,
            identity,
            hash(text),
            offset,
          ])
        ),
        userId: input.userId,
        sourceStoryId: input.storyId,
        title: `${message.role === "user" ? "我说" : "聊聊回应"} · ${Array.from(text.trim().replace(/\s+/g, " ")).slice(0, 40).join("")}${points.length > 6000 ? `（${offset / 6000 + 1}）` : ""}`,
        content,
        kind: "conversation",
        origin: message.role as "user" | "assistant",
        createdAt: Number.isNaN(date.getTime()) ? input.fallbackDate : date,
        archived: false,
      });
    }
  }
  return rows;
}

export async function syncStoryChatMemories(owner: Owner) {
  const story = await getStoryById(owner.storyId, owner.userId);
  if (!story)
    throw new TRPCError({ code: "NOT_FOUND", message: "来源聊天不存在" });
  const body = record(story.body);
  const aggregate = await loadStoryPromptAggregate(owner);
  const rows = buildChatMemoryCards({
    ...owner,
    messages: Array.isArray(body.messages) ? body.messages : [],
    durableMessages: aggregate?.messages ?? [],
    fallbackDate: story.createdAt,
  });
  await insertChatMemoryCards(rows);
}

/** Conversation remains authoritative if mirroring is interrupted; warehouse sync repairs it. */
export async function syncStoryChatMemoriesSafely(owner: Owner) {
  try {
    await syncStoryChatMemories(owner);
  } catch {
    console.warn(
      "[memoryWarehouse] 聊天已保存，记忆收录等待重试",
      owner.storyId
    );
  }
}

export async function syncChatMemoryPage(userId: number, afterId: number) {
  const stories = await listMemorySourceStoryIds(userId, afterId);
  for (const story of stories.slice(0, 20))
    await syncStoryChatMemories({ userId, storyId: story.id });
  return { nextAfterId: stories.length > 20 ? stories[19].id : null };
}
