import { describe, expect, it } from "vitest";

import {
  DEFAULT_YUAN_PER_1K_TOKENS,
  resolveTextPrice,
  textPriceEnvKeys,
} from "./textComputePricing";

describe("textPriceEnvKeys", () => {
  it("把供应商和模型名折成可写进 .env 的形状", () => {
    expect(
      textPriceEnvKeys({ provider: "openai-next", model: "gpt-5.6-terra" })
    ).toEqual({
      modelKey: "TEXT_PRICE_OPENAI_NEXT_GPT_5_6_TERRA_PER_1K_YUAN",
      providerKey: "TEXT_PRICE_OPENAI_NEXT_PER_1K_YUAN",
    });
  });

  it("没给模型时只有供应商键", () => {
    expect(textPriceEnvKeys({ provider: "302" })).toEqual({
      modelKey: null,
      providerKey: "TEXT_PRICE_302_PER_1K_YUAN",
    });
  });
});

describe("resolveTextPrice", () => {
  // 这条是这个模块存在的理由：两家单价不同，就必须各按各的算。
  it("同一次调用落在不同供应商，按各自的单价", () => {
    const env = {
      TEXT_PRICE_OPENAI_NEXT_PER_1K_YUAN: "0.03",
      TEXT_PRICE_302_PER_1K_YUAN: "0.008",
    };
    expect(resolveTextPrice({ provider: "openai-next", env }).yuanPer1kTokens).toBe(
      0.03
    );
    expect(resolveTextPrice({ provider: "302", env }).yuanPer1kTokens).toBe(
      0.008
    );
  });

  // 同一家的不同档位价差可以到十几倍，按供应商拉平等于给贵模型打折。
  it("模型专属价优先于供应商默认价", () => {
    const env = {
      TEXT_PRICE_302_PER_1K_YUAN: "0.008",
      TEXT_PRICE_302_CLAUDE_OPUS_4_7_PER_1K_YUAN: "0.12",
    };
    const resolved = resolveTextPrice({
      provider: "302",
      model: "claude-opus-4-7",
      env,
    });
    expect(resolved.yuanPer1kTokens).toBe(0.12);
    expect(resolved.source).toBe("TEXT_PRICE_302_CLAUDE_OPUS_4_7_PER_1K_YUAN");
  });

  it("模型没单独定价时回落到供应商默认价，仍算「已定价」", () => {
    const env = { TEXT_PRICE_302_PER_1K_YUAN: "0.008" };
    const resolved = resolveTextPrice({
      provider: "302",
      model: "某个没配价的模型",
      env,
    });
    expect(resolved.yuanPer1kTokens).toBe(0.008);
    expect(resolved.priced).toBe(true);
  });

  // 没配价时功能不能中断，但必须让调用方知道这笔账对不了。
  it("完全没配价时走兜底，并标记为未定价", () => {
    const resolved = resolveTextPrice({ provider: "某家新供应商", env: {} });
    expect(resolved.yuanPer1kTokens).toBe(DEFAULT_YUAN_PER_1K_TOKENS);
    expect(resolved.priced).toBe(false);
    expect(resolved.source).toBeNull();
  });

  // 配错值不能变成「免费」或者负数扣款，一律当没配。
  it("非正数或写坏的值一律当作没配", () => {
    for (const bad of ["0", "-1", "免费", "", "abc"]) {
      const resolved = resolveTextPrice({
        provider: "302",
        env: { TEXT_PRICE_302_PER_1K_YUAN: bad },
      });
      expect(resolved.priced).toBe(false);
      expect(resolved.yuanPer1kTokens).toBe(DEFAULT_YUAN_PER_1K_TOKENS);
    }
  });
});
