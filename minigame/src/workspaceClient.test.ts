import { expect, it, vi } from "vitest";
import { createWorkspaceClient, type WorkspaceCall } from "./workspaceClient";
const document = {
  storyId: 41,
  storyRevision: 1,
  versionId: "v1",
  platform: "xiaohongshu" as const,
  body: "旧正文",
  bodyRevision: 1,
  draftRevision: 1,
  versionRevision: 1,
  containerRevision: 1,
  publishingRevision: 1,
  updatedAt: 1,
};
function setup(
  override: Record<string, (input: any) => Promise<any>> = {},
  beforeWrite = () => {}
) {
  const data = new Map<string, string>();
  const request = vi.fn(async (op: string, input: any) => {
    if (override[op]) return override[op](input);
    if (op === "account.read")
      return {
        id: 7,
        name: "测试",
        email: "test@example.com",
        recoveryScope: "opaque-account-scope",
      };
    if (op === "stories.list")
      return {
        stories: [
          { id: 41, title: "旧故事" },
          { id: 42, title: "另一篇" },
        ],
      };
    if (op === "body.read") return { ...document, storyId: input.storyId };
    if (op === "chat.list") return { messages: [] };
    throw new Error("unexpected " + op);
  });
  const client = createWorkspaceClient(
    request as WorkspaceCall,
    {
      getItem: k => data.get(k) ?? null,
      setItem: (k, v) => {
        beforeWrite();
        data.set(k, v);
      },
      removeItem: k => {
        beforeWrite();
        data.delete(k);
      },
    },
    () => {}
  );
  return { client, request, data };
}
it("opens the original story, saves with Web CAS fields, and protects unsaved switching", async () => {
  const { client, request } = setup({
    "body.save": async input => ({
      status: "saved",
      document: { ...document, body: input.body, bodyRevision: 2 },
    }),
  });
  await client.connect();
  expect(client.getState().document?.body).toBe("旧正文");
  client.editBody("新正文");
  expect(await client.select(42)).toBe(false);
  expect(await client.save()).toBe(true);
  expect(request).toHaveBeenCalledWith("body.save", {
    storyId: 41,
    versionId: "v1",
    platform: "xiaohongshu",
    baseBodyRevision: 1,
    body: "新正文",
  });
  expect(await client.select(42)).toBe(true);
});
it("keeps local and remote text on conflicts and scopes recovery keys without email", async () => {
  const { client, data } = setup({
    "body.save": async () => ({
      status: "conflict",
      reason: "body_changed",
      latestDocument: { ...document, body: "网页改写", bodyRevision: 2 },
    }),
  });
  await client.connect();
  client.editBody("我的修改");
  expect(await client.save()).toBe(false);
  expect(client.getState().document?.conflict).toMatchObject({
    localBody: "我的修改",
    latestDocument: { body: "网页改写" },
  });
  expect(
    [...data.keys()].every(
      k => k.includes("opaque-account-scope") && !k.includes("@")
    )
  ).toBe(true);
  client.disconnect();
  expect(client.getState().document).toBeNull();
});
it("queries the same turn after a lost response without generating a second answer", async () => {
  const { client, request } = setup({
    "chat.generate": async () => {
      throw new Error("timeout");
    },
    "chat.status": async () => ({
      status: "completed",
      turn: { assistantContent: "原回答", appendStatus: "pending" },
    }),
    "chat.append": async () => ({ status: "appended" }),
  });
  await client.connect();
  client.setChatDraft("你好");
  await client.send();
  const calls = request.mock.calls;
  expect(calls.filter(([op]) => op === "chat.generate")).toHaveLength(1);
  expect(calls.find(([op]) => op === "chat.status")?.[1]).toMatchObject({
    requestHash: calls.find(([op]) => op === "chat.generate")?.[1].requestHash,
  });
  expect(client.getState().turns[0]).toMatchObject({
    status: "synced",
    assistantContent: "原回答",
  });
});
it("does not append a late answer after logout", async () => {
  let finish!: (value: unknown) => void;
  const { client, request } = setup({
    "chat.generate": () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  });
  await client.connect();
  client.setChatDraft("你好");
  const sending = client.send();
  client.disconnect();
  finish({
    status: "completed",
    turn: { assistantContent: "晚到", appendStatus: "pending" },
  });
  await sending;
  expect(request.mock.calls.some(([op]) => op === "chat.append")).toBe(false);
  expect(client.getState().account).toBeNull();
});
it("retains edited text in memory and stops generation when recovery storage fails", async () => {
  let fail = false;
  const { client, request } = setup({}, () => {
    if (fail) throw new Error("quota");
  });
  await client.connect();
  fail = true;
  expect(() => client.editBody("不能丢掉的修改")).toThrow(
    "storage_unavailable"
  );
  expect(client.getState().document?.body).toBe("不能丢掉的修改");
  expect(client.hasUnsavedChanges()).toBe(true);
  client.setChatDraft("不要重复生成");
  await expect(client.send()).rejects.toThrow("storage_unavailable");
  expect(client.getState().chatDraft).toBe("不要重复生成");
  expect(request.mock.calls.some(([op]) => op === "chat.generate")).toBe(false);
  expect(client.getState().busy).toBe("");
});
it("releases busy state when storage fails after a successful remote save", async () => {
  let fail = false;
  const { client } = setup(
    {
      "body.save": async input => {
        fail = true;
        return {
          status: "saved",
          document: { ...document, body: input.body, bodyRevision: 2 },
        };
      },
    },
    () => {
      if (fail) throw new Error("quota");
    }
  );
  await client.connect();
  client.editBody("已保存正文");
  await expect(client.save()).rejects.toThrow("storage_unavailable");
  expect(client.getState().busy).toBe("");
  expect(client.getState().document?.body).toBe("已保存正文");
});
