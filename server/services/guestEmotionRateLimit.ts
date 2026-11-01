import { createHash } from "node:crypto";
import { consumePersistentRateLimit } from "../repositories/accounts";

/**
 * 访客回信（公开接口、调用付费大模型）的持久化限流。
 * - 计数存在 consumePersistentRateLimit 的持久化限流表里，进程重启不清零，也不再有内存表。
 * - IP / guestId 先 sha256 再作键；guestId 由客户端提供、不可信，IP 维度是主闸门。
 * - 全站每日上限兜底代理池轮换 IP。
 * - 限流存储异常时一律拒绝（调用方降级为模板回复），绝不放行大模型调用。
 */

const MINUTE = 60;
const DAY = 24 * 60 * 60;

function envInt(name: string, fallback: number) {
  const raw = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

export function guestEmotionLimits() {
  return {
    ipPerMinute: envInt("GUEST_EMOTION_IP_PER_MINUTE_LIMIT", 6),
    ipPerDay: envInt("GUEST_EMOTION_IP_DAILY_LIMIT", 60),
    guestPerDay: envInt("GUEST_EMOTION_GUEST_DAILY_LIMIT", 30),
    globalPerDay: envInt("GUEST_EMOTION_DAILY_GLOBAL_LIMIT", 2000),
  };
}

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export type GuestEmotionAllowance =
  | { allowed: true; retryAfterSeconds: 0 }
  | {
      allowed: false;
      retryAfterSeconds: number;
      reason:
        | "ip_minute"
        | "ip_day"
        | "guest_day"
        | "global_day"
        | "storage_unavailable";
    };

export async function consumeGuestEmotionAllowance({
  ip,
  guestId,
  now,
}: {
  ip: string;
  guestId: string;
  now?: Date;
}): Promise<GuestEmotionAllowance> {
  const limits = guestEmotionLimits();
  const ipKey = hash(`ip:${ip.trim() || "unknown"}`);
  const guestKey = hash(`guest:${guestId}`);
  // 顺序：先按 IP（避免单个请求方制造大量 guestId 行），全站计数放最后，被拦下的请求不占全站额度。
  const checks = [
    ["ip_minute", "guest-emotion:ip:minute", ipKey, MINUTE, limits.ipPerMinute],
    ["ip_day", "guest-emotion:ip:day", ipKey, DAY, limits.ipPerDay],
    ["guest_day", "guest-emotion:guest:day", guestKey, DAY, limits.guestPerDay],
    ["global_day", "guest-emotion:global:day", "all", DAY, limits.globalPerDay],
  ] as const;
  try {
    for (const [reason, scope, subject, windowSeconds, maxAttempts] of checks) {
      const result = await consumePersistentRateLimit({
        scope,
        subject,
        windowSeconds,
        maxAttempts,
        now,
      });
      if (!result.allowed) {
        return {
          allowed: false,
          reason,
          retryAfterSeconds: Math.max(1, Math.ceil(result.retryAfterMs / 1000)),
        };
      }
    }
  } catch {
    return { allowed: false, reason: "storage_unavailable", retryAfterSeconds: 60 };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}
