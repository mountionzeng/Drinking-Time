import axios from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeLoginPhone } from "../../shared/phoneLogin";
import {
  resetMemoryStateForTesting,
  memoryState,
} from "../repositories/runtime";
import { getLoginIdentity, getUserById, upsertUser } from "../db";
import { requestPhoneLoginCode, verifyPhoneLoginCode } from "./phoneLogin";
import { phoneSmsConfigured, sendPhoneLoginSms } from "./phoneSms";
import * as security from "./accountSecurity";

const phone = "+8613800000000";
function configure() {
  for (const [key, value] of Object.entries({
    PHONE_LOGIN_ENABLED: "true",
    TENCENT_SMS_SECRET_ID: "test-id",
    TENCENT_SMS_SECRET_KEY: "test-key",
    TENCENT_SMS_APP_ID: "1400000000",
    TENCENT_SMS_SIGN_NAME: "拾光",
    TENCENT_SMS_TEMPLATE_ID: "123456",
    PHONE_OTP_DIGEST_SECRET: "test-phone-otp-secret-at-least-32-characters",
  }))
    vi.stubEnv(key, value);
}
function accepted(payload: string) {
  return {
    data: {
      Response: {
        SendStatusSet: [
          { Code: "Ok", PhoneNumber: JSON.parse(payload).PhoneNumberSet[0] },
        ],
      },
    },
  };
}
function codeSent() {
  return JSON.parse(String(vi.mocked(axios.post).mock.calls.at(-1)![1]))
    .TemplateParamSet[0] as string;
}
beforeEach(() => {
  resetMemoryStateForTesting();
  configure();
  vi.spyOn(axios, "post").mockImplementation(async (_url, payload) =>
    accepted(String(payload))
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("phone OTP login", () => {
  it("normalizes the supported country without accepting foreign or malformed phones", () => {
    for (const value of ["13800000000", "+86 138 0000 0000", "138-0000-0000"])
      expect(normalizeLoginPhone(value)).toBe(phone);
    for (const value of [
      "+113800000000",
      "12800000000",
      null,
      {},
      "13800000000@a.com",
      "1".repeat(100),
    ])
      expect(normalizeLoginPhone(value)).toBeNull();
  });
  it("fails closed with no configured provider and never logs or returns a code", async () => {
    vi.stubEnv("PHONE_LOGIN_ENABLED", "false");
    expect(phoneSmsConfigured()).toBe(false);
    await expect(requestPhoneLoginCode(phone, "ip")).rejects.toMatchObject({
      code: "sms_not_configured",
    });
    expect(axios.post).not.toHaveBeenCalled();
    expect(memoryState.phoneLoginChallenges).toHaveLength(0);
    vi.stubEnv("PHONE_LOGIN_ENABLED", "true");
    vi.stubEnv("PHONE_OTP_DIGEST_SECRET", "short");
    expect(phoneSmsConfigured()).toBe(false);
  });
  it("creates only after proof, returns the same identity on later login, never grants or merges", async () => {
    await upsertUser({
      openId: "email:existing@example.com",
      email: "existing@example.com",
    });
    const result = await requestPhoneLoginCode(phone, "ip");
    expect(result).toEqual({ ok: true, retryAfterMs: 60000 });
    const code = codeSent();
    expect(memoryState.users).toHaveLength(1);
    expect(memoryState.phoneLoginChallenges[0].codeHash).not.toContain(code);
    const id = await verifyPhoneLoginCode("13800000000", code, "ip");
    expect(await getLoginIdentity("phone", phone)).toMatchObject({
      userId: id,
    });
    expect(await getUserById(id)).toMatchObject({
      loginMethod: "phone",
      email: null,
      role: "user",
    });
    expect(memoryState.users).toHaveLength(2);
    expect(memoryState.creditLedgerEntries).toHaveLength(0);
    expect(memoryState.stories).toHaveLength(0);
    await expect(verifyPhoneLoginCode(phone, code, "ip")).rejects.toMatchObject(
      { code: "invalid_or_expired" }
    );
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 61000);
    await requestPhoneLoginCode(phone, "ip");
    expect(await verifyPhoneLoginCode(phone, codeSent(), "ip")).toBe(id);
    expect(memoryState.users).toHaveLength(2);
  });
  it("only consumes a code once under parallel verification", async () => {
    await requestPhoneLoginCode(phone, "ip");
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        verifyPhoneLoginCode(phone, codeSent(), "ip")
      )
    );
    expect(
      results.filter(result => result.status === "fulfilled")
    ).toHaveLength(1);
    expect(memoryState.users).toHaveLength(1);
  });
  it("locks after five guesses and does not accept an expired code", async () => {
    await requestPhoneLoginCode(phone, "ip");
    const code = codeSent(),
      wrong = code === "000000" ? "000001" : "000000";
    for (let i = 0; i < 5; i++)
      await expect(
        verifyPhoneLoginCode(phone, wrong, "ip")
      ).rejects.toMatchObject({ status: 401 });
    await expect(verifyPhoneLoginCode(phone, code, "ip")).rejects.toMatchObject(
      { status: 401 }
    );
    expect(memoryState.phoneLoginChallenges[0].attemptCount).toBe(5);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 61000);
    await requestPhoneLoginCode(phone, "ip");
    vi.setSystemTime(Date.now() + 300001);
    await expect(
      verifyPhoneLoginCode(phone, codeSent(), "ip")
    ).rejects.toMatchObject({ status: 401 });
  });
  it("new sends invalidate old codes and another phone cannot use the proof", async () => {
    vi.spyOn(security, "generateOtpCode")
      .mockReturnValueOnce("123456")
      .mockReturnValueOnce("654321");
    await requestPhoneLoginCode(phone, "ip");
    const old = codeSent();
    await expect(
      verifyPhoneLoginCode("13900000000", old, "ip")
    ).rejects.toMatchObject({ status: 401 });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 61000);
    await requestPhoneLoginCode(phone, "ip");
    await expect(verifyPhoneLoginCode(phone, old, "ip")).rejects.toMatchObject({
      status: 401,
    });
    expect(memoryState.phoneLoginChallenges[0].consumedAt).toBeNull();
    expect(memoryState.phoneLoginChallenges[0].attemptCount).toBe(1);
    expect(await verifyPhoneLoginCode(phone, codeSent(), "ip")).toBeTypeOf(
      "number"
    );
  });
  it("throttles resends and simultaneous requests before charging for more SMS", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => requestPhoneLoginCode(phone, "ip"))
    );
    expect(
      results.filter(result => result.status === "fulfilled")
    ).toHaveLength(1);
    expect(axios.post).toHaveBeenCalledTimes(1);
    await expect(
      requestPhoneLoginCode("13800000000", "another-ip")
    ).rejects.toMatchObject({ status: 429, retryAfterMs: expect.any(Number) });
    expect(
      memoryState.accountRateLimits.find(
        row => row.scope === "phone:send:global"
      )?.attemptCount
    ).toBe(1);
  });
  it("does not activate a failed SMS or leak provider details", async () => {
    vi.mocked(axios.post).mockRejectedValue(
      new Error("secret-key and plaintext code")
    );
    await expect(requestPhoneLoginCode(phone, "ip")).rejects.toMatchObject({
      code: "sms_send_failed",
    });
    expect(memoryState.phoneLoginChallenges[0].sentAt).toBeNull();
    await expect(
      verifyPhoneLoginCode(phone, codeSent(), "ip")
    ).rejects.toMatchObject({ status: 401 });
    expect(axios.post).toHaveBeenCalledTimes(1);
  });
  it("requires the provider to accept exactly the requested phone and signs the actual payload", async () => {
    await sendPhoneLoginSms(phone, "123456");
    const [url, payload, config] = vi.mocked(axios.post).mock.calls[0];
    expect(url).toBe("https://sms.tencentcloudapi.com/");
    expect(JSON.parse(String(payload))).toMatchObject({
      PhoneNumberSet: [phone],
      TemplateParamSet: ["123456"],
      SmsSdkAppId: "1400000000",
    });
    expect(config).toMatchObject({
      timeout: 10000,
      maxRedirects: 0,
      headers: {
        "X-TC-Version": "2021-01-11",
        Authorization: expect.stringMatching(
          /^TC3-HMAC-SHA256 Credential=test-id\//
        ),
      },
    });
    for (const data of [
      {},
      { Response: { Error: { Code: "failure" } } },
      { Response: { SendStatusSet: [{ Code: "Ok", PhoneNumber: "wrong" }] } },
    ]) {
      vi.mocked(axios.post).mockResolvedValue({ data });
      await expect(sendPhoneLoginSms(phone, "123456")).rejects.toThrow(
        "sms_send_failed"
      );
    }
  });
});
