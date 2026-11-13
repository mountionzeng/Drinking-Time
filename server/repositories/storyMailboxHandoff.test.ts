import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { User, StoryChapter } from "../../drizzle/schema";
import { ENV } from "../_core/env";
import { getDb, memoryState, resetMemoryStateForTesting } from "./runtime";
import { createStory } from "./stories";
import { previewMailboxStory } from "./storyMailboxActions";
import {
  confirmMailboxHandoff,
  createMailboxHandoff,
  getMailboxHandoff,
  listNativeMailbox,
  previewMailboxHandoff,
  readNativeMailbox,
  shareNativeMailbox,
} from "./storyMailboxHandoff";
import { nativeMailboxDocument } from "../services/storyMailboxNativeView";
const a = `shiguang:${"a".repeat(64)}`,
  b = `shiguang:${"b".repeat(64)}`;
let storyId: number;
beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  resetMemoryStateForTesting();
  await getDb();
  vi.spyOn(ENV, "cookieSecret", "get").mockReturnValue(
    "mailbox-handoff-unit-secret-at-least-32"
  );
  memoryState.users.push(
    { id: 1, name: "Web owner" } as User,
    { id: 2, name: "Other" } as User
  );
  storyId = (
    await createStory({
      userId: 1,
      title: "Paper boat",
      body: { chatHistory: [{ content: "PRIVATE CHAT" }] },
    })
  ).id;
  memoryState.storyChapters.push({
    id: 5,
    storyId,
    userId: 1,
    title: "Chapter",
    position: 0,
    version: 1,
    layout: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    blocks: {
      body: "Shared text\n\nPRIVATE NOTE",
      blockIds: ["share", "private"],
      containsAiText: false,
      settings: null,
      coverKey: null,
      bodyTextureKey: null,
      images: {},
      illustrations: [],
    },
  } as StoryChapter);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
async function draft(requestId = randomUUID()) {
  const selection = { version: 1 as const, keys: ["paragraph:5:share"] };
  const preview = await previewMailboxStory(1, storyId, selection);
  const input = {
    storyId,
    selection,
    fingerprint: preview.fingerprint,
    requestId,
  };
  return { input, result: await createMailboxHandoff(1, input) };
}
describe("private native mailbox handoff", () => {
  it("rejects oversized receipts without leaving a binding or stored handoff", async () => {
    memoryState.storyChapters[0].blocks.body = "x".repeat(901 * 1024);
    memoryState.storyChapters[0].blocks.blockIds = ["share"];
    await expect(draft()).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    expect(memoryState.storyMailboxHandoffs).toEqual([]);
    expect(memoryState.storyMailboxWechatBindings).toEqual([]);
  });
  it("requires explicit receipt, binds the content channel only and exposes no private prose/history", async () => {
    const { result } = await draft();
    expect(await listNativeMailbox(a)).toEqual([]);
    await previewMailboxHandoff(a, result.code);
    expect(memoryState.storyMailboxWechatBindings).toEqual([]);
    await confirmMailboxHandoff(a, result.code);
    expect(await listNativeMailbox(a)).toHaveLength(1);
    expect(await listNativeMailbox(b)).toEqual([]);
    expect(memoryState.accountIdentities).toEqual([]);
    expect(memoryState.creditAccounts).toEqual([]);
    const { row, mine } = await readNativeMailbox(a, result.id);
    expect(mine).toBe(true);
    expect(JSON.stringify(nativeMailboxDocument(row, mine))).not.toContain(
      "PRIVATE"
    );
    await expect(readNativeMailbox(b, result.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
  it("deduplicates web retries and concurrent phone confirmations without creating duplicate copies", async () => {
    const { input, result } = await draft();
    expect((await createMailboxHandoff(1, input)).id).toBe(result.id);
    const results = await Promise.all([
      confirmMailboxHandoff(a, result.code),
      confirmMailboxHandoff(a, result.code),
    ]);
    expect(results.filter(r => !r.repeated)).toHaveLength(1);
    expect(memoryState.storyMailboxHandoffs).toHaveLength(1);
    await expect(createMailboxHandoff(2, input)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(confirmMailboxHandoff(b, result.code)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
  it("retains an existing binding when another WeChat account scans a later receipt", async () => {
    const first = await draft();
    await confirmMailboxHandoff(a, first.result.code);
    const second = await draft();
    await expect(
      previewMailboxHandoff(b, second.result.code)
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      confirmMailboxHandoff(b, second.result.code)
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(memoryState.storyMailboxWechatBindings[0].subject).toBe(a);
    expect((await getMailboxHandoff(second.result.id))!.confirmedAt).toBeNull();
  });
  it("expires unconfirmed receipts, rejects a changed preview and never expands old snapshots", async () => {
    const { input, result } = await draft();
    (await getMailboxHandoff(result.id))!.expiresAt = new Date(0);
    await expect(confirmMailboxHandoff(a, result.code)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    memoryState.storyChapters[0].blocks.body = "NEW CONTENT\n\nPRIVATE CHANGED";
    await expect(
      createMailboxHandoff(1, { ...input, requestId: randomUUID() })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      (await getMailboxHandoff(result.id))!.snapshot.chapters[0].blocks.body
    ).toBe("Shared text");
  });
  it("requires owner sharing, returns only selected content to a friend and revokes links", async () => {
    const { result } = await draft();
    await confirmMailboxHandoff(a, result.code);
    await expect(shareNativeMailbox(b, result.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const share = await shareNativeMailbox(a, result.id);
    expect((await shareNativeMailbox(a, result.id)).token).toBe(share.token);
    const { row, mine } = await readNativeMailbox(b, result.id, share.token!);
    expect(mine).toBe(false);
    expect(JSON.stringify(nativeMailboxDocument(row, mine))).not.toContain(
      "PRIVATE"
    );
    expect(row.snapshot.chapterVersions).toEqual([]);
    await shareNativeMailbox(a, result.id, true);
    await expect(
      readNativeMailbox(b, result.id, share.token!)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await readNativeMailbox(a, result.id)).mine).toBe(true);
    expect((await shareNativeMailbox(a, result.id)).token).not.toBe(
      share.token
    );
    await expect(
      readNativeMailbox(b, result.id, share.token!)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
