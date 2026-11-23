import { createShiguangComputeBridgeRouter } from "./shiguangComputeBridge";
import { accountDatabaseReady, findWechatWalletOwner } from "../services/accountIdentity";
import { claimShiguangBridgeNonce } from "../repositories/shiguangBridgeNonces";
import { consumePersistentRateLimit } from "../repositories/accounts";
import { Router } from "express";

function readCanaryAllowlist(raw: string) {
  const pairs = new Map<string, number>();
  for (const entry of raw.split(",").filter(Boolean)) {
    const match = /^(shiguang:[0-9a-f]{64})=([1-9][0-9]*)$/.exec(entry.trim());
    if (!match || pairs.has(match[1]!) || !Number.isSafeInteger(Number(match[2]))) return new Map<string, number>();
    pairs.set(match[1]!, Number(match[2]));
  }
  return pairs;
}

export function shiguangComputeBridgeRoutes() {
  const router = Router();
  router.use(createShiguangComputeBridgeRouter({
    enabled: process.env.SHIGUANG_COMPUTE_ENABLED === "true",
    secret: process.env.SHIGUANG_BRIDGE_SECRET ?? "",
    ready: accountDatabaseReady,
    claimNonce: claimShiguangBridgeNonce,
    resolve: findWechatWalletOwner,
    allow: async subject => (await consumePersistentRateLimit({
      scope: "shiguang:compute", subject, windowSeconds: 60, maxAttempts: 120,
    })).allowed,
  }));
  const canaryKey = process.env.SHIGUANG_COMPUTE_CANARY_SIGNING_KEY ?? "";
  const canaryEnabled = process.env.SHIGUANG_COMPUTE_CANARY_ENABLED === "true" &&
    canaryKey.length >= 32 && canaryKey !== (process.env.SHIGUANG_BRIDGE_SECRET ?? "");
  const allowlist = readCanaryAllowlist(process.env.SHIGUANG_COMPUTE_CANARY_ACCOUNTS ?? "");
  router.use(createShiguangComputeBridgeRouter({
    enabled: canaryEnabled,
    secret: canaryKey,
    ready: accountDatabaseReady,
    claimNonce: claimShiguangBridgeNonce,
    resolve: findWechatWalletOwner,
    allow: async subject => (await consumePersistentRateLimit({
      scope: "shiguang:compute-canary", subject, windowSeconds: 60, maxAttempts: 120,
    })).allowed,
    canary: {
      acceptsNew: () => process.env.SHIGUANG_COMPUTE_CANARY_ACCEPT_NEW === "true",
      acceptsSettlement: () => process.env.SHIGUANG_COMPUTE_CANARY_SETTLEMENT_ENABLED === "true",
      admits: (subject, userId) => allowlist.get(subject) === userId,
    },
  }));
  return router;
}
