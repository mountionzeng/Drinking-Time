import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UiLanguageContext, type UiLanguage } from "@/features/uiLanguage/UiLanguage";
import { ComputeBalanceBadge } from "./ComputeBalanceBadge";
import { useComputeBalance, type ComputeBalanceView } from "./useComputeBalance";

vi.mock("./useComputeBalance", () => ({ useComputeBalance: vi.fn() }));
vi.mock("./RechargeDialog", () => ({ RechargeDialog: () => null }));
vi.mock("./FeedbackDialog", () => ({ FeedbackDialog: () => null }));

const balance: ComputeBalanceView = {
  loading: false,
  failed: false,
  text: "4.00 算力",
  reservedText: null,
  localUnlimited: true,
  localCostText: "27.21 算力",
  unprovisioned: false,
  depleted: false,
  negative: false,
  refetch: () => {},
};

function render(language: UiLanguage = "zh", compact = true) {
  return renderToStaticMarkup(
    <UiLanguageContext.Provider value={{ language, setLanguage: () => {} }}>
      <ComputeBalanceBadge compact={compact} />
    </UiLanguageContext.Provider>
  );
}

describe("compute balance coverage", () => {
  beforeEach(() => vi.mocked(useComputeBalance).mockReturnValue(balance));

  it.each([true, false])("labels local usage as incomplete in compact=%s", compact => {
    const html = render("zh", compact);
    expect(html).toContain("历史已结算毛额 27.21 算力。含已退款原结算，预占与待核对项暂未计入。");
    expect(html).toContain('aria-label="本机开发不限额。历史已结算毛额 27.21 算力。含已退款原结算，预占与待核对项暂未计入。"');
    expect(html).not.toContain("累计使用");
  });

  it.each([
    ["en", "Lifetime gross settled usage: 27.21 Credits. Includes original charges later refunded. Holds and items under review are excluded."],
    ["fr", "Total brut réglé depuis l’origine : 27.21 Crédits. Inclut les débits remboursés par la suite. Les réservations et éléments en cours de vérification sont exclus."],
  ] as const)("keeps the coverage warning in %s", (language, warning) => {
    expect(render(language)).toContain(warning);
  });

  it("keeps metered balances and reservations separate", () => {
    vi.mocked(useComputeBalance).mockReturnValue({
      ...balance,
      localUnlimited: false,
      localCostText: null,
      reservedText: "1.00 算力",
    });
    const html = render();
    expect(html).toContain('aria-label="可用余额 4.00 算力"');
    expect(html).toContain("1.00 算力");
    expect(html).toContain("预占中");
    expect(html).not.toContain("历史已结算毛额");
  });

  it("does not present stale recorded amounts as current after a read failure", () => {
    vi.mocked(useComputeBalance).mockReturnValue({ ...balance, failed: true });
    const html = render();
    expect(html).toContain("余额没读到，点这里重试");
    expect(html).not.toContain("27.21");
  });
});
