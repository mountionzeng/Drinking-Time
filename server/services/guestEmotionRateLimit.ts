const DEVICE_WINDOW_MS = 60 * 60 * 1000;
const DEVICE_LIMIT = 12;
const IP_LIMIT = 30;

const requestTimes = new Map<string, number[]>();

function consumeBucket(
  key: string,
  limit: number,
  now: number
): { allowed: boolean; retryAfterSeconds: number } {
  const recent = (requestTimes.get(key) ?? []).filter(
    timestamp => now - timestamp < DEVICE_WINDOW_MS
  );
  if (recent.length >= limit) {
    const retryAt = recent[0] + DEVICE_WINDOW_MS;
    requestTimes.set(key, recent);
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((retryAt - now) / 1000)),
    };
  }
  recent.push(now);
  requestTimes.set(key, recent);
  return { allowed: true, retryAfterSeconds: 0 };
}

export function consumeGuestEmotionAllowance({
  ip,
  guestId,
  now = Date.now(),
}: {
  ip: string;
  guestId: string;
  now?: number;
}) {
  const normalizedIp = ip.trim() || "unknown";
  const device = consumeBucket(
    `device:${normalizedIp}:${guestId}`,
    DEVICE_LIMIT,
    now
  );
  if (!device.allowed) return device;
  return consumeBucket(`ip:${normalizedIp}`, IP_LIMIT, now);
}

export function resetGuestEmotionRateLimitForTesting() {
  requestTimes.clear();
}
