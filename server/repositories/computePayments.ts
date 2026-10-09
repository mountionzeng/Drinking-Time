import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  computePaymentOrders,
  creditAccounts,
  creditLedgerEntries,
} from "../../drizzle/schema";
import { getDb } from "./runtime";

const channel = z.enum(["wechat", "alipay"]);
const amountFen = z.number().int().positive().max(100_000_000);
const merchantId = z.string().trim().min(1).max(64);
const orderInput = z
  .object({
    userId: z.number().int().positive(),
    requestId: z.string().uuid(),
    channel,
    merchantId,
    amountFen,
    creditMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

export const paymentReceiptSchema = z
  .object({
    orderId: z.string().uuid(),
    channel,
    merchantId,
    amountFen,
    currency: z.literal("CNY"),
    providerTransactionId: z.string().trim().min(1).max(128),
    paidAt: z.date(),
  })
  .strict();
export type PaymentReceipt = z.infer<typeof paymentReceiptSchema>;

async function paymentDatabase() {
  // Never silently fall back to the local JSON store for real money.
  const db = await getDb();
  if (!db) throw new Error("PAYMENTS_REQUIRE_MYSQL");
  return db;
}

/** Internal only: amount and credit must come from a server-owned approved offer. */
export async function createComputePaymentOrder(
  raw: z.input<typeof orderInput>
) {
  const input = orderInput.parse(raw);
  const db = await paymentDatabase();
  const orderId = randomUUID();
  await db
    .insert(computePaymentOrders)
    .values({ ...input, orderId })
    .onDuplicateKeyUpdate({ set: { requestId: input.requestId } });
  const [order] = await db
    .select()
    .from(computePaymentOrders)
    .where(
      and(
        eq(computePaymentOrders.userId, input.userId),
        eq(computePaymentOrders.requestId, input.requestId)
      )
    )
    .limit(1);
  if (
    !order ||
    order.channel !== input.channel ||
    order.merchantId !== input.merchantId ||
    order.amountFen !== input.amountFen ||
    order.creditMinor !== input.creditMinor
  ) {
    throw new Error("PAYMENT_REQUEST_CONFLICT");
  }
  return order;
}

export async function getOwnComputePaymentOrder(
  userId: number,
  orderId: string
) {
  const db = await paymentDatabase();
  const [order] = await db
    .select()
    .from(computePaymentOrders)
    .where(
      and(
        eq(computePaymentOrders.userId, userId),
        eq(computePaymentOrders.orderId, orderId)
      )
    )
    .limit(1);
  if (!order) return null;
  // Do not expose merchant credentials or provider transaction identifiers.
  return {
    orderId: order.orderId,
    status: order.status,
    channel: order.channel,
    amountFen: order.amountFen,
    creditMinor: order.creditMinor,
    createdAt: order.createdAt,
    paidAt: order.paidAt,
  };
}

/**
 * Internal settlement boundary. Call ONLY after authenticating a successful
 * provider callback or server-to-server query; never pass browser assertions.
 * No HTTP callback is mounted until a real signature-verifying adapter exists.
 */
export async function settleComputePayment(raw: PaymentReceipt) {
  const receipt = paymentReceiptSchema.parse(raw);
  const db = await paymentDatabase();
  return db.transaction(async tx => {
    const [order] = await tx
      .select()
      .from(computePaymentOrders)
      .where(eq(computePaymentOrders.orderId, receipt.orderId))
      .for("update")
      .limit(1);
    if (!order) throw new Error("PAYMENT_ORDER_NOT_FOUND");
    if (
      order.channel !== receipt.channel ||
      order.merchantId !== receipt.merchantId ||
      order.currency !== receipt.currency ||
      order.amountFen !== receipt.amountFen
    ) {
      throw new Error("PAYMENT_RECEIPT_MISMATCH");
    }
    if (order.status === "paid") {
      if (order.providerTransactionId !== receipt.providerTransactionId) {
        throw new Error("PAYMENT_TRANSACTION_CONFLICT");
      }
      return { outcome: "already_paid" as const };
    }
    if (!Number.isSafeInteger(order.creditMinor) || order.creditMinor <= 0) {
      throw new Error("PAYMENT_CREDIT_INVALID");
    }
    await tx
      .insert(creditAccounts)
      .values({ userId: order.userId })
      .onDuplicateKeyUpdate({ set: { userId: order.userId } });
    const [account] = await tx
      .select()
      .from(creditAccounts)
      .where(eq(creditAccounts.userId, order.userId))
      .for("update")
      .limit(1);
    const nextBalance =
      Number(account.balanceMinor) + Number(order.creditMinor);
    if (!Number.isSafeInteger(nextBalance))
      throw new Error("PAYMENT_BALANCE_OVERFLOW");
    await tx.insert(creditLedgerEntries).values({
      userId: order.userId,
      entryType: "purchase",
      amountMinor: order.creditMinor,
      idempotencyKey: `purchase:${order.orderId}`,
      reason: "购买算力",
    });
    await tx
      .update(creditAccounts)
      .set({
        balanceMinor: nextBalance,
        accessEnabledAt: account.accessEnabledAt ?? new Date(),
      })
      .where(eq(creditAccounts.userId, order.userId));
    // A reused provider transaction fails its unique index and rolls back ALL writes.
    await tx
      .update(computePaymentOrders)
      .set({
        status: "paid",
        providerTransactionId: receipt.providerTransactionId,
        paidAt: receipt.paidAt,
      })
      .where(eq(computePaymentOrders.orderId, order.orderId));
    return { outcome: "paid" as const };
  });
}
