import { expect, it } from "vitest";
import { readVideoSubmitNotices, updateVideoSubmitNotices, videoSubmitNoticeKey } from "./videoSubmitNotice";
it("keeps a scoped failure across refresh and clears only the accepted shot", () => {
  let saved = ""; const store = { getItem: () => saved, setItem: (_key: string, value: string) => { saved = value; } };
  const a = videoSubmitNoticeKey(1, { stableShotId: "shot-a", shotNo: 3 });
  const b = videoSubmitNoticeKey(2, { stableShotId: "shot-a", shotNo: 3 });
  let notices = updateVideoSubmitNotices([], a, "提交超时，结果未知", 48, store);
  notices = updateVideoSubmitNotices(notices, b, "HTTP 404", 48, store);
  expect(readVideoSubmitNotices(48, store)).toEqual(notices);
  expect(notices[0].reason).not.toContain("未扣费");
  notices = updateVideoSubmitNotices(notices, a, null, 48, store);
  expect(readVideoSubmitNotices(48, store)).toEqual([{ key: b, reason: notices[0].reason }]);
  notices = updateVideoSubmitNotices(notices, a, "新的失败", 48, store);
  expect(readVideoSubmitNotices(48, store)).toEqual([notices[0], { key: a, reason: "新的失败" }]);
  expect(videoSubmitNoticeKey(1, { stableShotId: "shot-a", shotNo: 4 })).toBe(a);
});
it("survives unavailable or corrupt browser storage and bounds persisted notices", () => {
  expect(readVideoSubmitNotices(48, { getItem: () => "invalid", setItem: () => {} })).toEqual([]);
  expect(updateVideoSubmitNotices([], "a", "failed", 48, { getItem: () => "[]", setItem: () => { throw new Error("quota"); } })).toHaveLength(1);
  expect(updateVideoSubmitNotices(Array.from({ length: 100 }, (_, i) => ({ key: String(i), reason: "failure" })), "new", "failure", 48)).toHaveLength(100);
});
it("isolates accounts and ignores old unowned notices and unauthenticated writes", () => {
  const values = new Map<string, string>([["storyboard-video-submit-notices-v1", JSON.stringify([{ key: "1:s3", reason: "private old error" }])]]);
  const store = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  expect(readVideoSubmitNotices(48, store)).toEqual([]);
  const a = updateVideoSubmitNotices([], "1:s3", "private account A", 48, store);
  expect(readVideoSubmitNotices(49, store)).toEqual([]);
  updateVideoSubmitNotices([], "1:s3", "private account B", 49, store);
  expect(readVideoSubmitNotices(48, store)).toEqual(a);
  expect(readVideoSubmitNotices(null, store)).toEqual([]);
  expect(updateVideoSubmitNotices(a, "1:s3", null, null, store)).toEqual([]);
  expect(readVideoSubmitNotices(48, store)).toEqual(a);
});
