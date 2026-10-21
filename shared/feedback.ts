import { z } from "zod";
import { MINOR_PER_YUAN, COMPUTE_UNITS_PER_YUAN } from "./computeMoney";

export const FEEDBACK_REWARD_MINOR =
  (5 * MINOR_PER_YUAN) / COMPUTE_UNITS_PER_YUAN;
export const feedbackCategory = z.enum(["bug", "suggestion", "praise"]);
export const feedbackInput = z
  .object({
    id: z.string().uuid(),
    category: feedbackCategory,
    title: z.string().trim().min(2).max(120),
    content: z.string().trim().min(5).max(4000),
    tags: z
      .array(z.string().trim().min(1).max(20))
      .max(5)
      .transform(tags => [...new Set(tags)]),
    page: z.enum(["/m", "/editing", "/other"]),
  })
  .strict();
export const feedbackStatus = z.enum([
  "open",
  "reviewing",
  "adopting",
  "adopted",
  "closed",
]);
export const feedbackCategoryLabels = {
  bug: "技术 BUG",
  suggestion: "操作建议",
  praise: "夸奖",
} as const;
export const feedbackStatusLabels = {
  open: "待查看",
  reviewing: "处理中",
  adopting: "奖励发放中",
  adopted: "已采用 · 奖励 5 算力",
  closed: "已回复",
} as const;
