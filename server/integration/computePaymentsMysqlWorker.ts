import {
  createComputePaymentOrder,
  getOwnComputePaymentOrder,
  settleComputePayment,
} from "../repositories/computePayments";
import { getAccountStatement } from "../services/computeStatement";

type Input = { startAtMs?: number } & (
  | { action: "create"; input: Parameters<typeof createComputePaymentOrder>[0] }
  | {
      action: "settle";
      input: Omit<Parameters<typeof settleComputePayment>[0], "paidAt"> & {
        paidAt: string;
      };
    }
  | { action: "read"; userId: number; orderId: string }
  | { action: "statement"; userId: number }
);

const input = JSON.parse(
  Buffer.from(process.argv[2], "base64url").toString("utf8")
) as Input;
if (input.startAtMs && input.startAtMs > Date.now()) {
  await new Promise(resolve =>
    setTimeout(resolve, input.startAtMs! - Date.now())
  );
}
let result: unknown;
try {
  result =
    input.action === "create"
      ? await createComputePaymentOrder(input.input)
      : input.action === "statement"
        ? await getAccountStatement(input.userId)
        : input.action === "read"
          ? await getOwnComputePaymentOrder(input.userId, input.orderId)
          : await settleComputePayment({
              ...input.input,
              paidAt: new Date(input.input.paidAt),
            });
} catch (error) {
  result = { error: error instanceof Error ? error.message : "unknown" };
}
process.stdout.write(`MYSQL_WORKER_RESULT:${JSON.stringify(result)}\n`, () =>
  process.exit(0)
);
