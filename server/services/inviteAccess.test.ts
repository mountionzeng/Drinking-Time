import { describe, expect, it } from "vitest";

import {
  classifyInviteCodeDigest,
  generateInviteCode,
  hashInviteCode,
  inviteCodeMatchesDigest,
  inviteDigestFingerprint,
  normalizeInviteCode,
  unnormalizedInviteCodeDigest,
} from "./inviteAccess";

describe("inviteAccess", () => {
  it("忽略大小写、空格和连字符差异", () => {
    expect(normalizeInviteCode(" lh-ab12-cd34 ")).toBe("LHAB12CD34");
    expect(hashInviteCode("LH-AB12-CD34")).toBe(
      hashInviteCode("lh ab12 cd34")
    );
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

describe("邀请码摘要合同", () => {
  const rawCode = "LH-AB12-CD34";

  it("按原码逐字生成的摘要与权威摘要不同——这正是测试站登录失败的根因", () => {
    // 手工 sha256 的是带横线原文，应用在验证前会先删掉空白和横线。
    // 两端合同不一致时，正确原码也永远算不出库里那个摘要。
    expect(unnormalizedInviteCodeDigest(rawCode)).not.toBe(
      hashInviteCode(rawCode)
    );
    expect(inviteCodeMatchesDigest(rawCode, unnormalizedInviteCodeDigest(rawCode))).toBe(
      false
    );
  });

  it("把摘要分成三类：权威、历史未归一化、与该原码无关", () => {
    expect(classifyInviteCodeDigest(rawCode, hashInviteCode(rawCode))).toBe(
      "authoritative"
    );
    expect(
      classifyInviteCodeDigest(rawCode, unnormalizedInviteCodeDigest(rawCode))
    ).toBe("unnormalized-legacy");
    expect(
      classifyInviteCodeDigest(rawCode, unnormalizedInviteCodeDigest(rawCode.toLowerCase()))
    ).toBe("unnormalized-legacy");
    expect(classifyInviteCodeDigest(rawCode, hashInviteCode("LH-ZZ99-ZZ99"))).toBe(
      "unrelated"
    );
  });

  it("原码本身没有分隔符时，不把权威摘要误判成历史摘要", () => {
    const flat = "LHAB12CD34";

    expect(unnormalizedInviteCodeDigest(flat)).toBe(hashInviteCode(flat));
    expect(classifyInviteCodeDigest(flat, hashInviteCode(flat))).toBe(
      "authoritative"
    );
  });

  it("校验接受既有的空白/大小写/横线变体，长度不同的摘要不抛异常", () => {
    const digest = hashInviteCode(rawCode);

    expect(inviteCodeMatchesDigest(" lh ab12-cd34 ", digest)).toBe(true);
    expect(inviteCodeMatchesDigest(rawCode, "")).toBe(false);
    expect(inviteCodeMatchesDigest(rawCode, "not-a-digest")).toBe(false);
  });

  it("给运维核对的指纹只来自摘要，不泄露原码", () => {
    const fingerprint = inviteDigestFingerprint(hashInviteCode(rawCode));

    expect(fingerprint).toMatch(/^[a-f0-9]{12}$/);
    expect(fingerprint).not.toContain("AB12");
    expect(inviteDigestFingerprint("")).toBe("(empty)");
  });
});
