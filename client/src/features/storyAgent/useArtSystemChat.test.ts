import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ write: vi.fn(), append: vi.fn(), setDirection: vi.fn(), setRevision: vi.fn(),
  setMessages: vi.fn(), setData: vi.fn(), invalidate: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/trpc", () => ({ trpc: {
  artSystems: { write: { useMutation: () => ({ mutateAsync: m.write }) } },
  storyConversation: { appendTurn: { useMutation: () => ({ mutateAsync: m.append }) } },
  useUtils: () => ({ artSystems: { read: { setData: m.setData } }, storyAgent: { storyMaterialState: { invalidate: m.invalidate } } }),
} }));
vi.mock("sonner", () => ({ toast: { error: m.error } }));
vi.mock("@shared/artSystem", () => ({ artSystemChatReply: () => "美术方案已保存" }));
vi.mock("./chatImageRefsStore", () => ({ chatImageRefsStore: { getState: () => ({ storyId: 2, refs: [{ imageId: 9 }] }) } }));
vi.mock("./spine/storySpine", () => ({ storySpineStore: { getState: () => ({
  setArtDirection: m.setDirection, setServerRevision: m.setRevision, setMessages: m.setMessages,
}) } }));
import { useArtSystemChat } from "./useArtSystemChat";
const userMessage = { id: "user1", role: "user" as const, content: "建立美术体系", timestamp: 1 };
const input = () => ({ command: { action: "draft" as const }, instruction: userMessage.content,
  storyId: 1, expectedVersion: 3, selection: null, userMessage, nextMessages: [userMessage], isCurrent: () => true });
beforeEach(() => {
  vi.clearAllMocks(); m.write.mockResolvedValue({ direction: {}, version: 4, revision: 7 });
  m.append.mockResolvedValue({}); m.invalidate.mockResolvedValue(undefined);
});
it("keeps the expected version and excludes references from another story", async () => {
  expect(await useArtSystemChat()(input())).toBe(true);
  expect(m.write).toHaveBeenCalledWith(expect.objectContaining({ storyId: 1, expectedVersion: 3, referenceImageIds: [] }));
  expect(m.setRevision).toHaveBeenCalledWith(7);
  expect(m.append).toHaveBeenCalledWith(expect.objectContaining({ storyId: 1,
    userMessage: { clientMessageId: "user1", content: userMessage.content, selection: null } }));
});
it("does not apply a late result or append a reply after switching stories", async () => {
  expect(await useArtSystemChat()({ ...input(), isCurrent: () => false })).toBe(false);
  expect(m.setDirection).not.toHaveBeenCalled(); expect(m.setMessages).not.toHaveBeenCalled();
  expect(m.append).not.toHaveBeenCalled();
});
it("retains the old direction on failure and shows a recoverable reply", async () => {
  m.write.mockRejectedValue(new Error("conflict")); await useArtSystemChat()(input());
  expect(m.setDirection).not.toHaveBeenCalled();
  expect(m.setMessages.mock.calls[0][0][1].content).toContain("原版本保留");
});
