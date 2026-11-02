import { afterEach, expect, it, vi } from "vitest";
import sharp from "sharp";
import { createWechatLoginQr, wechatLoginQrConfigured } from "./wechatLoginQr";
const code = "A".repeat(28);
afterEach(() => vi.unstubAllEnvs());
it("requires an explicit flag and a configured HTTPS authority", () => {
  vi.stubEnv("WECHAT_LOGIN_QR_ENABLED", "");
  expect(wechatLoginQrConfigured()).toBe(false);
  vi.stubEnv("WECHAT_LOGIN_QR_ENABLED", "true");
  vi.stubEnv("SHIGUANG_STORY_AUTHORITY_URL", "http://unsafe.test");
  vi.stubEnv("SHIGUANG_STORY_AUTHORITY_SECRET", "s".repeat(32));
  expect(wechatLoginQrConfigured()).toBe(false);
  vi.stubEnv("SHIGUANG_STORY_AUTHORITY_URL", "https://authority.example.test");
  expect(wechatLoginQrConfigured()).toBe(true);
});
it("requests only the confirmation token and expiry; validates returned image bytes", async () => {
  const image = await sharp({
    create: { width: 360, height: 360, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  const request = vi
      .fn()
      .mockResolvedValue({ base64: image.toString("base64") }),
    expires = new Date(Date.now() + 120000);
  expect(await createWechatLoginQr(code, expires, request)).toMatch(
    /^data:image\/png;base64,/
  );
  expect(request.mock.calls[0].slice(0, 2)).toEqual([
    "/v1/web-login/qr",
    { code, expiresAt: expires.getTime() },
  ]);
  request.mockResolvedValue({
    base64: Buffer.from("<svg/>").toString("base64"),
  });
  await expect(createWechatLoginQr(code, expires, request)).rejects.toThrow();
});
it("never generates from an expired token or a public six-character code", async () => {
  const request = vi.fn();
  for (const [token, date] of [
    ["ABC234", Date.now() + 10000],
    [code, Date.now() - 1],
  ] as const)
    await expect(
      createWechatLoginQr(token, new Date(date), request)
    ).rejects.toThrow("request_invalid");
  expect(request).not.toHaveBeenCalled();
});
