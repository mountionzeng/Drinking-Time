import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import fs from "node:fs";
import path from "node:path";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { localImageDir } from "../services/imageGen";
import { storageGet } from "../storage";
import { getArtRepository } from "../services/artRepository";


function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  // Initialize art reference cache on startup
  const artRepo = getArtRepository();
  artRepo.loadFeaturesCache();

  const app = express();
  app.set("trust proxy", true);
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  app.get("/healthz", (_req, res) => {
    res.status(200).send("ok");
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

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
