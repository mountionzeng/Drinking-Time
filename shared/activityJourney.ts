import { z } from "zod";
import { adminUserCategories } from "./adminUsers";

export const ACTIVITY_VERSION = 2;
export const ACTIVITY_PLATFORMS = ["web", "miniprogram", "unknown"] as const;
export const ACTIVITY_EVENTS = [
  "creation.entered",
  "generation.submitted",
  "generation.resolved",
  "result.opened",
] as const;
export const ACTIVITY_RESULTS = [
  "none", "succeeded", "failed", "cancelled", "timeout", "unknown",
] as const;
export const ACTIVITY_KINDS = ["image", "video"] as const;
export const ACTIVITY_DAY_MS = 86_400_000;
export const ACTIVITY_MAX_DAYS = 30;
export const ACTIVITY_TIME_ZONE = "Asia/Shanghai";
export const ACTIVITY_VISIT_HEADER = "x-dt-creation-visit";

export const activityVisitId = z.uuid();
export const activitySignal = z.discriminatedUnion("eventName", [
  z.strictObject({ eventName: z.literal("creation.entered") }),
  z.strictObject({
    eventName: z.literal("result.opened"),
    subjectKind: z.enum(ACTIVITY_KINDS),
    subjectRef: z.number().int().positive().max(2_147_483_647),
  }),
]);
export type ActivitySignal = z.infer<typeof activitySignal>;

export const activityWindow = z.strictObject({
  from: z.iso.date(),
  through: z.iso.date(),
  platform: z.enum(ACTIVITY_PLATFORMS).optional(),
  category: z.enum(adminUserCategories).optional(),
}).superRefine(({ from, through }, ctx) => {
  const { start, end } = activityBounds(from, through);
  if (end <= start || end - start > ACTIVITY_MAX_DAYS * ACTIVITY_DAY_MS) {
    ctx.addIssue({ code: "custom", message: "请选择 1 至 30 个北京时间自然日" });
  }
});

export type ActivityWindow = z.infer<typeof activityWindow>;

export function activityBounds(from: string, through: string) {
  return {
    start: Date.parse(from + "T00:00:00+08:00"),
    end: Date.parse(through + "T00:00:00+08:00") + ACTIVITY_DAY_MS,
  };
}

export function activityBeijingDate(at: number) {
  return new Date(at + 8 * 3_600_000).toISOString().slice(0, 10);
}

export function activityBeijingTime(at: number) {
  return new Date(at + 8 * 3_600_000).toISOString().slice(0, 23) + "+08:00";
}
