import { expect, it } from "vitest";
import type { ChatImageRevision } from "@shared/chatImageRevision";
import { chatRevisionSlots } from "./chatRevisionOrder";

it("keeps old receipts before the latest conversation, regardless of API result order", () => {
  const messages = [{ id: "old", timestamp: 10 }, { id: "latest", timestamp: 30 }];
  const revision = (requestId: string, createdAt: number) => ({ requestId, createdAt }) as ChatImageRevision;
  const rows = [revision("new", 40), revision("old-2110", 20), revision("older", 15), revision("unknown", NaN)];
  const before = JSON.stringify(rows);
  const slots = chatRevisionSlots(messages, rows);
  expect(slots.get("old")?.map(row => row.requestId)).toEqual(["older", "old-2110"]);
  expect(slots.get("latest")?.map(row => row.requestId)).toEqual(["new"]);
  expect(slots.get(null)?.map(row => row.requestId)).toEqual(["unknown"]);
  expect(JSON.stringify(rows)).toBe(before);
});

it("keeps receipts visible with no messages and breaks timestamp ties consistently", () => {
  const rows = ["b", "a"].map(requestId => ({ requestId, createdAt: 5 }) as ChatImageRevision);
  expect(chatRevisionSlots([], rows).get(null)?.map(row => row.requestId)).toEqual(["a", "b"]);
});
