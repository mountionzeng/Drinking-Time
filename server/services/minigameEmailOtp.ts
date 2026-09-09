import { ENV } from "../_core/env";
import { issueEmailOtp, verifyEmailOtp } from "./accountIdentity";

/** Same email challenge authority as Web; no log fallback and no new account creation. */
export async function requestMinigameEmailOtp(
  email: string,
  requestIp: string
): Promise<"sent" | "rate_limited" | "unavailable"> {
  if (!ENV.resendApiKey || !ENV.resendFromEmail) return "unavailable";
  const issued = await issueEmailOtp({ email, purpose: "login", requestIp });
  if (issued.outcome === "rate_limited") return "rate_limited";
  if (issued.outcome !== "issued") return "unavailable";
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
        subject: "碎碎念登录验证码",
        text: `你的验证码是：${issued.otp.code}\n\n10 分钟内有效。请勿向他人提供验证码。`,
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
