import { expect, it, vi } from "vitest";
import { checkReviewedImageBalance } from "./providerImageBalance";

it.each([
  ["0", "insufficient"],
  ["0.01", "insufficient"],
  ["1.23", "sufficient"],
  [null, "unavailable"],
  ["", "unavailable"],
])(
  "interprets only a reported numeric balance (%s)",
  async (balance, expected) => {
    const read = vi
      .fn()
      .mockResolvedValue(Response.json({ data: { balance } }));
    expect(
      await checkReviewedImageBalance("fixture-key", "https://api.302.ai", read)
    ).toBe(expected);
    expect(read.mock.calls[0][0].href).toBe(
      "https://api.302.ai/dashboard/balance"
    );
    expect(read.mock.calls[0][1]).toMatchObject({
      redirect: "error",
      headers: { Authorization: "Bearer fixture-key" },
    });
  }
);

it("keeps an unreadable balance distinct from insufficient credit", async () => {
  const read = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 403 }))
    .mockRejectedValueOnce(new Error("timeout"));
  for (let i = 0; i < 2; i++)
    expect(
      await checkReviewedImageBalance("fixture", "https://api.302ai.cn", read)
    ).toBe("unavailable");
  expect(
    await checkReviewedImageBalance("fixture", "https://other.example", read)
  ).toBe("unavailable");
  expect(read).toHaveBeenCalledTimes(2);
});
