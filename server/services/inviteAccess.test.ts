import { describe, expect, it } from "vitest";

import {
  generateInviteCode,
  hashInviteCode,
  normalizeInviteCode,
} from "./inviteAccess";

describe("inviteAccess", () => {
  it("忽略大小写、空格和连字符差异", () => {
    expect(normalizeInviteCode(" lh-ab12-cd34 ")).toBe("LHAB12CD34");
    expect(hashInviteCode("LH-AB12-CD34")).toBe(hashInviteCode("lh ab12 cd34"));
  });

  it("生成便于人工转发且避开易混字符的邀请码", () => {
    const code = generateInviteCode();

    expect(code).toMatch(/^LH-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(code).not.toMatch(/[01IO]/);
  });

  it("哈希结果不会泄露原始邀请码", () => {
    const code = "LH-AB12-CD34";
    const digest = hashInviteCode(code);

    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(digest).not.toContain(code);
  });
});
