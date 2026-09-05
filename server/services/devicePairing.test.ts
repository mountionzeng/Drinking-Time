import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ENV } from "../_core/env";
import { resetMemoryStateForTesting, upsertUser, getUserByOpenId } from "../db";
import {
  PAIRING_REDEEM_IP_LIMIT,
  PAIRING_TTL_MS,
  issuePairingCode,
  redeemPairingCode,
} from "./accountIdentity";
import { PAIRING_CODE_LENGTH, generatePairingCode } from "./accountSecurity";

beforeAll(() => {
  // 摘要 secret 缺失时服务会失败关闭，测试里显式给一个。
  ENV.otpDigestSecret = "test-pairing-digest-secret";
  ENV.otpDigestSecretVersion = 1;
});

async function makeUser(email: string): Promise<number> {
  const openId = `email:${email}`;
  await upsertUser({ openId, email, loginMethod: "email" });
  const user = await getUserByOpenId(openId);
  if (!user) throw new Error("测试用户创建失败");
  return user.id;
}

describe("设备配对码", () => {
  beforeEach(() => {
    resetMemoryStateForTesting();
  });

  it("配对后落在签发那个账号上", async () => {
    const userId = await makeUser("owner@example.com");
    const issued = await issuePairingCode({ userId });
    expect(issued.outcome).toBe("issued");
    if (issued.outcome !== "issued") return;

    const redeemed = await redeemPairingCode({
      code: issued.code,
      requestIp: "10.0.0.1",
    });
    expect(redeemed).toEqual({ outcome: "paired", userId });
  });

  it("一次性：同一个码兑换第二次就无效", async () => {
    const userId = await makeUser("once@example.com");
    const issued = await issuePairingCode({ userId });
    if (issued.outcome !== "issued") throw new Error("签发失败");

    await redeemPairingCode({ code: issued.code, requestIp: "10.0.0.1" });
    const again = await redeemPairingCode({
      code: issued.code,
      requestIp: "10.0.0.1",
    });
    expect(again).toEqual({ outcome: "invalid" });
  });

  it("重新签发会作废上一个码——旧码不能继续当钥匙", async () => {
    const userId = await makeUser("reissue@example.com");
    const first = await issuePairingCode({ userId });
    const second = await issuePairingCode({ userId });
    if (first.outcome !== "issued" || second.outcome !== "issued") {
      throw new Error("签发失败");
    }

    expect(
      await redeemPairingCode({ code: first.code, requestIp: "10.0.0.1" })
    ).toEqual({ outcome: "invalid" });
    expect(
      await redeemPairingCode({ code: second.code, requestIp: "10.0.0.1" })
    ).toEqual({ outcome: "paired", userId });
  });

  it("过期的码无效，且和不存在的码返回同一种失败", async () => {
    const userId = await makeUser("expired@example.com");
    const issued = await issuePairingCode({ userId });
    if (issued.outcome !== "issued") throw new Error("签发失败");

    const afterExpiry = new Date(Date.now() + PAIRING_TTL_MS + 1_000);
    const expired = await redeemPairingCode({
      code: issued.code,
      requestIp: "10.0.0.1",
      now: afterExpiry,
    });
    const missing = await redeemPairingCode({
      code: generatePairingCode(),
      requestIp: "10.0.0.2",
    });
    // 两者必须不可区分，否则「这个码存在但过期了」就是一条枚举信道
    expect(expired).toEqual({ outcome: "invalid" });
    expect(missing).toEqual(expired);
  });

  it("大小写和连字符都容错，方便手抄", async () => {
    const userId = await makeUser("sloppy@example.com");
    const issued = await issuePairingCode({ userId });
    if (issued.outcome !== "issued") throw new Error("签发失败");

    const messy = ` ${issued.code.toLowerCase().slice(0, 3)}-${issued.code
      .toLowerCase()
      .slice(3)} `;
    expect(
      await redeemPairingCode({ code: messy, requestIp: "10.0.0.1" })
    ).toEqual({ outcome: "paired", userId });
  });

  it("按来源地址限流：这是唯一挡爆破的东西", async () => {
    const userId = await makeUser("brute@example.com");
    const issued = await issuePairingCode({ userId });
    if (issued.outcome !== "issued") throw new Error("签发失败");

    for (let attempt = 0; attempt < PAIRING_REDEEM_IP_LIMIT.maxAttempts; attempt += 1) {
      await redeemPairingCode({
        code: generatePairingCode(),
        requestIp: "10.9.9.9",
      });
    }
    const blocked = await redeemPairingCode({
      code: issued.code,
      requestIp: "10.9.9.9",
    });
    expect(blocked.outcome).toBe("rate_limited");

    // 换一个来源仍然能正常兑换，说明限流没有误伤到码本身
    expect(
      await redeemPairingCode({ code: issued.code, requestIp: "10.0.0.1" })
    ).toEqual({ outcome: "paired", userId });
  });

  it("长度不对直接判无效，不消耗限流额度", async () => {
    const userId = await makeUser("short@example.com");
    const issued = await issuePairingCode({ userId });
    if (issued.outcome !== "issued") throw new Error("签发失败");

    for (let attempt = 0; attempt < PAIRING_REDEEM_IP_LIMIT.maxAttempts + 5; attempt += 1) {
      expect(
        await redeemPairingCode({ code: "AB", requestIp: "10.5.5.5" })
      ).toEqual({ outcome: "invalid" });
    }
    // 畸形输入没把正常用户挤下去
    expect(
      await redeemPairingCode({ code: issued.code, requestIp: "10.5.5.5" })
    ).toEqual({ outcome: "paired", userId });
  });

  it("码用的是无歧义字母表，长度固定", async () => {
    for (let sample = 0; sample < 200; sample += 1) {
      const code = generatePairingCode();
      expect(code).toHaveLength(PAIRING_CODE_LENGTH);
      // 不含 0 O 1 I L，也不含符号
      expect(code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]+$/);
    }
  });

  it("没有摘要 secret 时失败关闭，不退化成裸哈希", async () => {
    const userId = await makeUser("nosecret@example.com");
    const saved = ENV.otpDigestSecret;
    ENV.otpDigestSecret = "";
    try {
      expect(await issuePairingCode({ userId })).toEqual({
        outcome: "not_configured",
      });
      expect(
        await redeemPairingCode({ code: "ABCDEF", requestIp: "10.0.0.1" })
      ).toEqual({ outcome: "not_configured" });
    } finally {
      ENV.otpDigestSecret = saved;
    }
  });
});
