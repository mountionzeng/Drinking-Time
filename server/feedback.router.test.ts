import { randomUUID } from "node:crypto";
import { beforeEach, expect, it } from "vitest";
import { feedbackRouter } from "./routers/feedback";
import {
  memoryState,
  resetMemoryStateForTesting,
} from "./repositories/runtime";
import { upsertUser, getUserByOpenId } from "./repositories/users";
import {
  appendCreditLedgerEntry,
  getCreditAccountSummary,
} from "./repositories/computeLedger";
import { FEEDBACK_REWARD_MINOR } from "../shared/feedback";
import { formatComputeUnits } from "../shared/computeMoney";
import type { TrpcContext } from "./_core/context";
const ctx = (user: TrpcContext["user"]) =>
  ({ user, req: { headers: {} }, res: {} }) as TrpcContext;
beforeEach(() => {
  process.env.DATABASE_URL = "";
  resetMemoryStateForTesting();
});
async function user(role: "admin" | "user" = "user") {
  const openId = randomUUID();
  await upsertUser({
    openId,
    role,
    email: `${openId}@example.com`,
    name: "Private name",
  });
  return (await getUserByOpenId(openId))!;
}
const post = () => ({
  id: randomUUID(),
  category: "bug" as const,
  title: "手机点击无响应",
  content: "点开图片后没有显示任何内容。",
  tags: ["手机", "图片"],
  page: "/m" as const,
});
it("shows cross-user public feedback without leaking account data", async () => {
  const author = await user();
  const viewer = await user();
  const input = post();
  await feedbackRouter.createCaller(ctx(author)).submit(input);
  const result = await feedbackRouter.createCaller(ctx(viewer)).list({});
  expect(result.canReview).toBe(false);
  expect(result.posts[0]).toMatchObject({
    title: input.title,
    tags: input.tags,
    isOwn: false,
  });
  for (const field of ["userId", "email", "openId", "reviewedBy", "name"])
    expect(result.posts[0]).not.toHaveProperty(field);
  expect(
    (await feedbackRouter.createCaller(ctx(author)).list({})).posts[0].isOwn
  ).toBe(true);
  expect(
    (
      await feedbackRouter
        .createCaller(ctx(viewer))
        .list({ category: "praise" })
    ).posts
  ).toEqual([]);
});
it("rejects anonymous publishing and non-admin reward attempts", async () => {
  await expect(
    feedbackRouter.createCaller(ctx(null)).submit(post())
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  const member = await user();
  await expect(
    feedbackRouter
      .createCaller(ctx(member))
      .review({ id: randomUUID(), action: "adopt", reply: "" })
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    feedbackRouter
      .createCaller(ctx(member))
      .submit({ ...post(), userId: 99 } as any)
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});
it("deduplicates submit retries and rejects id reuse by another author", async () => {
  const first = feedbackRouter.createCaller(ctx(await user()));
  const second = feedbackRouter.createCaller(ctx(await user()));
  const input = post();
  await first.submit(input);
  await first.submit(input);
  expect(memoryState.feedbackPosts).toHaveLength(1);
  await expect(second.submit(input)).rejects.toMatchObject({
    code: "CONFLICT",
  });
  await expect(
    first.submit({ ...input, content: "已经变化的反馈正文" })
  ).rejects.toMatchObject({ code: "CONFLICT" });
});
it("gifts exactly five credits once across concurrent adoption and immutable terminal status", async () => {
  const author = await user();
  const admin = await user("admin");
  const input = post();
  await feedbackRouter.createCaller(ctx(author)).submit(input);
  const caller = feedbackRouter.createCaller(ctx(admin));
  await Promise.all(
    Array.from({ length: 5 }, () =>
      caller.review({ id: input.id, action: "adopt", reply: "已采用" })
    )
  );
  const account = await getCreditAccountSummary(author.id);
  expect(account.balanceMinor).toBe(FEEDBACK_REWARD_MINOR);
  expect(formatComputeUnits(account.balanceMinor)).toBe("5.00 算力");
  expect(memoryState.creditLedgerEntries).toHaveLength(1);
  expect(memoryState.creditLedgerEntries[0].actorUserId).toBe(admin.id);
  expect(memoryState.feedbackPosts[0].status).toBe("adopted");
  await expect(
    caller.review({ id: input.id, action: "close", reply: "撤回" })
  ).rejects.toMatchObject({ code: "CONFLICT" });
});
it("resumes a crash after the gift was posted without paying twice", async () => {
  const author = await user();
  const admin = await user("admin");
  const input = post();
  await feedbackRouter.createCaller(ctx(author)).submit(input);
  Object.assign(memoryState.feedbackPosts[0], {
    status: "adopting",
    reviewedBy: admin.id,
  });
  await appendCreditLedgerEntry({
    userId: author.id,
    entryType: "gift",
    amountMinor: FEEDBACK_REWARD_MINOR,
    idempotencyKey: `feedback-adopted:${input.id}`,
  });
  await feedbackRouter
    .createCaller(ctx(admin))
    .review({ id: input.id, action: "adopt", reply: "" });
  expect(memoryState.creditLedgerEntries).toHaveLength(1);
  expect(memoryState.feedbackPosts[0].status).toBe("adopted");
});
it("keeps ordinary replies separate from reward adoption", async () => {
  const author = await user();
  const admin = await user("admin");
  const input = post();
  await feedbackRouter.createCaller(ctx(author)).submit(input);
  await feedbackRouter
    .createCaller(ctx(admin))
    .review({ id: input.id, action: "review", reply: "正在查看" });
  expect(memoryState.feedbackPosts[0]).toMatchObject({
    status: "reviewing",
    reply: "正在查看",
  });
  expect(memoryState.creditLedgerEntries).toHaveLength(0);
});
