import { describe, expect, it } from "vitest";
import { cardTitle } from "./storyAgentUtils";

describe("cardTitle", () => {
  it("preserves every existing non-empty card title exactly", () => {
    expect(
      cardTitle({
        title: "旧卡片标题…",
        content: "后来完全改写过的正文",
      })
    ).toBe("旧卡片标题…");
  });

  it("prefers a concrete trigger over clipping the start of a sentence", () => {
    expect(
      cardTitle({
        title: " ",
        trigger: "杯壁塌了三次",
        sourceQuote: "第一次拉坯时，杯壁在手里塌了三次",
        content: "第一次拉坯时，杯壁在手里塌了三次，我才学会放松手腕。",
      })
    ).toBe("杯壁塌了三次");
  });

  it("uses a complete grounded clause and never appends a truncation ellipsis", () => {
    const title = cardTitle({
      sourceQuote:
        "收音机旋钮松了，外婆用一根红线固定住刻度，午后的杂音才停下来。",
      content:
        "收音机旋钮松了，外婆用一根红线固定住刻度，午后的杂音才停下来。",
    });

    expect(title).toBe("外婆用一根红线固定住刻度");
    expect(title).not.toMatch(/…|\.\.\.$/);
  });

  it("keeps mixed-language phrases intact and rejects contact details", () => {
    expect(cardTitle({ trigger: "第一次 Demo 被拒" })).toBe(
      "第一次 Demo 被拒"
    );
    expect(
      cardTitle({
        trigger: `联系${["138", "0000", "0000"].join("")}`,
        content: " ",
      })
    ).toBe("故事素材");
  });
});
