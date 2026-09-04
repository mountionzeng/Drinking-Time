import "dotenv/config";
import express from "express";
import { createServer } from "http";
import fs from "node:fs";
import path from "node:path";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { sql } from "drizzle-orm";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { localImageDir } from "../services/imageGen";
import { storageGet } from "../storage";
import {
  getDb,
  getStoryAudioAssetRow,
  getStoryById,
  getVideoTakeById,
} from "../db";
import { resolveManagedAudioPath } from "../services/audioMedia";
import { recoverStaleAudioImports } from "../services/storyAudioImport";
import { localVideoDir } from "../services/videoMedia";
import { renderTransitionVideoFrame } from "../services/videoEndpointFrames";
import { resolveMediaRouteUserId } from "./mediaRouteAuth";
import {
  findAvailablePort,
} from "./portPolicy";
import { validateDevelopmentServerStartup } from "./devServerPreflight";
import { configureHttpConnectionPool } from "./httpConnectionPool";
import {
  fetchStoryAudio,
  isAllowedStoryAudioUrl,
  storyAudioUrl,
} from "../services/storyAudioProxy";
import {
  assertProductionReadiness,
  inspectProductionReadiness,
  productionTrustProxy,
} from "./productionReadiness";
import {
  createHttpsRedirectMiddleware,
  createSecurityHeadersMiddleware,
} from "./securityHeaders";
import { createRequestOriginMiddleware } from "./requestOrigin";

async function verifyProductionDatabaseConnection() {
  if (process.env.NODE_ENV !== "production") return;
  const db = await getDb();
  if (!db) {
    throw new Error("Production readiness failed: shared MySQL is unavailable");
  }
  await db.execute(sql`SELECT 1`);
}

async function startServer() {
  // 先于任何对外请求配置连接池：外部 API 的耗时几乎全在 TLS 握手上，
  // 连接复用能把一次调用从 3–11s 降到 ~0.6s。详见 httpConnectionPool.ts。
  configureHttpConnectionPool();
  assertProductionReadiness(process.env);
  await verifyProductionDatabaseConnection();

  const preferredPort = parseInt(process.env.PORT || "3000");
  if (process.env.NODE_ENV === "development") {
    validateDevelopmentServerStartup({ port: preferredPort });
  }

  const app = express();
  app.set("trust proxy", productionTrustProxy(process.env));
  const server = createServer(app);
  app.use(
    createSecurityHeadersMiddleware({
      isProduction: process.env.NODE_ENV === "production",
      cspMediaOrigins: process.env.CSP_MEDIA_ORIGINS ?? "",
    })
  );
  app.use(
    createHttpsRedirectMiddleware({
      isProduction: process.env.NODE_ENV === "production",
      appOrigin: process.env.APP_ORIGIN ?? "",
    })
  );
  app.use(
    "/api",
    createRequestOriginMiddleware({
      isProduction: process.env.NODE_ENV === "production",
      appOrigin: process.env.APP_ORIGIN ?? "",
    })
  );
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  app.get("/healthz", (_req, res) => {
    res.status(200).send("ok");
  });
  app.get("/readyz", async (_req, res) => {
    const readiness = inspectProductionReadiness(process.env);
    res.setHeader("Cache-Control", "no-store");
    try {
      if (!readiness.ready) throw new Error("invalid production configuration");
      await verifyProductionDatabaseConnection();
      res.status(200).json({
        status: "ready",
        persistence:
          process.env.NODE_ENV === "production" ? "mysql" : "local-development",
        authentication:
          process.env.NODE_ENV === "production" ? "required" : "development",
      });
    } catch {
      res.status(503).json({
        status: "not_ready",
        persistence: "unavailable",
        authentication:
          process.env.NODE_ENV === "production" ? "required" : "development",
      });
    }
  });
  // ── 生成图的同源稳定出口 ─────────────────────────────────────
  // 架构（2026-06-12）：图片字节落在本机共享资产库（LOCAL_IMAGE_DIR），DB 只存
  // /api/images/<file> 这个我们自己拥有的 URL。外部图床/CDN 链接会过期、会被墙、
  // 会 503 —— 它们只做备份，不再出现在展示链路里。
  app.get("/api/images/:file", async (req, res) => {
    const file = String(req.params.file ?? "");
    // 白名单文件名，杜绝路径穿越
    if (!/^[a-zA-Z0-9_-]+\.(png|jpe?g|webp)$/.test(file)) {
      res.status(400).end();
      return;
    }
    const dir = localImageDir();
    const full = path.join(dir, file);
    if (fs.existsSync(full)) {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.sendFile(full);
      return;
    }
    // 本地副本丢失 → 用远程备份按 key 回源，重建本地缓存后流出（仍是同源响应）
    try {
      const base = file.replace(/\.[^.]+$/, "");
      const { url } = await storageGet(`generated/${base}.png`);
      const upstream = await fetch(url);
      if (upstream.ok) {
        const buf = Buffer.from(await upstream.arrayBuffer());
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(full, buf);
        res.setHeader("Content-Type", upstream.headers.get("content-type") ?? "image/png");
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        res.end(buf);
        return;
      }
    } catch (err) {
      console.warn(
        "[/api/images] 远程回源失败：",
        err instanceof Error ? err.message : String(err),
      );
    }
    res.status(404).end();
  });
  // 旧路由兼容：历史数据里存过 /local-images/<file>，继续可用，同样指向共享资产库。
  app.use(
    "/local-images",
    express.static(localImageDir(), {
      maxAge: "7d",
      fallthrough: false,
    }),
  );
  app.get("/api/videos/:file", async (req, res) => {
    const file = String(req.params.file ?? "");
    const match = /^take-(\d+)\.(mp4|webm|mov)$/.exec(file);
    // 成片导出文件：export-<storyId>-<时间戳>.mp4，按故事归属鉴权。
    const exportMatch = /^export-(\d+)-(\d+)\.mp4$/.exec(file);
    if (!match && !exportMatch) {
      res.status(400).end();
      return;
    }
    let userId: number | null = null;
    try {
      userId = await resolveMediaRouteUserId(req);
    } catch {
      res.status(401).end();
      return;
    }
    if (userId == null) {
      res.status(401).end();
      return;
    }
    if (match) {
      const take = await getVideoTakeById(Number(match[1]), userId);
      if (!take || take.videoKey !== file) {
        res.status(404).end();
        return;
      }
    } else if (exportMatch) {
      const story = await getStoryById(Number(exportMatch[1]), userId);
      if (!story) {
        res.status(404).end();
        return;
      }
    }
    const full = path.join(localVideoDir(), file);
    if (!fs.existsSync(full)) {
      res.status(404).end();
      return;
    }
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.sendFile(full);
  });
  // 浏览器直接播放 S3 音频不需要 CORS，但解码真实波形必须读取音频字节。
  // 这里按故事归属和片段 ID 校验后同源转发，绝不接受客户端传入的任意 URL。
  app.get("/api/story-audio/:storyId/:clipId", async (req, res) => {
    const storyId = Number(req.params.storyId);
    const clipId = String(req.params.clipId ?? "");
    if (!Number.isInteger(storyId) || storyId <= 0 || !clipId) {
      res.status(400).end();
      return;
    }
    let userId: number | null = null;
    try {
      userId = await resolveMediaRouteUserId(req);
    } catch {
      res.status(401).end();
      return;
    }
    if (userId == null) {
      res.status(401).end();
      return;
    }
    const story = await getStoryById(storyId, userId);
    const audioUrl = storyAudioUrl(story?.body, clipId);
    if (!audioUrl || !isAllowedStoryAudioUrl(audioUrl)) {
      res.status(404).end();
      return;
    }
    try {
      const upstream = await fetchStoryAudio(audioUrl);
      if (!upstream.ok) {
        res.status(502).end();
        return;
      }
      const contentType = upstream.headers.get("content-type") ?? "audio/mpeg";
      if (!contentType.toLowerCase().startsWith("audio/")) {
        res.status(502).end();
        return;
      }
      const bytes = Buffer.from(await upstream.arrayBuffer());
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "private, max-age=86400");
      res.end(bytes);
    } catch (error) {
      console.warn(
        "[/api/story-audio] 音频回源失败：",
        error instanceof Error ? error.message : String(error)
      );
      res.status(502).end();
    }
  });
  // 受管音频资产（U2）：只按 storyId + assetId 服务，userId 从 session 注入，
  // 服务端重新校验资产属于该 Story 和用户，且已 ready；支持 Range。
  app.get("/api/story-audio-asset/:storyId/:assetId", async (req, res) => {
    const storyId = Number(req.params.storyId);
    const assetId = Number(req.params.assetId);
    if (
      !Number.isInteger(storyId) ||
      storyId <= 0 ||
      !Number.isInteger(assetId) ||
      assetId <= 0
    ) {
      res.status(400).end();
      return;
    }
    let userId: number | null = null;
    try {
      userId = await resolveMediaRouteUserId(req);
    } catch {
      res.status(401).end();
      return;
    }
    if (userId == null) {
      res.status(401).end();
      return;
    }
    const asset = await getStoryAudioAssetRow({ assetId, storyId, userId });
    if (!asset || asset.status !== "ready") {
      res.status(404).end();
      return;
    }
    let full: string;
    try {
      full = resolveManagedAudioPath(asset.storageKey);
    } catch {
      res.status(404).end();
      return;
    }
    if (!fs.existsSync(full)) {
      res.status(404).end();
      return;
    }
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.setHeader("Accept-Ranges", "bytes");
    // express handles the Range header itself for sendFile.
    res.sendFile(full);
  });
  // 聊聊衔接确认卡：从用户有权访问的当前 Take 中抽取精确端点帧。
  // URL 里的时间只用于预览；真正付费提交前会按当前时间轴重新推导并校验。
  app.get("/api/video-frames/:takeId", async (req, res) => {
    const takeId = Number(req.params.takeId);
    const atSec = Number(req.query.atSec);
    const rangeIdRaw = req.query.rangeId;
    const rangeId =
      typeof rangeIdRaw === "string" && rangeIdRaw.trim()
        ? Number(rangeIdRaw)
        : null;
    if (
      !Number.isInteger(takeId) ||
      takeId <= 0 ||
      !Number.isFinite(atSec) ||
      atSec < 0 ||
      (rangeId != null && (!Number.isInteger(rangeId) || rangeId <= 0))
    ) {
      res.status(400).end();
      return;
    }
    let userId: number | null = null;
    try {
      userId = await resolveMediaRouteUserId(req);
    } catch {
      res.status(401).end();
      return;
    }
    if (userId == null) {
      res.status(401).end();
      return;
    }
    try {
      const frame = await renderTransitionVideoFrame({
        takeId,
        userId,
        rangeId,
        atSec,
      });
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.sendFile(frame.path);
    } catch (error) {
      console.warn(
        "[/api/video-frames] 抽帧失败：",
        error instanceof Error ? error.message : String(error)
      );
      res.status(404).end();
    }
  });
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = await findAvailablePort(preferredPort);

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });

  // Best-effort: compensate any audio imports interrupted by a previous crash
  // and sweep stale staging files. Never blocks startup.
  void recoverStaleAudioImports()
    .then(report => {
      if (report.compensatedOperations || report.removedStagingFiles) {
        console.log(
          `[audio-import] 恢复：补偿 ${report.compensatedOperations} 个中断导入，清理 ${report.removedStagingFiles} 个暂存文件`
        );
      }
    })
    .catch(error => {
      console.warn(
        "[audio-import] 启动恢复失败：",
        error instanceof Error ? error.message : String(error)
      );
    });
}

startServer().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
