import { reconcileInferenceUsage, settleAcceptedInference } from "../_core/inferenceBilling";
import {
  getAccountBalance,
  grantCredit,
  reserveForOperation,
  settleOperation,
} from "../services/computeLedger";
import type { ProviderOutcome } from "../services/computeBilling";
import { getAccountStatement } from "../services/computeStatement";

type WorkerInput = {
  /** 让多个进程在同一个墙钟时刻同时冲进事务，制造真实竞争 */
  startAtMs?: number;
} & (
  | {
      action: "grant";
      userId: number;
      amountMinor: number;
      idempotencyKey: string;
      oncePerAccountPrefixes?: string[];
    }
  | {
      action: "reserve";
      userId: number;
      operationId: string;
      operationType: string;
      requestHash: string;
      maxCostMinor: number;
    }
  | { action: "settle"; operationId: string; outcome: ProviderOutcome }
  | { action: "inference-accepted"; operationId: string; totalTokens?: number }
  | { action: "inference-reconcile"; operationId: string; totalTokens?: number; loseReply?: boolean }
  | { action: "balance"; userId: number }
  | { action: "statement"; userId: number }
);

function decodeInput(value: string | undefined): WorkerInput {
  if (!value) throw new Error("compute ledger worker input is required");
  return JSON.parse(
    Buffer.from(value, "base64url").toString("utf8")
  ) as WorkerInput;
}

async function finish(payload: unknown, exitCode = 0): Promise<never> {
  await new Promise<void>((resolve, reject) => {
    process.stdout.write(
      `MYSQL_WORKER_RESULT:${JSON.stringify(payload)}\n`,
      error => (error ? reject(error) : resolve())
    );
  });
  process.exit(exitCode);
}

try {
  const input = decodeInput(process.argv[2]);
  if (input.startAtMs) {
    const delay = input.startAtMs - Date.now();
    if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
  }

  if (input.action === "grant") {
    await finish(
      await grantCredit({
        userId: input.userId,
        amountMinor: input.amountMinor,
        idempotencyKey: input.idempotencyKey,
        oncePerAccountPrefixes: input.oncePerAccountPrefixes,
      })
    );
  } else if (input.action === "reserve") {
    await finish(
      await reserveForOperation({
        userId: input.userId,
        operationId: input.operationId,
        operationType: input.operationType,
        requestHash: input.requestHash,
        maxCostMinor: input.maxCostMinor,
        quoteExpiresAt: null,
      })
    );
  } else if (input.action === "settle") {
    await finish(
      await settleOperation({
        operationId: input.operationId,
        outcome: input.outcome,
      })
    );
  } else if (input.action === "inference-accepted") {
    const usage = input.totalTokens === undefined ? undefined
      : { prompt_tokens: input.totalTokens, completion_tokens: 0, total_tokens: input.totalTokens };
    await finish(await settleAcceptedInference(input.operationId, {
      provider: "openai-next", providerLabel: "Fixture", model: "fixture-model", latencyMs: 0,
      priorFailures: [], result: { id: `receipt:${input.operationId}`, created: 0, model: "fixture-model", choices: [], usage },
    }, [{ provider: "openai-next", model: "fixture-model", yuanPer1kTokens: 2 }]));
  } else if (input.action === "inference-reconcile") {
    process.env.TEXT_PRICE_OPENAI_NEXT_PER_1K_YUAN = "999";
    const result = await reconcileInferenceUsage(input.operationId, input.totalTokens === undefined ? undefined : {
      provider: "openai-next", model: "fixture-model", receiptId: `receipt:${input.operationId}`, totalTokens: input.totalTokens,
    });
    if (input.loseReply && result?.outcome === "settled") process.exit(9);
    await finish(result);
  } else if (input.action === "statement") {
    await finish(await getAccountStatement(input.userId));
  } else {
    await finish(await getAccountBalance(input.userId));
  }
} catch (error) {
  const value = error as Error;
  await finish({ error: { name: value.name, message: value.message } }, 1);
}
