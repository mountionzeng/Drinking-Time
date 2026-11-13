import { Router, json } from "express";
import { z } from "zod";
import { timingSafeEqual } from "node:crypto";
import path from "node:path";
import { hasValidBridgeSignature } from "./shiguangBridgeSignature";
import { claimShiguangBridgeNonce } from "../repositories/shiguangBridgeNonces";
import {
  allowShiguangDesktopTransferAttempt,
  accountDatabaseReady,
} from "../services/accountIdentity";
import {
  confirmMailboxHandoff,
  getMailboxHandoff,
  handoffMac,
  listNativeMailbox,
  mailboxHandoffEnabled,
  previewMailboxHandoff,
  readNativeMailbox,
  shareNativeMailbox,
} from "../repositories/storyMailboxHandoff";
import {
  nativeMailboxDocument,
  nativeMailboxMedia,
} from "../services/storyMailboxNativeView";
import { localVideoDir } from "../services/videoMedia";
import { resolveManagedAudioPath } from "../services/audioMedia";
const requestSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("preview"),
      code: z.string().regex(/^[A-F0-9]{28}$/),
    })
    .strict(),
  z
    .object({
      action: z.literal("confirm"),
      code: z.string().regex(/^[A-F0-9]{28}$/),
    })
    .strict(),
  z.object({ action: z.literal("list") }).strict(),
  z
    .object({
      action: z.literal("read"),
      id: z.string().uuid(),
      token: z
        .string()
        .regex(/^[A-Za-z0-9_-]{43}$/)
        .optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("share"),
      id: z.string().uuid(),
      fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
  z.object({ action: z.literal("revoke"), id: z.string().uuid() }).strict(),
]);
export async function executeNativeMailbox(
  subject: string,
  input: z.infer<typeof requestSchema>
) {
  if (input.action === "list")
    return { stories: await listNativeMailbox(subject) };
  if (input.action === "preview") {
    const row = await previewMailboxHandoff(subject, input.code);
    return {
      id: row.id,
      title: row.snapshot.title,
      inventory: row.snapshot.inventory,
    };
  }
  if (input.action === "confirm")
    return confirmMailboxHandoff(subject, input.code);
  const { row, mine } = await readNativeMailbox(
    subject,
    input.id,
    "token" in input ? input.token : undefined
  );
  if (input.action === "read")
    return {
      document: nativeMailboxDocument(row, mine),
      ...(mine ? { fingerprint: row.snapshot.fingerprint } : {}),
    };
  if (
    !mine ||
    (input.action === "share" && input.fingerprint !== row.snapshot.fingerprint)
  )
    throw new Error("mailbox_scope_changed");
  return shareNativeMailbox(subject, input.id, input.action === "revoke");
}
export function storyMailboxNativeRoutes() {
  const router = Router();
  router.use(json({ limit: "8kb" }));
  router.post("/mailbox", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const secret = process.env.SHIGUANG_BRIDGE_SECRET || "",
        now = Date.now();
      if (
        !mailboxHandoffEnabled() ||
        secret.length < 32 ||
        !(await accountDatabaseReady())
      )
        return res.status(503).json({ error: "mailbox_unavailable" });
      if (
        !hasValidBridgeSignature(req, secret, now) ||
        !(await claimShiguangBridgeNonce(
          req.header("x-shiguang-timestamp")!,
          req.header("x-shiguang-nonce")!,
          now
        ))
      )
        return res.status(401).json({ error: "invalid_signature" });
      const { subject, ...raw } = req.body ?? {};
      if (!/^shiguang:[0-9a-f]{64}$/.test(subject || ""))
        return res.status(400).json({ error: "invalid_input" });
      if (!(await allowShiguangDesktopTransferAttempt(subject)))
        return res.status(429).json({ error: "rate_limited" });
      const result = await executeNativeMailbox(
        subject,
        requestSchema.parse(raw)
      );
      return res.json(result);
    } catch {
      return res.status(409).json({ error: "mailbox_unavailable" });
    }
  });
  return router;
}
export function storyMailboxNativeMediaRoutes() {
  const router = Router();
  router.get("/:id/:index", async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    try {
      const e = Number(req.query.e),
        index = Number(req.params.index),
        token = String(req.query.token || "");
      if (
        !mailboxHandoffEnabled() ||
        !Number.isSafeInteger(e) ||
        e <= Date.now() ||
        e > Date.now() + 20 * 60 * 1000 ||
        !Number.isSafeInteger(index) ||
        index < 0 ||
        !/^[a-f0-9]{64}$/.test(token)
      )
        return res.sendStatus(404);
      const row = await getMailboxHandoff(req.params.id);
      if (!row?.confirmedAt) return res.sendStatus(404);
      const expected = handoffMac(
        `media:${row.id}:${index}:${e}:${row.shareHash ?? "private"}`
      );
      if (!timingSafeEqual(Buffer.from(expected), Buffer.from(token)))
        return res.sendStatus(404);
      const m = nativeMailboxMedia(row)[index];
      if (!m?.file) return res.sendStatus(404);
      if (
        m.kind === "video" &&
        !/^mailbox-[a-f0-9-]+\.(mp4|webm|mov)$/.test(m.file)
      )
        return res.sendStatus(404);
      const file =
        m.kind === "video"
          ? path.join(localVideoDir(), m.file)
          : resolveManagedAudioPath(m.file);
      if (m.kind === "audio")
        res.type(
          /wav/.test(m.format || "")
            ? "audio/wav"
            : /ogg/.test(m.format || "")
              ? "audio/ogg"
              : /mp4|m4a|mov/.test(m.format || "")
                ? "audio/mp4"
                : "audio/mpeg"
        );
      res.sendFile(file, error => {
        if (error && !res.headersSent) res.sendStatus(404);
      });
    } catch {
      if (!res.headersSent) res.sendStatus(503);
    }
  });
  return router;
}
