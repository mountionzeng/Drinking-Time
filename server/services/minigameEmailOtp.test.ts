import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  env: { resendApiKey: "test-key", resendFromEmail: "test@example.invalid", otpDigestSecret: 'test-only-binding-secret-at-least-32-long' },
  issue: vi.fn(),
  verify: vi.fn(),
  allow: vi.fn(),
  linkIssue: vi.fn(),
}));
vi.mock("../_core/env", () => ({ ENV: fixture.env }));
vi.mock("./accountIdentity", () => ({
  issueEmailOtp: fixture.issue,
  verifyEmailOtp: fixture.verify,
  issueMinigameLinkChallenge: fixture.linkIssue,
  allowMinigameEmailOtpSend: fixture.allow,
}));
import {
  requestMinigameEmailOtp,
  verifyMinigameEmailOtp,
  requestMinigameLinkEmailOtp,
} from "./minigameEmailOtp";
beforeEach(() => {
  fixture.env.resendApiKey = "test-key";
  fixture.issue
    .mockReset()
    .mockResolvedValue({ outcome: "issued", otp: { code: "123456" } });
  fixture.verify.mockReset();
  fixture.allow.mockReset().mockResolvedValue(true);
  fixture.linkIssue.mockReset().mockResolvedValue({ code: '123456' });
});
it('email binding sends a source-scoped challenge with a clear account-access warning', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetcher);
  expect(await requestMinigameLinkEmailOtp({ id: 9, sessionVersion: 2 }, 'old@example.invalid', 'ip')).toBe('sent');
  expect(fixture.linkIssue).toHaveBeenCalledWith({ userId: 9, sessionVersion: 2, email: 'old@example.invalid', secret: fixture.env.otpDigestSecret });
  expect(fixture.issue).not.toHaveBeenCalled();
  const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
  expect(body.subject).toBe('碎碎念关联邮箱确认');
  expect(body.text).toContain('微信可访问此邮箱账号的故事');
  fixture.allow.mockResolvedValue(false);
  expect(await requestMinigameLinkEmailOtp({ id: 9, sessionVersion: 2 }, 'old@example.invalid', 'ip')).toBe('rate_limited');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
afterEach(() => vi.unstubAllGlobals());
it("sends only after domain challenge issuance, with bounded server-only mail transport", async () => {
  const fetcher = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
  expect(await requestMinigameEmailOtp("old@example.invalid", "ip")).toBe(
    "sent"
  );
  expect(fixture.issue).toHaveBeenCalledWith({
    email: "old@example.invalid",
    purpose: "login",
    requestIp: "ip",
  });
  expect(fetcher).toHaveBeenCalledWith(
    "https://api.resend.com/emails",
    expect.objectContaining({
      redirect: "error",
      method: "POST",
      signal: expect.any(AbortSignal),
    })
  );
});
it("does not fake delivery or log codes when mail credentials are absent", async () => {
  fixture.env.resendApiKey = "";
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  expect(await requestMinigameEmailOtp("old@example.invalid", "ip")).toBe(
    "unavailable"
  );
  expect(fixture.issue).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
});
it("retains persistent rate limits and sanitizes transport failures", async () => {
  const fetcher = vi.fn(async () => {
    throw new Error("provider-secret");
  });
  vi.stubGlobal("fetch", fetcher);
  fixture.issue.mockResolvedValueOnce({ outcome: "rate_limited" });
  expect(await requestMinigameEmailOtp("old@example.invalid", "ip")).toBe(
    "rate_limited"
  );
  expect(fetcher).not.toHaveBeenCalled();
  expect(await requestMinigameEmailOtp("old@example.invalid", "ip")).toBe(
    "unavailable"
  );
});
it("only signs into a domain-verified existing user, never inventing a new account", async () => {
  fixture.verify
    .mockResolvedValueOnce({ outcome: "verified", userId: 7 })
    .mockResolvedValueOnce({ outcome: "verified", userId: null })
    .mockResolvedValueOnce({ outcome: "invalid" });
  expect(
    await verifyMinigameEmailOtp("old@example.invalid", "123456", "ip")
  ).toBe(7);
  expect(
    await verifyMinigameEmailOtp("new@example.invalid", "123456", "ip")
  ).toBeNull();
  expect(
    await verifyMinigameEmailOtp("old@example.invalid", "123456", "ip")
  ).toBeNull();
});
