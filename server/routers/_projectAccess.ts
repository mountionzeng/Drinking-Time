import { TRPCError } from "@trpc/server";
import { getProjectById } from "../db";

/**
 * 用途：确认这个 project 属于当前登录用户，不属于就直接拒绝。`projects` 表有
 *   `userId`，但 `protectedProcedure` 只验"登录了"、不验"这东西是你的"——凡是
 *   把客户端传来的 projectId 当作访问键去读写数据的 procedure，都必须先过这一
 *   关。少了它，任何登录用户传一个别人的 projectId 就能读到或写入别人的数据
 *   （水平越权）。Story 侧早有等价约束（`getStoryById(id, userId)` 同时校验
 *   两者），project 侧当年漏了，这里补齐同一条不变量。
 * 调用入口：server/routers/index.ts（reference.upload/list、analysis.run/get、
 *   editContext.saveSnapshot/getRecentAnnotations）、server/routers/storyAgent.ts
 *   （chat、mobileChat）、server/routers/creationAgent.ts（chat、
 *   generateNextImage、inpaint）。
 * 下游调用：server/db.ts 的 `getProjectById`（按 id + userId 过滤，不属于返回 null）。
 */
export async function assertProjectOwner(projectId: number, userId: number) {
  const project = await getProjectById(projectId, userId);
  if (!project) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "该项目不存在，或不属于当前用户",
    });
  }
  return project;
}

/**
 * 用途：`projectId` 可选的 procedure 用这个——传了就必须是自己的，没传就跳过。
 *   这类 procedure 拿 projectId 去捞"编辑上下文/偏好"之类的跨会话数据喂给模型，
 *   看着像只是标签，实际是货真价实的访问键：不校验就能把别人项目的编辑标注读进
 *   自己的对话里。
 * 调用入口：storyAgent.chat / storyAgent.mobileChat /
 *   creationAgent.chat / generateNextImage / inpaint。
 * 下游调用：`assertProjectOwner`。
 */
export async function assertOptionalProjectOwner(
  projectId: number | null | undefined,
  userId: number
) {
  if (projectId == null) return null;
  return assertProjectOwner(projectId, userId);
}
