import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { wechatStoryRefSchema } from "../../shared/wechatBookImport";
import {
  wechatBookImportService,
  wechatImportEnabled,
} from "../services/wechatBookImport";
import { consumePersistentRateLimit } from "../repositories/accounts";

async function call<T>(operation: () => Promise<T>): Promise<T> {
  if (!wechatImportEnabled())
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "微信故事导入尚未开放。你可以先继续写网页书稿，稍后再来导入。",
    });
  try {
    return await operation();
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    const code = error instanceof Error ? error.message : "";
    throw new TRPCError({
      code:
        code === "story_version_conflict" ? "CONFLICT" : "SERVICE_UNAVAILABLE",
      message:
        code === "story_version_conflict"
          ? "微信原稿已更新，请刷新列表后重新选择。网页书稿没有被覆盖。"
          : code === "story_access_revoked"
            ? "微信授权已过期或这份故事无法复制，请重新微信登录后重试。"
            : "暂时无法读取微信故事，请稍后重试。尚未完成的导入不会覆盖网页书稿。",
    });
  }
}
export const wechatBookImportRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({ cursor: z.number().int().min(0).max(10000).default(0) })
        .strict()
    )
    .query(({ ctx, input }) =>
      call(() => wechatBookImportService.catalog(ctx.user.id, input.cursor))
    ),
  import: protectedProcedure
    .input(wechatStoryRefSchema)
    .mutation(({ ctx, input }) =>
      call(async () => {
        const limit = await consumePersistentRateLimit({
          scope: "wechat-book-import",
          subject: String(ctx.user.id),
          windowSeconds: 3600,
          maxAttempts: 30,
        });
        if (!limit.allowed)
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: "导入次数较多，请稍后再试",
          });
        return wechatBookImportService.importBook(ctx.user.id, input);
      })
    ),
});
