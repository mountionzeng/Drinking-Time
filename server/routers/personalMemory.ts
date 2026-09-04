/**
 * 足迹与记忆控制 API（U7）。
 *
 * 这个 router 的每个 procedure 都是 `protectedProcedure`，且 **userId 一律取自
 * `ctx.user.id`**：input schema 里不存在任何用户身份字段，客户端没有任何途径
 * 声明"我是谁"。这不是风格问题——足迹里全是用户最私密的原话，一旦某个入口
 * 接受客户端传入的 userId，其余所有归属校验都失去意义。
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import {
  PERSONAL_MEMORY_SOURCE_TYPES,
  type PersonalMemorySourceType,
} from "@shared/personalMemory";
import {
  getPersonalMemoryDayDetail,
  getPersonalMemorySummary,
  getPersonalMemoryTimelinePage,
  listPersonalMemoryInsightCards,
  resolvePersonalMemoryEventSource,
} from "../services/personalMemoryTimeline";
import {
  archivePersonalMemoryInsightLineage,
  correctPersonalMemoryInsight,
  forgetPersonalMemoryInsightLineage,
  listPersonalMemoryInsightsForUser,
  restorePersonalMemoryInsightLineage,
} from "../services/personalMemoryPersistence";

const sourceTypeSchema = z.enum(
  PERSONAL_MEMORY_SOURCE_TYPES as unknown as [
    PersonalMemorySourceType,
    ...PersonalMemorySourceType[],
  ]
);

const lineageKeySchema = z.string().min(1).max(191);

/**
 * 状态机拒绝（`invalid`）不是服务器故障，而是"你看到的状态已经过期了"。
 * 映射成 CONFLICT 让前端能提示刷新，而不是弹一个五百错误。
 */
function assertApplied(result: {
  outcome: "applied" | "invalid";
  reason?: string;
}) {
  if (result.outcome === "invalid") {
    throw new TRPCError({
      code: "CONFLICT",
      message: result.reason ?? "理解状态已变化，请刷新后重试",
    });
  }
  return result;
}

export const personalMemoryRouter = router({
  /** 头像弹层用的紧凑摘要：最近几个**有活动**的日期，不制造空自然日。 */
  summary: protectedProcedure
    .input(z.object({ maxDays: z.number().int().min(1).max(30).optional() }))
    .query(async ({ ctx, input }) =>
      getPersonalMemorySummary({ userId: ctx.user.id, maxDays: input.maxDays })
    ),

  /** 完整足迹分页。cursor 不透明，客户端只负责原样回传。 */
  timeline: protectedProcedure
    .input(
      z.object({
        cursor: z.string().max(512).nullish(),
        limit: z.number().int().min(1).max(100).optional(),
        sourceTypes: z.array(sourceTypeSchema).max(6).optional(),
      })
    )
    .query(async ({ ctx, input }) =>
      getPersonalMemoryTimelinePage({
        userId: ctx.user.id,
        cursor: input.cursor ?? null,
        limit: input.limit,
        sourceTypes: input.sourceTypes ?? null,
      })
    ),

  /** 某一天的详情。来信信息由详情 resolver 回源，不 union 进事件索引。 */
  day: protectedProcedure
    .input(z.object({ occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
    .query(async ({ ctx, input }) =>
      getPersonalMemoryDayDetail({
        userId: ctx.user.id,
        occurredOn: input.occurredOn,
      })
    ),

  /**
   * 解析一条经历回到来源。
   *
   * 不属于调用者的 eventId 一律 NOT_FOUND，**不是** FORBIDDEN——后者会把
   * "这个 ID 确实存在"告诉正在猜 ID 的人。
   */
  resolveSource: protectedProcedure
    .input(z.object({ eventId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const resolved = await resolvePersonalMemoryEventSource({
        userId: ctx.user.id,
        eventId: input.eventId,
      });
      if (!resolved) {
        throw new TRPCError({ code: "NOT_FOUND", message: "记录不存在" });
      }
      return resolved;
    }),

  /** 理解列表。默认只给 active 与 archived——superseded 是历史轨迹，不进控制面板。 */
  listInsights: protectedProcedure
    .input(
      z.object({
        includeArchived: z.boolean().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const states = input.includeArchived
        ? (["active", "archived"] as const)
        : (["active"] as const);
      const insights = await listPersonalMemoryInsightsForUser({
        userId: ctx.user.id,
        states,
        limit: input.limit,
      });
      const lineageKeys = [
        ...new Set(insights.map(insight => insight.lineageKey)),
      ];
      return listPersonalMemoryInsightCards({
        userId: ctx.user.id,
        lineageKeys,
      });
    }),

  archiveInsight: protectedProcedure
    .input(z.object({ lineageKey: lineageKeySchema }))
    .mutation(async ({ ctx, input }) =>
      assertApplied(
        await archivePersonalMemoryInsightLineage(ctx.user.id, input.lineageKey)
      )
    ),

  restoreInsight: protectedProcedure
    .input(z.object({ lineageKey: lineageKeySchema }))
    .mutation(async ({ ctx, input }) =>
      assertApplied(
        await restorePersonalMemoryInsightLineage(ctx.user.id, input.lineageKey)
      )
    ),

  /**
   * 忘记。清除整条 lineage 的正文并建立抑制记录（U5 已实现），
   * 但**不删除底层来源内容**——那是另一件事，由来源自己的删除入口负责。
   */
  forgetInsight: protectedProcedure
    .input(z.object({ lineageKey: lineageKeySchema }))
    .mutation(async ({ ctx, input }) =>
      assertApplied(
        await forgetPersonalMemoryInsightLineage(ctx.user.id, input.lineageKey)
      )
    ),

  /** 用户手动纠正：追加新版本并 supersede 旧版本，旧话不被改写成新结论。 */
  correctInsight: protectedProcedure
    .input(
      z.object({
        lineageKey: lineageKeySchema.nullable(),
        category: z.enum([
          "fact",
          "preference",
          "relationship",
          "goal",
          "concern",
          "reflection",
        ]),
        text: z.string().min(1).max(2000),
        allowProactiveMention: z.boolean().default(true),
      })
    )
    .mutation(async ({ ctx, input }) =>
      assertApplied(
        await correctPersonalMemoryInsight({
          userId: ctx.user.id,
          lineageKey: input.lineageKey,
          category: input.category,
          text: input.text,
          scope: null,
          allowProactiveMention: input.allowProactiveMention,
        })
      )
    ),
});
