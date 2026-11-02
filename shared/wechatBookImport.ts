import { z } from "zod";

export const wechatStoryRefSchema = z
  .object({
    storyId: z.string().regex(/^story-[a-z0-9-]{1,100}$/),
    revisionId: z.string().regex(/^revision-[a-zA-Z0-9-]{1,120}$/),
    version: z.number().int().positive(),
  })
  .strict();
export type WechatStoryRef = z.infer<typeof wechatStoryRefSchema>;
export const wechatStorySummarySchema = wechatStoryRefSchema.extend({
  title: z.string().min(1).max(200),
  updatedAt: z.string().max(64),
});
export const wechatCatalogSchema = z
  .object({
    stories: z.array(wechatStorySummarySchema).max(50),
    nextCursor: z.number().int().min(0).max(10000).nullable(),
  })
  .strict();
const media = z
  .object({ ref: z.string().min(1).max(240), available: z.boolean() })
  .strict();
export const wechatBookSnapshotSchema = wechatStoryRefSchema
  .extend({
    title: z.string().min(1).max(200),
    updatedAt: z.string().max(64),
    editorName: z.string().max(120).optional(),
    receivedFromName: z.string().max(120).optional(),
    changeSummary: z.string().max(1000).optional(),
    containsAiText: z.boolean(),
    cover: media.nullable(),
    chapters: z
      .array(
        z
          .object({
            id: z.string().min(1).max(160),
            title: z.string().max(200),
            content: z
              .array(
                z
                  .object({
                    id: z.string().min(1).max(160),
                    text: z.string().max(50000).optional(),
                    photo: media.optional(),
                    sourceIds: z.array(z.string().max(100)).max(64),
                    fontSize: z.number().min(12).max(120).optional(),
                  })
                  .strict()
                  .refine(
                    b => (b.text !== undefined) !== (b.photo !== undefined)
                  )
              )
              .max(1000),
          })
          .strict()
      )
      .max(100),
    warnings: z.array(z.string().max(300)).max(30),
  })
  .strict()
  .superRefine((book, ctx) => {
    const chapters = book.chapters.map(c => c.id);
    if (
      new Set(chapters).size !== chapters.length ||
      book.chapters.reduce(
        (n, c) => n + c.content.reduce((m, b) => m + (b.text?.length ?? 0), 0),
        0
      ) > 200000
    )
      ctx.addIssue({
        code: "custom",
        message: "Invalid or oversized manuscript",
      });
    for (const chapter of book.chapters)
      if (
        new Set(chapter.content.map(b => b.id)).size !== chapter.content.length
      )
        ctx.addIssue({ code: "custom", message: "Duplicate block" });
  });
export type WechatBookSnapshot = z.infer<typeof wechatBookSnapshotSchema>;
