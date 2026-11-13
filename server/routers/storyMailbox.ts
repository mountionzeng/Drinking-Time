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
const contact = z.object({ contactId: z.string().length(43) });
export const storyMailboxRouter = router({
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
    .input(z.object({ storyId: z.number().int().positive() }))
    .query(({ ctx, input }) => previewMailboxStory(ctx.user.id, input.storyId)),
  send: protectedProcedure
    .input(
      contact.extend({
        storyId: z.number().int().positive(),
        requestId: z.string().uuid(),
        fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
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
    .input(z.object({ entryId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      receiveMailboxStory(ctx.user.id, input.entryId)
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
