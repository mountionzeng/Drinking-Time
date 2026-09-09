import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  env: { resendApiKey: "test-key", resendFromEmail: "test@example.invalid" },
  issue: vi.fn(),
  verify: vi.fn(),
}));
vi.mock("../_core/env", () => ({ ENV: fixture.env }));
vi.mock("./accountIdentity", () => ({
  issueEmailOtp: fixture.issue,
  verifyEmailOtp: fixture.verify,
}));
import {
  requestMinigameEmailOtp,
  verifyMinigameEmailOtp,
} from "./minigameEmailOtp";
beforeEach(() => {
  fixture.env.resendApiKey = "test-key";
  fixture.issue
    .mockReset()
    .mockResolvedValue({ outcome: "issued", otp: { code: "123456" } });
  fixture.verify.mockReset();
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
