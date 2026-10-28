import { Router, json } from "express";

import type { IssuePairingResult } from "../services/accountIdentity";
import type { ShiguangStorySnapshot } from "../services/shiguangStoryImport";
import { parseShiguangStoryAccessGrant, type ShiguangStoryAccessGrant } from "../services/shiguangStoryAccess";
import type { ConfirmDecision, ConfirmWebLoginResult } from "../services/webLogin";
import { hasValidBridgeSignature } from "./shiguangBridgeSignature";

export { canonicalJson, bridgeSignature } from "./shiguangBridgeSignature";

type Dependencies = {
  enabled: boolean;
  secret: string;
  ready: () => Promise<boolean>;
  claimNonce: (timestamp:string,nonce:string,now:number) => Promise<boolean>;
  storyAccessReady: () => boolean;
  allow: (subject: string) => Promise<boolean>;
  resolve: (subject: string) => Promise<number>;
  importStory: (userId: number, story: ShiguangStorySnapshot) => Promise<{ storyId: number; created: boolean }>;
  bindStoryAccess: (userId:number, grant:ShiguangStoryAccessGrant)=>Promise<{id:number}>;
  issuePairing: (userId: number) => Promise<IssuePairingResult>;
  /** 契约 1.6.0：网页扫码/输码登录确认。默认关闭，缺省则路由不存在。 */
  webLogin?: {
    enabled: boolean;
    confirm: (input: { subject: string; code: string; decision: ConfirmDecision }) => Promise<ConfirmWebLoginResult>;
  };
  chapterDelivery?: {
    enabled: boolean;
    call: (userId: number, action: string, body: Record<string, unknown>) => Promise<unknown>;
  };
  now?: () => number;
};

function validStrings(value: unknown, max: number, count: number) {
  return Array.isArray(value) && value.length <= count && value.every(item => typeof item === "string" && item.length <= max);
}

export function parseShiguangStorySnapshot(value: unknown): ShiguangStorySnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const story = value as Record<string, unknown>;
  if (
    typeof story.sourceKey !== "string" || story.sourceKey.length < 1 || story.sourceKey.length > 180 ||
    typeof story.sourceRevision !== "string" || !/^[0-9a-f]{16}$/.test(story.sourceRevision) ||
    typeof story.title !== "string" || story.title.trim().length < 1 || story.title.length > 120 ||
    typeof story.updatedAt !== "string" || !Number.isFinite(Date.parse(story.updatedAt)) ||
    !Array.isArray(story.memories) || story.memories.length > 500
  ) return null;
  const memories = story.memories as Array<Record<string, unknown>>;
  if (!memories.every(memory =>
    memory && typeof memory === "object" &&
    typeof memory.id === "string" && memory.id.length > 0 && memory.id.length <= 160 &&
    typeof memory.text === "string" && memory.text.length <= 2_000 &&
    typeof memory.createdAt === "string" && Number.isFinite(Date.parse(memory.createdAt)) &&
    (memory.title === undefined || (typeof memory.title === "string" && memory.title.length <= 120)) &&
    (memory.summary === undefined || (typeof memory.summary === "string" && memory.summary.length <= 1_000)) &&
    (memory.storyTitle === undefined || (typeof memory.storyTitle === "string" && memory.storyTitle.length <= 120)) &&
    (memory.emotions === undefined || validStrings(memory.emotions, 40, 20)) &&
    (memory.people === undefined || validStrings(memory.people, 80, 40)) &&
    (memory.places === undefined || validStrings(memory.places, 120, 40))
  )) return null;
  if (story.manuscript !== undefined) {
    if (!story.manuscript || typeof story.manuscript !== "object" || Array.isArray(story.manuscript)) return null;
    const manuscript = story.manuscript as Record<string, unknown>;
    if (typeof manuscript.title !== "string" || typeof manuscript.generatedAt !== "string" ||
      !Number.isFinite(Date.parse(manuscript.generatedAt)) || !Array.isArray(manuscript.chapters) || manuscript.chapters.length > 100) return null;
    if (!(manuscript.chapters as Array<Record<string, unknown>>).every(chapter =>
      chapter && typeof chapter.id === "string" && chapter.id.length <= 160 &&
      typeof chapter.title === "string" && chapter.title.length <= 120 &&
      validStrings(chapter.memoryIds, 160, 500) && Array.isArray(chapter.content) && chapter.content.length <= 1_000 &&
      (chapter.content as Array<Record<string, unknown>>).every(item => item && typeof item === "object" &&
        ((typeof item.text === "string" && item.text.length <= 50_000) || (typeof item.photoId === "string" && item.photoId.length <= 240)))
    )) return null;
  }
  return value as ShiguangStorySnapshot;
}

export function createShiguangDesktopBridgeRouter(deps: Dependencies) {
  const router = Router();
  router.use(json({ limit: "512kb" }));
  router.post("/desktop/pair/issue", async (req, res) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      if (!deps.enabled || deps.secret.length < 32) return res.status(503).json({ error: "bridge_not_configured" });
      const now = (deps.now ?? Date.now)();
      if (!hasValidBridgeSignature(req, deps.secret, now)) return res.status(401).json({ error: "invalid_bridge_signature" });
      const timestamp=req.header("x-shiguang-timestamp")!,nonce=req.header("x-shiguang-nonce")!;
      if(!await deps.claimNonce(timestamp,nonce,now))return res.status(401).json({error:"replayed_request"});

      const subject = req.body?.subject;
      const hasStory = Object.prototype.hasOwnProperty.call(req.body ?? {}, "story");
      const hasStoryAccess = Object.prototype.hasOwnProperty.call(req.body ?? {}, "storyAccess");
      const story = hasStory ? parseShiguangStorySnapshot(req.body.story) : null;
      const storyAccess = hasStoryAccess ? parseShiguangStoryAccessGrant(req.body.storyAccess) : null;
      if (typeof subject !== "string" || !/^shiguang:[0-9a-f]{64}$/.test(subject) || hasStory===hasStoryAccess ||
        (hasStory && !story) || (hasStoryAccess && !storyAccess)) {
        return res.status(400).json({ error: "invalid_input" });
      }
      if(storyAccess&&!deps.storyAccessReady())return res.status(503).json({error:"story_authority_not_configured"});
      if (!await deps.allow(subject)) return res.status(429).json({ error: "rate_limited" });
      if (!await deps.ready()) return res.status(503).json({ error: "unavailable" });

      const userId = await deps.resolve(subject);
      const imported = story ? await deps.importStory(userId, story) : null;
      const binding = storyAccess ? await deps.bindStoryAccess(userId, storyAccess) : null;
      const pairing = await deps.issuePairing(userId);
      if (pairing.outcome !== "issued") {
        return res.status(pairing.outcome === "rate_limited" ? 429 : 503).json({ error: pairing.outcome });
      }
      return res.json({
        code: pairing.code,
        expiresAt: pairing.expiresAt.toISOString(),
        ...(imported?{storyId:imported.storyId,imported:imported.created}:{}),
        ...(binding?{storyAccessId:binding.id,bound:true}:{}),
      });
    } catch {
      return res.status(503).json({ error: "unavailable" });
    }
  });
  router.post("/web-login/confirm", async (req, res) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      if (!deps.webLogin?.enabled || deps.secret.length < 32) return res.status(503).json({ error: "bridge_not_configured" });
      const now = (deps.now ?? Date.now)();
      if (!hasValidBridgeSignature(req, deps.secret, now)) return res.status(401).json({ error: "invalid_bridge_signature" });
      const timestamp = req.header("x-shiguang-timestamp")!, nonce = req.header("x-shiguang-nonce")!;
      if (!await deps.claimNonce(timestamp, nonce, now)) return res.status(401).json({ error: "replayed_request" });
      const { subject, code, decision } = req.body ?? {};
      const keys = Object.keys(req.body ?? {});
      if (typeof subject !== "string" || !/^shiguang:[0-9a-f]{64}$/.test(subject) ||
        typeof code !== "string" || code.length > 16 ||
        !["preview", "confirm", "deny"].includes(decision) ||
        keys.some(key => !["subject", "code", "decision"].includes(key))) {
        return res.status(400).json({ error: "invalid_input" });
      }
      if (!await deps.ready()) return res.status(503).json({ error: "unavailable" });
      const result = await deps.webLogin.confirm({ subject, code, decision });
      if (result.outcome === "rate_limited") return res.status(429).json({ error: "rate_limited" });
      if (result.outcome === "not_configured") return res.status(503).json({ error: "not_configured" });
      // 码不存在、过期、已用过对外只有一种失败。
      if (result.outcome === "invalid") return res.status(404).json({ error: "invalid_code" });
      if (result.outcome === "preview") return res.json({ outcome: "preview", clientHint: result.clientHint, mode: result.mode });
      return res.json({ outcome: result.outcome });
    } catch {
      return res.status(503).json({ error: "unavailable" });
    }
  });
  const deliveryActions: Record<string, string[]> = {
    "/chapter-delivery/contacts": ["subject"],
    "/chapter-delivery/send": ["subject", "package", "recipientContactId", "requestId"],
    "/chapter-delivery/create-claim-link": ["subject", "package", "requestId"],
    "/chapter-delivery/claim": ["subject", "token", "otherUserOnly"],
    "/chapter-delivery/inbox": ["subject"],
    "/chapter-delivery/read": ["subject", "deliveryId"],
    "/chapter-delivery/resolve": ["subject", "deliveryId", "status"],
    "/chapter-delivery/return": ["subject", "package", "requestId"],
  };
  for (const [path, allowedKeys] of Object.entries(deliveryActions)) {
    router.post(path, async (req, res) => {
      try {
        res.setHeader("Cache-Control", "no-store");
        if (!deps.chapterDelivery?.enabled || deps.secret.length < 32)
          return res.status(503).json({ error: "bridge_not_configured" });
        const now = (deps.now ?? Date.now)();
        if (!hasValidBridgeSignature(req, deps.secret, now))
          return res.status(401).json({ error: "invalid_bridge_signature" });
        const timestamp = req.header("x-shiguang-timestamp")!, nonce = req.header("x-shiguang-nonce")!;
        if (!await deps.claimNonce(timestamp, nonce, now))
          return res.status(401).json({ error: "replayed_request" });
        if (Buffer.byteLength(JSON.stringify(req.body ?? {}), "utf8") > 256 * 1024)
          return res.status(413).json({ error: "payload_too_large" });
        const body = req.body ?? {};
        if (Object.keys(body).some(key => !allowedKeys.includes(key)) ||
          typeof body.subject !== "string" || !/^shiguang:[0-9a-f]{64}$/.test(body.subject))
          return res.status(400).json({ error: "invalid_input" });
        if (!await deps.ready()) return res.status(503).json({ error: "unavailable" });
        if (!await deps.allow(body.subject)) return res.status(429).json({ error: "rate_limited" });
        const userId = await deps.resolve(body.subject);
        const result = await deps.chapterDelivery.call(userId, path, body);
        return res.json(result);
      } catch (error) {
        const code = (error as { code?: string })?.code;
        if (code === "NOT_FOUND" || code === "FORBIDDEN") return res.status(404).json({ error: "not_found" });
        if (code === "BAD_REQUEST" || code === "CONFLICT" || code === "PAYLOAD_TOO_LARGE")
          return res.status(code === "PAYLOAD_TOO_LARGE" ? 413 : 400).json({ error: code === "CONFLICT" ? "request_conflict" : "invalid_input" });
        if (code === "TOO_MANY_REQUESTS") return res.status(429).json({ error: "rate_limited" });
        return res.status(503).json({ error: "unavailable" });
      }
    });
  }
  return router;
}
