import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ComputeBalanceBadge } from "./ComputeBalanceBadge";
import { useComputeBalance, type ComputeBalanceView } from "./useComputeBalance";

vi.mock("./useComputeBalance", () => ({ useComputeBalance: vi.fn() }));
vi.mock("./RechargeDialog", () => ({ RechargeDialog: () => null }));
vi.mock("./FeedbackDialog", () => ({ FeedbackDialog: () => null }));

const balance: ComputeBalanceView = {
  loading: false, failed: false, text: "5.00 算力", reservedText: null,
  localUnlimited: true, localCostText: "38.45 算力", unprovisioned: false,
  depleted: false, negative: false, refetch: vi.fn(),
};

describe("compute balance badge", () => {
  it("labels the unlimited balance as gross historical settlement", () => {
    vi.mocked(useComputeBalance).mockReturnValue(balance);
    const html = renderToStaticMarkup(<ComputeBalanceBadge />);
    expect(html).toContain("历史已结算毛额 38.45 算力");
    expect(html).toContain("含已退款原结算，预占与待核对项暂未计入");
    expect(html).not.toContain("记录不完整");
  });

  it("keeps ordinary accounts on the available balance", () => {
    vi.mocked(useComputeBalance).mockReturnValue({ ...balance, localUnlimited: false });
    const html = renderToStaticMarkup(<ComputeBalanceBadge />);
    expect(html).toContain("可用余额 5.00 算力");
    expect(html).not.toContain("38.45");
  });
});
