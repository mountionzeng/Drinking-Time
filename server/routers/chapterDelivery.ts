import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { artworkAuthorName } from "../../shared/artworkShare";
import { parseChapterPackage, type ChapterPackage } from "../../shared/chapterPackage";
import { protectedProcedure, router } from "../_core/trpc";
import { ENV } from "../_core/env";
import {
  claimChapterDelivery,
  findChapterDeliveryByRequest,
  findDeliveryByClaimTokenHash,
  findRootPackageDelivery,
  getChapterDelivery,
  getChapterPackage,
  listChapterInbox,
  listChapterDeliveryAssets,
  setChapterAssetUploadTicket,
  setChapterDeliveryStatus,
  startChapterDelivery,
} from "../repositories/chapterDeliveries";
import { listMemorySpaceContacts } from "../repositories/memorySpace";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const CLAIM_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PACKAGE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const UPLOAD_TTL_MS = 15 * 60 * 1000;
const DAILY_SEND_LIMIT = 20;

export function utcCalendarDayBounds(now: Date) {
  const since = new Date(now);
  since.setUTCHours(0, 0, 0, 0);
  const until = new Date(since.getTime() + 24 * 60 * 60 * 1000);
  return { since, until };
}

function contactId(ownerId: number, contactUserId: number) {
  if (ENV.cookieSecret.length < 32)
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "投递身份映射未配置" });
  return createHmac("sha256", ENV.cookieSecret)
    .update(`chapter-delivery-contact:v1:${ownerId}:${contactUserId}`)
    .digest("base64url");
}

async function deliveryContacts(userId: number) {
  return listMemorySpaceContacts(userId);
}

export function chapterDeliveryEnabled() {
  return process.env.CHAPTER_PACKAGE_ENABLED === "true" &&
    process.env.CHAPTER_DELIVERY_ENABLED === "true";
}

function requireEnabled() {
  if (!chapterDeliveryEnabled())
    throw new TRPCError({ code: "NOT_FOUND", message: "章节投递暂未开放" });
}

function parsePackage(raw: unknown): ChapterPackage {
  try {
    const pkg = parseChapterPackage(raw);
    if (Buffer.byteLength(JSON.stringify(pkg), "utf8") > 256 * 1024)
      throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "章节包超过 256 KB" });
    return pkg;
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    throw new TRPCError({ code: "BAD_REQUEST", message: "章节包格式无效" });
  }
}

async function beginSend(input: {
  package: ChapterPackage;
  senderUserId: number;
  recipientUserId: number | null;
  requestId: string;
  claimToken?: string;
  kind?: "send" | "return";
}) {
  const now = new Date();
  const dailyLimit = utcCalendarDayBounds(now);
  const packageJson = { ...input.package, sender: { ...input.package.sender } };
  const packageHash = hash(JSON.stringify(packageJson));
  const kind = input.kind ?? "send";
  const requestHash = hash(JSON.stringify({ packageHash, recipientUserId: input.recipientUserId, kind }));
  const old = await findChapterDeliveryByRequest(input.senderUserId, input.requestId);
  if (old && old.expiresAt <= now)
    throw new TRPCError({ code: "NOT_FOUND", message: "这份章节投递已过期" });
  if (old && old.requestHash !== requestHash)
    throw new TRPCError({ code: "CONFLICT", message: "这个请求编号已用于其他投递" });
  const claimToken = old?.claimTokenHash ? undefined : input.claimToken;
  const delivery = await startChapterDelivery({
    package: packageJson,
    packageHash,
    requestHash,
    assets: packageJson.assets.map(({ assetId, sha256, mime, bytes }) => ({ assetId, sha256, mime, bytes })),
    packageExpiresAt: new Date(now.getTime() + PACKAGE_TTL_MS),
    row: {
      deliveryId: old?.deliveryId ?? randomUUID(),
      packageId: packageJson.packageId,
      senderUserId: input.senderUserId,
      recipientUserId: input.recipientUserId,
      claimTokenHash: claimToken ? hash(claimToken) : null,
      claimExpiresAt: claimToken ? new Date(now.getTime() + CLAIM_TTL_MS) : null,
      kind,
      status: "pending",
      requestId: input.requestId,
      requestHash,
      readyAt: null,
      createdAt: old?.createdAt ?? now,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + PACKAGE_TTL_MS),
    },
    dailyLimit: { ...dailyLimit, maximum: DAILY_SEND_LIMIT },
  });
  const uploadTickets: Array<{ assetId: string; path: string; token: string; mime: string; bytes: number; sha256: string; expiresAt: string }> = [];
  for (const asset of delivery.assets) {
    if (asset.storageKey) continue;
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(now.getTime() + UPLOAD_TTL_MS);
    if (await setChapterAssetUploadTicket({ packageId: packageJson.packageId, assetId: asset.assetId, tokenHash: hash(token), expiresAt }))
      uploadTickets.push({
        assetId: asset.assetId,
        path: `/api/chapter-delivery/media/${encodeURIComponent(packageJson.packageId)}/${encodeURIComponent(asset.assetId)}`,
        token, mime: asset.mime, bytes: asset.bytes, sha256: asset.sha256, expiresAt: expiresAt.toISOString(),
      });
  }
  return { delivery: delivery.delivery, uploadTickets, repeated: delivery.repeated };
}

async function deliveryView(deliveryId: string, recipientUserId: number) {
  const delivery = await getChapterDelivery(deliveryId);
  if (!delivery || delivery.recipientUserId !== recipientUserId || !delivery.readyAt || delivery.expiresAt <= new Date())
    throw new TRPCError({ code: "NOT_FOUND", message: "投递不存在" });
  const pkg = await getChapterPackage(delivery.packageId);
  if (!pkg) throw new TRPCError({ code: "NOT_FOUND", message: "章节包不存在" });
  const assets = await listChapterDeliveryAssets(delivery.packageId);
  const imageUrls: Record<string, string> = {};
  const expiresAt = Date.now() + 5 * 60 * 1000;
  for (const asset of assets) if (asset.storageKey) {
    const token = createHmac("sha256", ENV.cookieSecret)
      .update(`chapter-delivery-download:v1:${delivery.deliveryId}:${recipientUserId}:${asset.assetId}:${expiresAt}`)
      .digest("base64url");
    imageUrls[asset.assetId] = `/api/chapter-delivery/media/download/${encodeURIComponent(delivery.deliveryId)}/${encodeURIComponent(asset.assetId)}?e=${expiresAt}&token=${token}`;
  }
  return {
    delivery: {
      deliveryId: delivery.deliveryId, packageId: delivery.packageId,
      kind: delivery.kind, status: delivery.status, createdAt: delivery.createdAt,
      expiresAt: delivery.expiresAt,
    },
    package: pkg.packageJson,
    imageUrls,
  };
}

export const chapterDeliveryRouter = router({
  contacts: protectedProcedure.query(async ({ ctx }) => {
    requireEnabled();
    return (await deliveryContacts(ctx.user.id)).map(contact => ({
      contactId: contactId(ctx.user.id, contact.userId), displayName: contact.displayName,
    }));
  }),

  status: protectedProcedure.query(() => ({ enabled: chapterDeliveryEnabled() })),

  send: protectedProcedure.input(z.object({
    package: z.unknown(),
    recipientContactId: z.string().length(43),
    requestId: z.string().uuid(),
  })).mutation(async ({ ctx, input }) => {
    requireEnabled();
    const candidates = await deliveryContacts(ctx.user.id);
    const recipient = candidates.find(person => {
      const expected = Buffer.from(contactId(ctx.user.id, person.userId));
      const received = Buffer.from(input.recipientContactId);
      return expected.length === received.length && timingSafeEqual(expected, received);
    });
    if (!recipient)
      throw new TRPCError({ code: "FORBIDDEN", message: "只能投递给同家或同故事的已连接成员" });
    const parsed = parsePackage(input.package);
    const pkg = { ...parsed, sender: { platform: "web" as const, displayName: artworkAuthorName(ctx.user.name) } };
    const result = await beginSend({ package: pkg, senderUserId: ctx.user.id, recipientUserId: recipient.userId, requestId: input.requestId });
    return { deliveryId: result.delivery.deliveryId, uploadTickets: result.uploadTickets, repeated: result.repeated };
  }),

  createClaimLink: protectedProcedure.input(z.object({
    package: z.unknown(), requestId: z.string().uuid(),
  })).mutation(async ({ ctx, input }) => {
    requireEnabled();
    const parsed = parsePackage(input.package);
    const pkg = { ...parsed, sender: { platform: "web" as const, displayName: artworkAuthorName(ctx.user.name) } };
    // Deterministic HMAC makes an unknown-outcome retry recover the same one-time
    // link without storing its plaintext token. requestHash still binds its payload.
    const token = createHmac("sha256", ENV.cookieSecret)
      .update(`chapter-delivery-claim:v1:${ctx.user.id}:${input.requestId}:${pkg.packageId}`)
      .digest("base64url");
    const { delivery, uploadTickets, repeated } = await beginSend({
      package: pkg, senderUserId: ctx.user.id, recipientUserId: null, requestId: input.requestId, claimToken: token,
    });
    return { deliveryId: delivery.deliveryId, claimUrl: delivery.claimTokenHash === hash(token) ? `/chapter/claim/${token}` : null, uploadTickets, repeated };
  }),

  return: protectedProcedure.input(z.object({ package: z.unknown(), requestId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      requireEnabled();
      const parsed = parsePackage(input.package);
      const rootPackageId = parsed.lineage?.rootPackageId;
      const parentPackageId = parsed.lineage?.parentPackageId;
      if (!rootPackageId || !parentPackageId)
        throw new TRPCError({ code: "BAD_REQUEST", message: "发回包缺少原始章节来源" });
      const lineage = await findRootPackageDelivery({ rootPackageId, parentPackageId, recipientUserId: ctx.user.id });
      if (!lineage || !["kept", "appended"].includes(lineage.originalDelivery.status))
        throw new TRPCError({ code: "FORBIDDEN", message: "只能发回自己已留下或加入的章节" });
      const pkg = { ...parsed, sender: { platform: "web" as const, displayName: artworkAuthorName(ctx.user.name) } };
      const result = await beginSend({ package: pkg, senderUserId: ctx.user.id, recipientUserId: lineage.root.senderUserId, requestId: input.requestId, kind: "return" });
      return { deliveryId: result.delivery.deliveryId, uploadTickets: result.uploadTickets, repeated: result.repeated };
    }),

  claim: protectedProcedure.input(z.object({ token: z.string().length(43) })).mutation(async ({ ctx, input }) => {
    requireEnabled();
    const delivery = await findDeliveryByClaimTokenHash(hash(input.token));
    if (!delivery) throw new TRPCError({ code: "NOT_FOUND", message: "领取链接无效或已过期" });
    const claimed = await claimChapterDelivery({ deliveryId: delivery.deliveryId, tokenHash: hash(input.token), userId: ctx.user.id, now: new Date() });
    if (!claimed) throw new TRPCError({ code: "NOT_FOUND", message: "领取链接无效或已过期" });
    return { deliveryId: claimed.deliveryId };
  }),

  inbox: protectedProcedure.query(async ({ ctx }) => {
    requireEnabled();
    const rows = await listChapterInbox(ctx.user.id);
    return rows.filter(row => row.readyAt && row.expiresAt > new Date()).map(row => ({
      deliveryId: row.deliveryId, packageId: row.packageId,
      kind: row.kind, status: row.status, createdAt: row.createdAt,
    }));
  }),

  read: protectedProcedure.input(z.object({ deliveryId: z.string().uuid() })).query(async ({ ctx, input }) => {
    requireEnabled();
    return deliveryView(input.deliveryId, ctx.user.id);
  }),

  resolve: protectedProcedure.input(z.object({
    deliveryId: z.string().uuid(), status: z.enum(["kept", "appended", "adopted", "declined"]),
  })).mutation(async ({ ctx, input }) => {
    requireEnabled();
    const row = await setChapterDeliveryStatus({ deliveryId: input.deliveryId, actorUserId: ctx.user.id, status: input.status, now: new Date() });
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "投递不存在或已处理" });
    return { status: row.status };
  }),
});
