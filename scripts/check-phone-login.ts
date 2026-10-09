import "dotenv/config";
import {
  phoneSmsConfig,
  phoneSmsConfigured,
} from "../server/services/phoneSms";

// Read-only: do not send an SMS, create a user, print secrets or change config.
async function main() {
  const c = phoneSmsConfig();
  const checks: Record<string, boolean> = {
    PHONE_LOGIN_ENABLED: c.enabled,
    PHONE_OTP_DIGEST_SECRET: c.digestSecret.length >= 32,
    TENCENT_SMS_SECRET_ID: Boolean(c.secretId),
    TENCENT_SMS_SECRET_KEY: Boolean(c.secretKey),
    TENCENT_SMS_APP_ID: /^\d+$/.test(c.appId),
    TENCENT_SMS_SIGN_NAME: Boolean(c.signName),
    TENCENT_SMS_TEMPLATE_ID: /^\d+$/.test(c.templateId),
  };
  if (process.env.NODE_ENV === "production")
    checks.DATABASE_URL = Boolean(process.env.DATABASE_URL?.trim());
  const missing = Object.entries(checks)
    .filter(([, valid]) => !valid)
    .map(([key]) => key);
  console.log(
    JSON.stringify(
      { configured: phoneSmsConfigured(), missingOrDisabled: missing },
      null,
      2
    )
  );
  const originArg = process.argv[2];
  if (originArg) {
    const url = new URL(originArg);
    if (
      url.username ||
      url.password ||
      !["http:", "https:"].includes(url.protocol)
    )
      throw new Error("Invalid origin");
    const response = await fetch(`${url.origin}/api/auth/phone/config`, {
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok)
      throw new Error(
        `Configuration endpoint returned HTTP ${response.status}`
      );
    const config = await response.json();
    if (typeof config.configured !== "boolean")
      throw new Error("Unexpected configuration response");
    console.log(
      JSON.stringify({ origin: url.origin, configured: config.configured })
    );
    if (!config.configured) process.exitCode = 1;
  }
  if (missing.length) process.exitCode = 1;
  console.log(
    "No SMS sent. Provider approval, delivery and database migration still require separate verification."
  );
}
main().catch(() => {
  console.error(
    "Phone login check failed; check the target origin, network and server configuration."
  );
  process.exitCode = 1;
});
