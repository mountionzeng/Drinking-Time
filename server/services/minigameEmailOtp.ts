import { ENV } from "../_core/env";
import { issueEmailOtp, verifyEmailOtp, issueMinigameLinkChallenge, allowMinigameEmailOtpSend } from "./accountIdentity";

export async function requestMinigameLinkEmailOtp(user: { id: number; sessionVersion: number }, email: string, requestIp: string) {
  if (!ENV.resendApiKey || !ENV.resendFromEmail || ENV.otpDigestSecret.length < 32) return 'unavailable' as const;
  if (!await allowMinigameEmailOtpSend(email, requestIp)) return 'rate_limited' as const;
  const { code } = await issueMinigameLinkChallenge({ userId: user.id,
    sessionVersion: user.sessionVersion, email, secret: ENV.otpDigestSecret });
  return sendEmailCode(email, code, true);
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
  return sendEmailCode(email, issued.otp.code, false);
}

async function sendEmailCode(email: string, code: string, linking: boolean): Promise<'sent' | 'unavailable'> {
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
        subject: linking ? '碎碎念关联邮箱确认' : "碎碎念登录验证码",
        text: linking
          ? `你正在小游戏中将当前微信与此邮箱关联。验证码：${code}\n\n确认后微信可访问此邮箱账号的故事。10 分钟内有效。如果不是你本人操作，请忽略。请勿向他人提供验证码。`
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
