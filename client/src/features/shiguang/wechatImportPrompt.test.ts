import { expect, it, vi } from "vitest";
import {
  hasPendingWechatStories,
  wechatPromptStorageKey,
} from "./wechatImportOffer";
import { accountLabel } from "../auth/accountLabel";

it("does not ask an empty account or one whose versions are already migrated", async () => {
  expect(
    await hasPendingWechatStories(async () => ({
      stories: [],
      nextCursor: null,
    }))
  ).toBe(false);
  expect(
    await hasPendingWechatStories(async () => ({
      stories: [{ importedStoryId: 2 }],
      nextCursor: null,
    }))
  ).toBe(false);
});
it("finds a new story past an empty or already-imported page without importing anything", async () => {
  const load = vi
    .fn()
    .mockResolvedValueOnce({
      stories: [{ importedStoryId: 2 }],
      nextCursor: 50,
    })
    .mockResolvedValueOnce({ stories: [], nextCursor: 100 })
    .mockResolvedValueOnce({
      stories: [{ importedStoryId: null }],
      nextCursor: null,
    });
  expect(await hasPendingWechatStories(load)).toBe(true);
  expect(load.mock.calls).toEqual([[0], [50], [100]]);
});
it("discards a late response after changing accounts or leaving the workspace", async () => {
  let active = true;
  expect(
    await hasPendingWechatStories(
      async () => {
        active = false;
        return { stories: [{ importedStoryId: null }], nextCursor: null };
      },
      () => active
    )
  ).toBe(false);
  expect(wechatPromptStorageKey(10)).not.toBe(wechatPromptStorageKey(11));
});
it("leaves unavailable catalogs as errors and rejects pagination loops", async () => {
  await expect(
    hasPendingWechatStories(async () => {
      throw new Error("offline");
    })
  ).rejects.toThrow("offline");
  await expect(
    hasPendingWechatStories(async () => ({ stories: [], nextCursor: 0 }))
  ).rejects.toThrow("cursor");
});
it("labels a verified WeChat user as a WeChat account, not a guest", () => {
  expect(accountLabel({ loginMethod: "wechat", email: null })).toBe("微信账号");
  expect(
    accountLabel({ loginMethod: "wechat", email: "member@example.test" })
  ).toBe("微信账号 · member@example.test");
  expect(
    accountLabel({ loginMethod: "email", email: "member@example.test" })
  ).toBe("member@example.test");
  expect(accountLabel({ loginMethod: "guest" })).toContain("访客身份");
  expect(accountLabel(null)).toBe("未登录");
});
