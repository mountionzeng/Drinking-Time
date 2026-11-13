import { TRPCError } from "@trpc/server";
import {
  createMailboxHandoff,
  mailboxHandoffCanCreate,
} from "../repositories/storyMailboxHandoff";
import { createWechatLoginQr, wechatLoginQrConfigured } from "./wechatLoginQr";
export async function prepareWechatMailboxHandoff(
  userId: number,
  input: Parameters<typeof createMailboxHandoff>[1]
) {
  if (!mailboxHandoffCanCreate(userId) || !wechatLoginQrConfigured())
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "小程序接收尚未启用 / Mini-program receiving is not enabled",
    });
  const result = await createMailboxHandoff(userId, input);
  if (result.confirmed)
    return {
      id: result.id,
      confirmed: true,
      expiresAt: result.expiresAt.toISOString(),
      qrDataUrl: null,
    };
  const qrDataUrl = await createWechatLoginQr(
    result.code,
    result.expiresAt,
    undefined,
    "mailbox"
  );
  return {
    id: result.id,
    confirmed: false,
    expiresAt: result.expiresAt.toISOString(),
    qrDataUrl,
  };
}
