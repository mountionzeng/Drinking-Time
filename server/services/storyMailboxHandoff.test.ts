import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ create: vi.fn(), qr: vi.fn() }));
vi.mock("../repositories/storyMailboxHandoff", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../repositories/storyMailboxHandoff")
  >()),
  createMailboxHandoff: mocks.create,
}));
vi.mock("./wechatLoginQr", () => ({
  wechatLoginQrConfigured: () => true,
  createWechatLoginQr: mocks.qr,
}));
import { mailboxHandoffCanCreate } from "../repositories/storyMailboxHandoff";
import { prepareWechatMailboxHandoff } from "./storyMailboxHandoff";
import { storyMailboxRouter } from "../routers/storyMailbox";
import type { TrpcContext } from "../_core/context";
const input = {
  storyId: 1,
  fingerprint: "a".repeat(64),
  requestId: "00000000-0000-4000-8000-000000000001",
};
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
describe("controlled native mailbox rollout", () => {
  it("keeps the global off switch authoritative", () => {
    vi.stubEnv("WECHAT_MAILBOX_ENABLED", "false");
    vi.stubEnv("WECHAT_MAILBOX_ALLOWED_USER_IDS", "1,133211");
    expect(mailboxHandoffCanCreate(1)).toBe(false);
  });
  it("preserves enabled public rollout when no list is configured", () => {
    vi.stubEnv("WECHAT_MAILBOX_ENABLED", "true");
    vi.stubEnv("WECHAT_MAILBOX_ALLOWED_USER_IDS", undefined);
    expect(mailboxHandoffCanCreate(2)).toBe(true);
    expect(mailboxHandoffCanCreate(0)).toBe(false);
  });
  it.each([
    "",
    " ",
    "1,",
    "1,invalid",
    "1,0",
    "1,1e3",
    "1,9007199254740992",
    "01",
  ])("fails closed for malformed list %j", configured => {
    vi.stubEnv("WECHAT_MAILBOX_ENABLED", "true");
    vi.stubEnv("WECHAT_MAILBOX_ALLOWED_USER_IDS", configured);
    expect(mailboxHandoffCanCreate(1)).toBe(false);
  });
  it("matches complete IDs and supports whitespace", () => {
    vi.stubEnv("WECHAT_MAILBOX_ENABLED", "true");
    vi.stubEnv("WECHAT_MAILBOX_ALLOWED_USER_IDS", " 1, 133211 ");
    expect(mailboxHandoffCanCreate(133211)).toBe(true);
    expect(mailboxHandoffCanCreate(13321)).toBe(false);
    expect(mailboxHandoffCanCreate(2)).toBe(false);
  });
  it("rejects creation on the server before capturing content or requesting a QR", async () => {
    vi.stubEnv("WECHAT_MAILBOX_ENABLED", "true");
    vi.stubEnv("WECHAT_MAILBOX_ALLOWED_USER_IDS", "1,133211");
    await expect(prepareWechatMailboxHandoff(2, input)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.qr).not.toHaveBeenCalled();
    const caller = storyMailboxRouter.createCaller({
      user: { id: 2 },
    } as TrpcContext);
    expect(await caller.nativeStatus()).toEqual({
      enabled: false,
      bound: false,
    });
    await expect(caller.nativeCreate(input)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("allows an approved account through the existing receipt flow", async () => {
    vi.stubEnv("WECHAT_MAILBOX_ENABLED", "true");
    vi.stubEnv("WECHAT_MAILBOX_ALLOWED_USER_IDS", "1,133211");
    const expiresAt = new Date("2026-11-14T00:00:00Z");
    mocks.create.mockResolvedValueOnce({
      id: "receipt",
      confirmed: false,
      expiresAt,
      code: "qr-code",
    });
    mocks.qr.mockResolvedValueOnce("data:image/png;base64,test");
    expect(await prepareWechatMailboxHandoff(133211, input)).toMatchObject({
      id: "receipt",
      confirmed: false,
      qrDataUrl: "data:image/png;base64,test",
    });
    expect(mocks.create).toHaveBeenCalledWith(133211, input);
    expect(mocks.qr).toHaveBeenCalledWith(
      "qr-code",
      expiresAt,
      undefined,
      "mailbox"
    );
  });
});
