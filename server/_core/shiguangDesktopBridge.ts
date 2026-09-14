import { createHmac, timingSafeEqual } from "node:crypto";
import { Router, json, type Request } from "express";

import type { IssuePairingResult } from "../services/accountIdentity";
import type { ShiguangStorySnapshot } from "../services/shiguangStoryImport";

type Dependencies = {
  enabled: boolean;
  secret: string;
  ready: () => Promise<boolean>;
  allow: (subject: string) => Promise<boolean>;
  resolve: (subject: string) => Promise<number>;
  importStory: (userId: number, story: ShiguangStorySnapshot) => Promise<{ storyId: number; created: boolean }>;
  issuePairing: (userId: number) => Promise<IssuePairingResult>;
  now?: () => number;
};

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

export function bridgeSignature(
  secret: string,
  path: string,
  timestamp: string,
  nonce: string,
  body: unknown
) {
  return createHmac("sha256", secret)
    .update(`POST\n${path}\n${timestamp}\n${nonce}\n${canonicalJson(body)}`)
    .digest("hex");
}

function hasValidSignature(req: Request, secret: string, now: number) {
  const timestamp = String(req.header("x-shiguang-timestamp") ?? "");
  const nonce = String(req.header("x-shiguang-nonce") ?? "");
  const signature = String(req.header("x-shiguang-signature") ?? "");
  if (
    !/^\d{13}$/.test(timestamp) ||
    Math.abs(now - Number(timestamp)) > 300_000 ||
    !/^[0-9A-Za-z_-]{16,64}$/.test(nonce) ||
    !/^[0-9a-f]{64}$/.test(signature)
  ) return false;
  const expected = bridgeSignature(secret, req.path, timestamp, nonce, req.body);
  return timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"));
}

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
  const seenNonces = new Map<string, number>();
  router.use(json({ limit: "512kb" }));
  router.post("/desktop/pair/issue", async (req, res) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      if (!deps.enabled || deps.secret.length < 32) return res.status(503).json({ error: "bridge_not_configured" });
      const now = (deps.now ?? Date.now)();
      if (!hasValidSignature(req, deps.secret, now)) return res.status(401).json({ error: "invalid_bridge_signature" });
      const replayKey = `${req.header("x-shiguang-timestamp")}:${req.header("x-shiguang-nonce")}`;
      if (seenNonces.has(replayKey)) return res.status(401).json({ error: "replayed_request" });
      seenNonces.set(replayKey, now);
      for (const [key, seenAt] of seenNonces) if (now - seenAt > 300_000) seenNonces.delete(key);

      const subject = req.body?.subject;
      const story = parseShiguangStorySnapshot(req.body?.story);
      if (typeof subject !== "string" || !/^shiguang:[0-9a-f]{64}$/.test(subject) || !story) {
        return res.status(400).json({ error: "invalid_input" });
      }
      if (!await deps.allow(subject)) return res.status(429).json({ error: "rate_limited" });
      if (!await deps.ready()) return res.status(503).json({ error: "unavailable" });

      const userId = await deps.resolve(subject);
      const imported = await deps.importStory(userId, story);
      const pairing = await deps.issuePairing(userId);
      if (pairing.outcome !== "issued") {
        return res.status(pairing.outcome === "rate_limited" ? 429 : 503).json({ error: pairing.outcome });
      }
      return res.json({
        code: pairing.code,
        expiresAt: pairing.expiresAt.toISOString(),
        storyId: imported.storyId,
        imported: imported.created,
      });
    } catch {
      return res.status(503).json({ error: "unavailable" });
    }
  });
  return router;
}
