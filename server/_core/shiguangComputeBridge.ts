import { Router, json } from "express";
import { createHash } from "node:crypto";
import { z } from "zod";
import { hasValidBridgeSignature } from "./shiguangBridgeSignature";
import { getAccountBalance, listUserBillingStatementSources, reserveForOperation, settleOperation } from "../services/computeLedger";
import { findBillingOperation, type BillingStatementCursor, type BillingStatementKind, type BillingStatementSourceRow } from "../repositories/computeLedger";
import { assertMinorAmount, COMPUTE_UNITS_PER_YUAN } from "../../shared/computeMoney";

type Dependencies = {
  enabled: boolean;
  secret: string;
  ready: () => Promise<boolean>;
  claimNonce: (timestamp: string, nonce: string, now: number) => Promise<boolean>;
  resolve: (subject: string) => Promise<number>;
  allow: (subject: string) => Promise<boolean>;
};
const identity = z.object({ subject: z.string().regex(/^shiguang:[0-9a-f]{64}$/) }).strict();
const operation = identity.extend({
  operationId: z.string().min(1).max(160),
});
const reserve = operation.extend({
  operationType: z.enum(["chatInterview", "organizeMemory", "generateBiography", "storyImages", "storyAudio"]),
  requestHash: z.string().regex(/^[0-9a-f]{64}$/),
  maxCostMinor: z.number().int().positive().max(1_000_000_000),
});
const settle = operation.extend({
  outcome: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("succeeded"), verifiedCostMinor: z.number().int().nonnegative().max(1_000_000_000) }).strict(),
    z.object({ kind: z.literal("charged_failure"), verifiedCostMinor: z.number().int().nonnegative().max(1_000_000_000) }).strict(),
    z.object({ kind: z.literal("not_charged_failure") }).strict(),
    z.object({ kind: z.literal("submission_unknown") }).strict(),
  ]),
});
const STATEMENT_DEFAULT_LIMIT = 20;
const STATEMENT_MAX_LIMIT = 50;
const statementQuery = identity.extend({
  limit: z.number().int().min(1).max(STATEMENT_MAX_LIMIT).optional(),
  cursor: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/).optional(),
}).strict();
const STATEMENT_KINDS = new Set<BillingStatementKind>(["reserve", "settle", "release"]);
const STATEMENT_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function decodeStatementCursor(value: string): BillingStatementCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (Object.keys(record).length !== 3) return null;
    const { t, k, id } = record;
    if (typeof t !== "string" || !STATEMENT_TIME.test(t)) return null;
    if (typeof k !== "string" || !STATEMENT_KINDS.has(k as BillingStatementKind)) return null;
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) return null;
    const occurredAt = new Date(t);
    if (Number.isNaN(occurredAt.getTime()) || occurredAt.toISOString() !== t) return null;
    return { occurredAt, kind: k as BillingStatementKind, id };
  } catch {
    return null;
  }
}

function encodeStatementCursor(row: BillingStatementSourceRow): string {
  return Buffer.from(JSON.stringify({
    t: row.occurredAt.toISOString(), k: row.kind, id: row.id,
  }), "utf8").toString("base64url");
}

/** Public operation labels only. Free text could be a prompt, so it never passes through. */
function publicOperationType(value: string): string {
  return /^[A-Za-z][A-Za-z0-9._-]{0,63}$/.test(value) ? value : "other";
}

function publicStatementStatus(row: BillingStatementSourceRow): "reserved" | "processing" | "reconciliation" | "settled" | "released" | "exception" {
  if (row.kind === "reserve") {
    if (row.status === "submitted") return "processing";
    if (row.status === "submission_unknown") return "reconciliation";
    return "reserved";
  }
  if (row.kind === "release") return "released";
  return row.status === "exception" ? "exception" : "settled";
}

function projectStatement(rows: BillingStatementSourceRow[], limit: number) {
  const page = rows.slice(0, limit);
  const items = [];
  for (const row of page) {
    const amountMicros = row.amountMinor * COMPUTE_UNITS_PER_YUAN;
    const held = row.kind !== "settle";
    if (!Number.isSafeInteger(amountMicros) || (held ? amountMicros < 0 : amountMicros > 0)) return null;
    items.push({
      occurredAt: row.occurredAt.toISOString(),
      kind: row.kind,
      type: publicOperationType(row.operationType),
      status: publicStatementStatus(row),
      amountMicros,
    });
  }
  return {
    version: 1 as const,
    unit: "compute" as const,
    items,
    nextCursor: rows.length > limit ? encodeStatementCursor(page[page.length - 1]!) : null,
  };
}
function operationKey(userId: number, id: string) {
  return "shiguang:" + userId + ":" + createHash("sha256").update(id).digest("hex");
}

/**
 * These endpoints accept server-signed cloud-function requests only. The public
 * mobile entrypoint exposes balance and the read-only statement, never
 * reserve/settle or caller-set costs. Account resolution is shared with
 * desktop pairing and email account binding.
 */
export function createShiguangComputeBridgeRouter(deps: Dependencies) {
  const router = Router();
  router.use("/compute", json({ limit: "8kb" }));
  router.post("/compute/:action", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      if (!deps.enabled || deps.secret.length < 32 || !await deps.ready())
        return res.status(503).json({ error: "compute_unavailable" });
      const now = Date.now();
      if (!hasValidBridgeSignature(req, deps.secret, now))
        return res.status(401).json({ error: "invalid_bridge_signature" });
      if (!await deps.claimNonce(req.header("x-shiguang-timestamp")!, req.header("x-shiguang-nonce")!, now))
        return res.status(401).json({ error: "replayed_request" });
      const schema = req.params.action === "balance" ? identity
        : req.params.action === "statement" ? statementQuery
        : req.params.action === "reserve" ? reserve : req.params.action === "settle" ? settle : null;
      if (!schema) return res.status(404).json({ error: "unknown_action" });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
      if (!await deps.allow(parsed.data.subject)) return res.status(429).json({ error: "rate_limited" });
      const userId = await deps.resolve(parsed.data.subject);
      if (req.params.action === "statement") {
        const data = statementQuery.parse(parsed.data);
        const cursor = data.cursor === undefined ? null : decodeStatementCursor(data.cursor);
        if (data.cursor !== undefined && !cursor) return res.status(400).json({ error: "invalid_input" });
        const limit = data.limit ?? STATEMENT_DEFAULT_LIMIT;
        const rows = await listUserBillingStatementSources({ userId, limit, cursor });
        const body = projectStatement(rows, limit);
        if (!body) return res.status(503).json({ error: "compute_reconciliation_required" });
        return res.json(body);
      }
      if (req.params.action === "reserve") {
        const data = reserve.parse(parsed.data);
        const result = await reserveForOperation({
          ...data, userId, operationId: operationKey(userId, data.operationId),
          operationType: "shiguang." + data.operationType,
        });
        // No currency amounts are part of the mobile public protocol.
        return res.json({ outcome: result.outcome, ...("status" in result ? { status: result.status } : {}) });
      }
      if (req.params.action === "settle") {
        const data = settle.parse(parsed.data);
        const key = operationKey(userId, data.operationId);
        const existing = await findBillingOperation(key);
        if (!existing || existing.userId !== userId) return res.status(404).json({ error: "operation_not_found" });
        const result = await settleOperation({ operationId: key, outcome: data.outcome });
        return res.json({ outcome: result.outcome });
      }
      const balance = await getAccountBalance(userId);
      const amounts = [balance.availableMinor, balance.reservedMinor, balance.lifetimeSpentMinor]
        .map(value => assertMinorAmount(value * COMPUTE_UNITS_PER_YUAN));
      if (amounts.some(value => value < 0)) return res.status(503).json({ error: "compute_reconciliation_required" });
      return res.json({
        version: 1, unit: "compute",
        availableMicros: amounts[0], reservedMicros: amounts[1], spentMicros: amounts[2],
      });
    } catch {
      return res.status(503).json({ error: "compute_unavailable" });
    }
  });
  return router;
}
