import { prepareWechatMailboxHandoff } from "../services/storyMailboxHandoff";
import { TRPCError } from "@trpc/server";
import { wechatLoginQrConfigured } from "../services/wechatLoginQr";
import {
  getMailboxHandoff,
  mailboxHandoffCanCreate,
  mailboxWechatBinding,
} from "../repositories/storyMailboxHandoff";
import { mailboxSelectionSchema } from "../../shared/storyMailboxSelection";
import { captureMailboxPackage } from "../repositories/storyMailboxPackage";
import { mailboxParts } from "../repositories/storyMailboxSelection";
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import {
  mailboxContacts,
  mailboxEntries,
  mailboxThreads,
  markMailboxRead,
  removeMailboxContact,
  resolveMailboxContact,
} from "../repositories/storyMailbox";
import {
  previewMailboxStory,
  sendMailboxStory,
  refreshMailboxThread,
  mailboxStoryChoices,
} from "../repositories/storyMailboxActions";
import { receiveMailboxStory } from "../repositories/storyMailboxImport";
import { publishMailboxMemory, readMailboxMemory } from "../repositories/storyMailboxMemory";
const contact = z.object({ contactId: z.string().length(43) });
export const storyMailboxRouter = router({
  publishMemory: protectedProcedure.input(contact.extend({
    storyId: z.number().int().positive(),
    markdown: z.string().trim().min(1).max(12_000),
  }).and(z.union([
    z.object({ requestId: z.string().uuid(), threadId: z.never().optional() }),
    z.object({ threadId: z.string().uuid(), expectedVersion: z.number().int().positive(), requestId: z.never().optional() }),
  ]))).mutation(({ ctx, input }) =>
    publishMailboxMemory(ctx.user.id, ctx.user.name?.trim().slice(0, 100) || "朋友", input)
  ),
  memoryVersion: protectedProcedure.input(z.object({ entryId: z.string().uuid() }))
    .query(({ ctx, input }) => {
      ctx.res.setHeader?.("Cache-Control", "private, no-store");
      return readMailboxMemory(ctx.user.id, input.entryId);
    }),
  nativeStatus: protectedProcedure.query(async ({ ctx }) => ({
    enabled: mailboxHandoffCanCreate(ctx.user.id) && wechatLoginQrConfigured(),
    bound:
      mailboxHandoffCanCreate(ctx.user.id) &&
      Boolean(await mailboxWechatBinding(ctx.user.id)),
  })),
  nativeCreate: protectedProcedure
    .input(
      z.object({
        storyId: z.number().int().positive(),
        selection: mailboxSelectionSchema.optional(),
        fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
        requestId: z.string().uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return prepareWechatMailboxHandoff(ctx.user.id, input);
    }),
  nativePoll: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const row = await getMailboxHandoff(input.id);
      if (!row || row.userId !== ctx.user.id)
        throw new TRPCError({ code: "NOT_FOUND" });
      return {
        confirmed: Boolean(row.confirmedAt),
        expired: !row.confirmedAt && row.expiresAt.getTime() <= Date.now(),
      };
    }),

  parts: protectedProcedure
    .input(z.object({ storyId: z.number().int().positive() }))
    .query(async ({ ctx, input }) =>
      mailboxParts(await captureMailboxPackage(input.storyId, ctx.user.id))
    ),
  contacts: protectedProcedure.query(async ({ ctx }) =>
    (await mailboxContacts(ctx.user.id)).map(c => c.public)
  ),
  stories: protectedProcedure.query(({ ctx }) =>
    mailboxStoryChoices(ctx.user.id)
  ),
  history: protectedProcedure
    .input(
      contact.extend({
        cursor: z
          .object({ at: z.string().datetime(), id: z.string().uuid() })
          .optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const person = await resolveMailboxContact(ctx.user.id, input.contactId);
      return mailboxEntries(ctx.user.id, person.peerId, input.cursor);
    }),
  threads: protectedProcedure.input(contact).query(async ({ ctx, input }) => {
    const person = await resolveMailboxContact(ctx.user.id, input.contactId);
    return (await mailboxThreads(ctx.user.id))
      .filter(
        t => t.senderId === person.peerId || t.recipientId === person.peerId
      )
      .map(t => ({
        id: t.id,
        ownStoryId:
          t.senderId === ctx.user.id ? t.sourceStoryId : t.copyStoryId,
      }));
  }),
  preview: protectedProcedure
    .input(
      z.object({
        storyId: z.number().int().positive(),
        selection: mailboxSelectionSchema.optional(),
      })
    )
    .query(({ ctx, input }) =>
      previewMailboxStory(ctx.user.id, input.storyId, input.selection)
    ),
  send: protectedProcedure
    .input(
      contact.extend({
        storyId: z.number().int().positive(),
        requestId: z.string().uuid(),
        fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
        selection: mailboxSelectionSchema.optional(),
        note: z.string().trim().max(2000).default(""),
      })
    )
    .mutation(({ ctx, input }) => sendMailboxStory(ctx.user.id, input)),
  refresh: protectedProcedure
    .input(z.object({ threadId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      refreshMailboxThread(ctx.user.id, input.threadId)
    ),
  receive: protectedProcedure
    .input(z.object({ entryId: z.string().uuid(), targetStoryId: z.number().int().positive().optional() }))
    .mutation(({ ctx, input }) =>
      receiveMailboxStory(ctx.user.id, input.entryId, input.targetStoryId)
    ),
  markRead: protectedProcedure
    .input(contact.extend({ entryIds: z.array(z.string().uuid()).max(30) }))
    .mutation(async ({ ctx, input }) => {
      const person = await resolveMailboxContact(ctx.user.id, input.contactId);
      await markMailboxRead(ctx.user.id, person.peerId, input.entryIds);
      return { ok: true };
    }),
  removeContact: protectedProcedure
    .input(contact)
    .mutation(async ({ ctx, input }) => {
      const person = await resolveMailboxContact(ctx.user.id, input.contactId);
      await removeMailboxContact(ctx.user.id, person.peerId);
      return { ok: true };
    }),
});
