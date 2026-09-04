/**
 * 足迹私密媒体端点（U7）。
 *
 * 单独成文件不是为了整洁，是为了**可测**：留在 `_core/index.ts` 里，测试就
 * 只能启动整个服务器（还会连带拉起提炼 runner 和端口监听）才能碰到这段逻辑，
 * 于是实际上没人会去测它——而这正是整个足迹里唯一直接吐字节的地方。
 */
import type { Express, Request } from "express";
import { resolveMediaRouteUserId } from "./mediaRouteAuth";
import { resolvePersonalMemoryMediaFile } from "../services/personalMemoryTimeline";

export const PERSONAL_MEMORY_MEDIA_PATH = "/api/personal-memory/media/:eventId";

export function registerPersonalMemoryMediaRoute(
  app: Express,
  dependencies: {
    resolveUserId?: (req: Request) => Promise<number | null>;
    resolveFile?: typeof resolvePersonalMemoryMediaFile;
  } = {}
): void {
  const resolveUserId = dependencies.resolveUserId ?? resolveMediaRouteUserId;
  const resolveFile = dependencies.resolveFile ?? resolvePersonalMemoryMediaFile;

  // 为什么不能直接复用 /api/images/<file>：那条路由**不鉴权**，任何拿到文件名
  // 的人都能取到字节。足迹里的图片是用户私密记录，所以这里逐请求校验
  // 「登录身份 → 经历归属 → 图片所属 Story 归属」，通过后**直接送字节**，
  // 绝不 302 到 /api/images——重定向等于把公开地址交到浏览器手上，
  // 前面三层校验就全白做了。URL 里也只出现 eventId，不出现磁盘文件名。
  app.get(PERSONAL_MEMORY_MEDIA_PATH, async (req, res) => {
    const eventId = Number(req.params.eventId);
    if (!Number.isSafeInteger(eventId) || eventId <= 0) {
      res.status(400).end();
      return;
    }
    let userId: number | null = null;
    try {
      userId = await resolveUserId(req);
    } catch {
      res.status(401).end();
      return;
    }
    if (userId == null) {
      res.status(401).end();
      return;
    }
    const resolved = await resolveFile({ userId, eventId });
    if (!resolved.ok) {
      // 「不属于你」和「来源已删除」都回 404：区分它们等于告诉猜 ID 的人
      // 哪些 ID 真实存在。可解释的状态由 personalMemory.resolveSource 给，
      // 那条路径已经确认过调用者就是这条经历的主人。
      res.status(404).end();
      return;
    }
    res.setHeader("Content-Type", resolved.contentType);
    // private：私密图片不得进共享缓存。也不设 immutable——归属随时可能变化，
    // 撤销访问后浏览器不应该继续从磁盘缓存里掏出旧字节。
    res.setHeader("Cache-Control", "private, no-store");
    res.sendFile(resolved.localPath);
  });
}
