import { describe, expect, it } from "vitest";
import { computePaymentRouter } from "./routers/computePayment";
import type { TrpcContext } from "./_core/context";

const context = (user: TrpcContext["user"]) =>
  ({ user, req: { headers: {} }, res: {} }) as TrpcContext;
describe("compute payment admission", () => {
  it("requires authentication even for availability", async () => {
    const caller = computePaymentRouter.createCaller(context(null));
    await expect(caller.availability()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(caller.createOrder()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
  it("stays closed without a verified merchant adapter, including for administrators", async () => {
    for (const role of ["user", "admin"] as const) {
      const caller = computePaymentRouter.createCaller(
        context({ id: 1, role } as TrpcContext["user"])
      );
      await expect(caller.availability()).resolves.toMatchObject({
        available: false,
        plans: [
          {
            amountFen: 1990,
            computeUnits: 20,
            interval: "month",
            rollover: true,
          },
          {
            amountFen: 19900,
            computeUnits: 200,
            interval: "month",
            rollover: true,
          },
        ],
      });
      await expect(caller.createOrder()).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
    }
  });
});
