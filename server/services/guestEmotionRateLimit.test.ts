import { beforeEach, describe, expect, it } from "vitest";
import {
  consumeGuestEmotionAllowance,
  resetGuestEmotionRateLimitForTesting,
} from "./guestEmotionRateLimit";

describe("访客回信限频", () => {
  beforeEach(() => {
    resetGuestEmotionRateLimitForTesting();
  });

  it("同一设备一小时可以生成十二次，第十三次会被拦住", () => {
    for (let index = 0; index < 12; index += 1) {
      expect(
        consumeGuestEmotionAllowance({
          ip: "203.0.113.8",
          guestId: "guest-device-one",
          now: index * 1000,
        }).allowed
      ).toBe(true);
    }
    expect(
      consumeGuestEmotionAllowance({
        ip: "203.0.113.8",
        guestId: "guest-device-one",
        now: 12_000,
      })
    ).toMatchObject({
      allowed: false,
      retryAfterSeconds: 3588,
    });
  });

  it("窗口过去后允许继续生成", () => {
    for (let index = 0; index < 12; index += 1) {
      consumeGuestEmotionAllowance({
        ip: "203.0.113.9",
        guestId: "guest-device-two",
        now: index * 1000,
      });
    }
    expect(
      consumeGuestEmotionAllowance({
        ip: "203.0.113.9",
        guestId: "guest-device-two",
        now: 3_600_001,
      }).allowed
    ).toBe(true);
  });
});
