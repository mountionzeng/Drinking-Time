import { Router, json, type Request, type Response } from "express";
import { hasValidBridgeSignature } from "./shiguangBridgeSignature";
import { acceptClientActivity } from "../services/activityJourney";

type Dependencies = {
  enabled: boolean;
  secret: string;
  ready: () => Promise<boolean>;
  allow: (subject: string) => Promise<boolean>;
  resolve: (subject: string) => Promise<number>;
  claimNonce: (timestamp: string, nonce: string, now: number) => Promise<boolean>;
  now?: () => number;
};

/** 已签名云函数才能代小程序报告导航。不能指定别人的 userId，也不能申报成功或支付。 */
export function createShiguangActivityRouter(deps: Dependencies) {
  const router = Router();
  router.use(json({ limit: "4kb" }));
  router.post("/activity", async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      if (!deps.enabled || deps.secret.length < 32 || !await deps.ready()) {
        return res.status(503).json({ error: "unavailable" });
      }
      const now = (deps.now ?? Date.now)();
      if (!hasValidBridgeSignature(req, deps.secret, now)) {
        return res.status(401).json({ error: "invalid_bridge_signature" });
      }
      const timestamp = req.header("x-shiguang-timestamp") ?? "";
      const nonce = req.header("x-shiguang-nonce") ?? "";
      if (!await deps.claimNonce(timestamp, nonce, now)) {
        return res.status(401).json({ error: "replayed_request" });
      }
      const subject = req.body?.subject;
      if (typeof subject !== "string" || !/^shiguang:[0-9a-f]{64}$/.test(subject)) {
        return res.status(400).json({ error: "invalid_input" });
      }
      if (!await deps.allow(subject)) return res.status(429).json({ error: "rate_limited" });
      const userId = await deps.resolve(subject);
      const { subject: _subject, ...body } = req.body as Record<string, unknown>;
      const outcome = await acceptClientActivity({ userId, platform: "miniprogram", body });
      if (outcome === "invalid") return res.status(400).json({ error: "invalid_input" });
      if (outcome === "not_found") return res.status(404).json({ error: "not_found" });
      if (outcome === "limited") return res.status(429).json({ error: "rate_limited" });
      return res.json({ outcome: outcome === "dropped" ? "dropped" : outcome });
    } catch {
      return res.status(503).json({ error: "unavailable" });
    }
  });
  return router;
}
