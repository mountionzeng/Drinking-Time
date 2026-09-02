import { describe, expect, it } from "vitest";

import {
  MIN_PASSWORD_LENGTH,
  checkPasswordPolicy,
  generateOtpCode,
  hashOtpCode,
  hashPassword,
  otpDigestMatches,
  passwordRecordVersion,
  verifyPassword,
} from "./accountSecurity";

const OTP_SECRET = "test-otp-secret-value";

describe("密码策略", () => {
  it("至少 15 个字符，按码点算而不是按 UTF-16 单元", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(15);
    expect(checkPasswordPolicy("短口令").ok).toBe(false);
    expect(checkPasswordPolicy("a".repeat(14)).ok).toBe(false);
    // 15 个 emoji 是 30 个 UTF-16 单元、15 个码点，应当算作达标
    expect(checkPasswordPolicy("🍶".repeat(15)).ok).toBe(false); // 单字符重复仍是弱口令
    expect(checkPasswordPolicy("🍶今天下班很累啊我想喝一杯酒吧").ok).toBe(true);
  });

  it("不强制字符组合：全小写的长密码合法", () => {
    expect(checkPasswordPolicy("correcthorsebatterystaple").ok).toBe(true);
  });

  it("支持很长的密码和 Unicode，不截断", () => {
    expect(checkPasswordPolicy("私の好きな日本酒は久保田です本当に".repeat(3)).ok).toBe(true);
    expect(checkPasswordPolicy("x".repeat(200) + "diverse-tail").ok).toBe(true);
  });

  it("拒绝常见弱口令：单字符重复、键盘顺序、数字顺序、已知弱串", () => {
    for (const weak of [
      "aaaaaaaaaaaaaaaaa",
      "1111111111111111",
      "123456789012345678",
      "qwertyuiopasdfghjkl",
      "passwordpassword",
      "PASSWORDPASSWORD1",
    ]) {
      expect(checkPasswordPolicy(weak), weak).toMatchObject({
        ok: false,
        reason: "too_weak",
      });
    }
  });

  it("超过长度上限的输入被拒绝，避免拿超长串去打 scrypt", () => {
    expect(checkPasswordPolicy("a1b2c3d4e5f6g7h8".repeat(200))).toMatchObject({
      ok: false,
      reason: "too_long",
    });
  });
});

describe("密码存储", () => {
  it("用带版本和随机 salt 的 scrypt，不是裸 SHA-256", async () => {
    const record = await hashPassword("correcthorsebatterystaple");

    expect(record.startsWith("scrypt$v1$")).toBe(true);
    expect(passwordRecordVersion(record)).toBe(1);
    // 同一个密码两次得到不同 record（salt 随机）
    expect(await hashPassword("correcthorsebatterystaple")).not.toBe(record);
    // 摘要里不含明文
    expect(record).not.toContain("correcthorse");
  });

  it("校验正确密码通过、错误密码失败", async () => {
    const record = await hashPassword("correcthorsebatterystaple");

    expect(await verifyPassword("correcthorsebatterystaple", record)).toBe(true);
    expect(await verifyPassword("correcthorsebatterystapl", record)).toBe(false);
    expect(await verifyPassword("", record)).toBe(false);
  });

  it("NFC 归一化：同一个字符的组合形式与分解形式都能登录", async () => {
    // "\u00e9" 可以是单码点 U+00E9，也可以是 e + U+0301 组合。换个输入法就可能打出另一种。
    const composed = "caf\u00e9" + "x".repeat(12);
    const decomposed = "cafe\u0301" + "x".repeat(12);
    const record = await hashPassword(composed);

    expect(composed).not.toBe(decomposed); // 字面上确实是两个不同的串
    expect(await verifyPassword(decomposed, record)).toBe(true);
    expect(await verifyPassword(composed, await hashPassword(decomposed))).toBe(true);
  });

  it("兼容字符不被折叠：连字、全角字母、带圈数字都是各自独立的密码", async () => {
    // 这些正是 NFKC 会折叠而 NFC 不会的情形。折叠它们等于悄悄削减密码空间：
    // 用户以为自己用了一个特殊字符，实际上被换成了普通字母。
    const pairs: Array<[string, string]> = [
      ["\ufb01" + "abcdefghijklmn", "fi" + "abcdefghijklmn"], // \ufb01 连字 vs fi
      ["\uff41" + "bcdefghijklmnop", "a" + "bcdefghijklmnop"], // 全角 \uff41 vs a
      ["\u2460" + "abcdefghijklmn", "1" + "abcdefghijklmn"], // \u2460 vs 1
    ];

    for (const [special, plain] of pairs) {
      expect(await verifyPassword(plain, await hashPassword(special))).toBe(false);
      expect(await verifyPassword(special, await hashPassword(plain))).toBe(false);
      // 但各自都能用自己登录
      expect(await verifyPassword(special, await hashPassword(special))).toBe(true);
    }
  });

  it("损坏或来路不明的 record 不通过，也不抛异常", async () => {
    for (const bad of ["", "not-a-record", "scrypt$v9$1$1$1$aa$bb", "sha256$abc"]) {
      expect(await verifyPassword("correcthorsebatterystaple", bad)).toBe(false);
    }
  });
});

describe("邮箱验证码", () => {
  it("生成 6 位数字码，且分布覆盖全区间", () => {
    const codes = Array.from({ length: 200 }, () => generateOtpCode());

    for (const code of codes) expect(code).toMatch(/^\d{6}$/);
    expect(new Set(codes).size).toBeGreaterThan(150);
    // 不应当总是以 0 开头或总是落在低区间
    expect(codes.some(code => code[0] !== "0")).toBe(true);
  });

  it("摘要绑定邮箱和用途：同一个码换用途或换邮箱都对不上", () => {
    const base = {
      code: "123456",
      email: "a@example.com",
      purpose: "login" as const,
      secret: OTP_SECRET,
      version: 1,
    };
    const digest = hashOtpCode(base);

    expect(otpDigestMatches({ ...base, digest })).toBe(true);
    expect(otpDigestMatches({ ...base, purpose: "recover", digest })).toBe(false);
    expect(otpDigestMatches({ ...base, email: "b@example.com", digest })).toBe(false);
    expect(otpDigestMatches({ ...base, code: "123457", digest })).toBe(false);
  });

  it("换 secret 或换版本，旧摘要立即失效——支持轮换", () => {
    const base = {
      code: "123456",
      email: "a@example.com",
      purpose: "login" as const,
      secret: OTP_SECRET,
      version: 1,
    };
    const digest = hashOtpCode(base);

    expect(otpDigestMatches({ ...base, secret: "rotated-secret", digest })).toBe(false);
    expect(otpDigestMatches({ ...base, version: 2, digest })).toBe(false);
  });

  it("邮箱大小写和空格不影响摘要", () => {
    const digest = hashOtpCode({
      code: "123456",
      email: "a@example.com",
      purpose: "login",
      secret: OTP_SECRET,
      version: 1,
    });

    expect(
      otpDigestMatches({
        code: "123456",
        email: "  A@Example.COM ",
        purpose: "login",
        secret: OTP_SECRET,
        version: 1,
        digest,
      })
    ).toBe(true);
  });

  it("secret 缺失时失败关闭，不退化成无密钥哈希", () => {
    expect(() =>
      hashOtpCode({
        code: "123456",
        email: "a@example.com",
        purpose: "login",
        secret: "",
        version: 1,
      })
    ).toThrow();
  });

  it("摘要不泄露验证码", () => {
    const digest = hashOtpCode({
      code: "123456",
      email: "a@example.com",
      purpose: "login",
      secret: OTP_SECRET,
      version: 1,
    });

    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(digest).not.toContain("123456");
  });
});
