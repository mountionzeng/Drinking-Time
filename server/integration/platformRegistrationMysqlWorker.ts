import { ENV } from "../_core/env";
import {
  beginPlatformRegistration,
  completePlatformRegistration,
  sendPlatformRegistrationCode,
} from "../services/platformRegistration";

ENV.otpDigestSecret = process.env.OTP_DIGEST_SECRET || ENV.otpDigestSecret;
ENV.accountAutoIdentityResolution = false;
ENV.isProduction = false;

const input = JSON.parse(Buffer.from(process.argv[2], "base64url").toString("utf8")) as {
  op: "issue" | "complete";
  openId?: string;
  email?: string;
  cookie?: string;
  code?: string;
  now?: number;
  failGrant?: boolean;
  startAtMs?: number;
};

const startAtMs = input.startAtMs;
if (startAtMs && startAtMs > Date.now()) {
  await new Promise(resolve => setTimeout(resolve, startAtMs - Date.now()));
}

const now = input.now ?? Date.now();
let result: unknown;
if (input.op === "issue") {
  const started = await beginPlatformRegistration({
    openId: input.openId || "platform:mysql",
    name: "平台",
    loginMethod: "platform",
    now,
  });
  if ("error" in started) result = started;
  else {
    let code = "";
    const sent = await sendPlatformRegistrationCode({
      cookie: started.cookieValue,
      channel: "email",
      subject: input.email,
      requestIp: "203.0.113.40",
      now,
      deliver: async (_channel, _subject, issued) => {
        code = issued;
      },
    });
    result = { ...sent, cookie: started.cookieValue, code };
  }
} else {
  try {
    result = await completePlatformRegistration({
      cookie: input.cookie,
      channel: "email",
      subject: input.email,
      code: input.code,
      requestIp: "203.0.113.40",
      now,
      grant: input.failGrant ? async () => {
        throw new Error("ledger_unavailable");
      } : undefined,
    });
  } catch (error) {
    result = { threw: error instanceof Error ? error.message : "unknown" };
  }
}

process.stdout.write(`MYSQL_WORKER_RESULT:${JSON.stringify(result)}\n`, () => process.exit(0));
