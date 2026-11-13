import { z } from "zod";

/** Opaque content keys are issued from an owned saved document, never client prose. */
export const mailboxSelectionSchema = z
  .object({
    version: z.literal(1),
    keys: z.array(z.string().min(1).max(240)).min(1).max(2000),
  })
  .strict();
export type MailboxSelection = z.infer<typeof mailboxSelectionSchema>;
export type MailboxPart = {
  key: string;
  kind: "text" | "image" | "video" | "audio";
  group: string;
  label: string;
};
