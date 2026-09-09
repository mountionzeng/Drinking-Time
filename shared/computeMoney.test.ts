import { describe, expect, it } from "vitest";

import {
  MINOR_PER_YUAN,
  addMinor,
  assertMinorAmount,
  availableMinor,
  ceilYuanToMinor,
  formatCny,
  formatCnyBalance,
  fromYuan,
  parseYuanInput,
  subtractMinor,
  toYuan,
} from "./computeMoney";

describe("computeMoney", () => {
  it("以微元为唯一内部单位：1 元 = 1_000_000 微元", () => {
    expect(MINOR_PER_YUAN).toBe(1_000_000);
    expect(fromYuan(30)).toBe(30_000_000);
    expect(fromYuan(0)).toBe(0);
    expect(toYuan(30_000_000)).toBe(30);
  });

  it("绕开浮点累计误差：0.1 + 0.2 在微元里就是 300000", () => {
    expect(fromYuan(0.1) + fromYuan(0.2)).toBe(300_000);
    // 直接用浮点相加会得到 0.30000000000000004
    expect(fromYuan(0.1 + 0.2)).toBe(300_000);
  });

  it("保留比一分钱更细的精度", () => {
    expect(fromYuan(0.000_001)).toBe(1);
    expect(fromYuan(0.000_012_3)).toBe(12); // 四舍五入到微元
    expect(fromYuan(0.000_012_5)).toBe(13);
  });

  it("费用上界一律向上取整，宁可多预占也不少占", () => {
    expect(ceilYuanToMinor(0.000_000_1)).toBe(1);
    expect(ceilYuanToMinor(1.234_567_1)).toBe(1_234_568);
    expect(ceilYuanToMinor(2)).toBe(2_000_000);
    expect(ceilYuanToMinor(0)).toBe(0);
  });

  it("拒绝非法金额，而不是让它悄悄变成 NaN", () => {
    expect(() => assertMinorAmount(1.5)).toThrow();
    expect(() => assertMinorAmount(Number.NaN)).toThrow();
    expect(() => assertMinorAmount(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => assertMinorAmount(Number.MAX_SAFE_INTEGER + 1)).toThrow();
    expect(() => fromYuan(Number.NaN)).toThrow();
    expect(() => fromYuan(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => assertMinorAmount(-5)).not.toThrow(); // 账本里消费是负数
  });

  it("加减在超出安全整数范围时失败关闭", () => {
    expect(addMinor(1, 2)).toBe(3);
    expect(subtractMinor(30_000_000, 5_000_000)).toBe(25_000_000);
    expect(() => addMinor(Number.MAX_SAFE_INTEGER, 1)).toThrow();
    expect(() => subtractMinor(-Number.MAX_SAFE_INTEGER, 1)).toThrow();
  });

  it("可用余额 = 已入账余额 − 活动预占，且不会是负数以外的怪值", () => {
    expect(availableMinor({ postedMinor: 30_000_000, reservedMinor: 7_000_000 }))
      .toBe(23_000_000);
    expect(availableMinor({ postedMinor: 1_000_000, reservedMinor: 1_000_000 }))
      .toBe(0);
    // 预占超过余额本身就是账务异常，让它显式暴露而不是被 clamp 掩盖
    expect(availableMinor({ postedMinor: 1_000_000, reservedMinor: 3_000_000 }))
      .toBe(-2_000_000);
  });

  it("展示：至少两位小数，不足以表达时补到六位，绝不丢精度", () => {
    // 展示层可以自己再取整，但这个原语不许撒谎：用户看到「本次花了 ¥0.00」
    // 会以为没扣费，所以小于一分钱的金额也要如实显示。
    expect(formatCny(30_000_000)).toBe("¥30.00");
    expect(formatCny(0)).toBe("¥0.00");
    expect(formatCny(10_000)).toBe("¥0.01");
    expect(formatCny(1_234_500)).toBe("¥1.2345");
    expect(formatCny(12_300)).toBe("¥0.0123");
    expect(formatCny(1)).toBe("¥0.000001");
    expect(formatCny(-1_500_000)).toBe("-¥1.50");
    expect(formatCny(-1)).toBe("-¥0.000001");
  });

  it("人工输入只接受最多 6 位小数的合法金额", () => {
    expect(parseYuanInput("30")).toBe(30_000_000);
    expect(parseYuanInput("30.00")).toBe(30_000_000);
    expect(parseYuanInput(" 1.234567 ")).toBe(1_234_567);
    expect(parseYuanInput("¥30")).toBe(30_000_000);
    expect(parseYuanInput("1.2345678")).toBeNull(); // 超过 6 位小数
    expect(parseYuanInput("abc")).toBeNull();
    expect(parseYuanInput("")).toBeNull();
    expect(parseYuanInput("-5")).toBeNull(); // 申请/发卡金额不接受负数
    expect(parseYuanInput("1e6")).toBeNull();
  });
});

describe("formatCnyBalance", () => {
  it("固定两位小数", () => {
    expect(formatCnyBalance(30 * MINOR_PER_YUAN)).toBe("¥30.00");
    expect(formatCnyBalance(fromYuan(1.5))).toBe("¥1.50");
    expect(formatCnyBalance(0)).toBe("¥0.00");
  });

  // 余额只能少显示不能多显示：显示 ¥0.41 却花不出去，比显示 ¥0.40 更伤。
  it("向下取整，绝不把余额显示得比实际多", () => {
    expect(formatCnyBalance(fromYuan(0.409))).toBe("¥0.40");
    // 409_999 微元差一微元不到 0.41，就得显示 0.40
    expect(formatCnyBalance(409_999)).toBe("¥0.40");
    expect(formatCnyBalance(fromYuan(9.999))).toBe("¥9.99");
  });

  // 有一点点钱不能显示成 ¥0.00 之外的东西，但也不能假装是 0 之上——
  // 这里就是老实的 ¥0.00，配合界面上「余额已用完」的判断由 availableMinor 决定。
  it("不足一分显示为 ¥0.00", () => {
    expect(formatCnyBalance(1)).toBe("¥0.00");
    expect(formatCnyBalance(fromYuan(0.009))).toBe("¥0.00");
  });

  // 账务异常时窟窿宁可显示得更大：-0.001 → -0.01，方向同样保守。
  it("负数同样向下取整", () => {
    expect(formatCnyBalance(fromYuan(-0.001))).toBe("-¥0.01");
    expect(formatCnyBalance(-2 * MINOR_PER_YUAN)).toBe("-¥2.00");
  });
});
