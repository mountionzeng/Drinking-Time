import { ENV } from "../_core/env";
import { issueEmailOtp, verifyEmailOtp, issueMinigameLinkChallenge, allowMinigameEmailOtpSend, allowShiguangEmailOtpSend } from "./accountIdentity";

export async function requestMinigameLinkEmailOtp(user: { id: number; sessionVersion: number }, email: string, requestIp: string) {
  return requestLinkEmailOtp(user, email, requestIp, "minigame");
}

export async function requestShiguangLinkEmailOtp(user: { id: number; sessionVersion: number }, email: string, requestKey: string) {
  return requestLinkEmailOtp(user, email, requestKey, "shiguang");
}

async function requestLinkEmailOtp(
  user: { id: number; sessionVersion: number },
  email: string,
  requestKey: string,
  source: "minigame" | "shiguang",
) {
  if (!ENV.resendApiKey || !ENV.resendFromEmail || ENV.otpDigestSecret.length < 32) return 'unavailable' as const;
  const allowed = source === "shiguang"
    ? await allowShiguangEmailOtpSend(email, requestKey)
    : await allowMinigameEmailOtpSend(email, requestKey);
  if (!allowed) return 'rate_limited' as const;
  const { code } = await issueMinigameLinkChallenge({ userId: user.id,
    sessionVersion: user.sessionVersion, email, secret: ENV.otpDigestSecret,
    ...(source === "shiguang" ? { channel: "shiguang" as const } : {}) });
  return sendEmailCode(email, code, source);
}

/** Same email challenge authority as Web; no log fallback and no new account creation. */
export async function requestMinigameEmailOtp(
  email: string,
  requestIp: string
): Promise<"sent" | "rate_limited" | "unavailable"> {
  if (!ENV.resendApiKey || !ENV.resendFromEmail) return "unavailable";
  const issued = await issueEmailOtp({ email, purpose: "login", requestIp });
  if (issued.outcome === "rate_limited") return "rate_limited";
  if (issued.outcome !== "issued") return "unavailable";
  return sendEmailCode(email, issued.otp.code, "login");
}

async function sendEmailCode(
  email: string,
  code: string,
  mode: "login" | "minigame" | "shiguang",
): Promise<'sent' | 'unavailable'> {
  const linking = mode !== "login";
  const subject = mode === "shiguang" ? "拾光Ai 关联 Drinking Time 确认" :
    linking ? "碎碎念关联邮箱确认" : "碎碎念登录验证码";
  const sourceCopy = mode === "shiguang" ? "拾光Ai微信小程序" : "小游戏";
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
      headers: {
        Authorization: `Bearer ${ENV.resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: ENV.resendFromEmail,
        to: [email],
        subject,
        text: linking
          ? `你正在${sourceCopy}中将当前微信与此邮箱关联。验证码：${code}\n\n确认后微信可访问此邮箱账号的故事。10 分钟内有效。如果不是你本人操作，请忽略。请勿向他人提供验证码。`
          : `你的验证码是：${code}\n\n10 分钟内有效。请勿向他人提供验证码。`,
      }),
    });
    return response.ok ? "sent" : "unavailable";
  } catch {
    return "unavailable";
  }
}
export async function verifyMinigameEmailOtp(
  email: string,
  code: string,
  requestIp: string
) {
  const verified = await verifyEmailOtp({
    email,
    code,
    purpose: "login",
    requestIp,
  });
  return verified.outcome === "verified" ? verified.userId : null;
}
