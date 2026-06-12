import "dotenv/config";
import express, { type Request } from "express";
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
import { buildArchiveAnalysisShell } from "../archive/analysisShell";
import { replyFromDropZoneAgent } from "../archive/dropZoneAgent";
import {
  replyFromStoryAgent,
  synthesizeShotList,
  summarizeHistory,
} from "../archive/storyAgent";
import { analyzeVisionReference } from "../archive/visionAgent";
import {
  listUserStories,
  getStoryById,
  createStory,
  updateStory,
  deleteStory,
} from "../db";
import { sdk } from "./sdk";

const authDisabled =
  process.env.DISABLE_AUTH === "true" ||
  process.env.NODE_ENV !== "production";

// 从 request 中解析当前用户 ID，dev 模式返回 1（guest）
async function getRequestUserId(req: Request): Promise<number> {
  if (authDisabled) return 1;
  try {
    const user = await sdk.authenticateRequest(req);
    return user.id;
  } catch {
    return 1;
  }
}

// 把 stories 表里允许 iframe 写的字段串成一个白名单，防 mass-assignment
type StoryWritePatch = {
  title?: string;
  logline?: string | null;
  theme?: string | null;
  arc?: string | null;
  summary?: string | null;
  projectId?: number | null;
  body?: unknown;
};

function pickStoryPatch(raw: unknown): StoryWritePatch {
  if (!raw || typeof raw !== "object") return {};
  const obj = raw as Record<string, unknown>;
  const patch: StoryWritePatch = {};
  if (typeof obj.title === "string") patch.title = obj.title.trim().slice(0, 255) || "未命名";
  // logline/theme/arc/summary 是 text 列，允许空字符串清空
  if (typeof obj.logline === "string") patch.logline = obj.logline;
  if (typeof obj.theme === "string") patch.theme = obj.theme;
  if (typeof obj.arc === "string") patch.arc = obj.arc;
  if (typeof obj.summary === "string") patch.summary = obj.summary;
  if (typeof obj.projectId === "number") patch.projectId = obj.projectId;
  else if (obj.projectId === null) patch.projectId = null;
  if (obj.body !== undefined && obj.body !== null && typeof obj.body === "object") {
    patch.body = obj.body;
  }
  return patch;
}

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
  app.get("/api/archive/analysis-shell", async (req, res) => {
    try {
      void req;
      const payload = await buildArchiveAnalysisShell(1);
      res.setHeader("Cache-Control", "no-store");
      res.json(payload);
    } catch (error) {
      console.error("[archive-shell] failed to build analysis shell:", error);
      res.status(500).json({ error: "Failed to build analysis shell" });
    }
  });
  app.post("/api/archive/drop-zone-chat", async (req, res) => {
    try {
      const body = req.body ?? {};
      const message = typeof body.message === "string" ? body.message : "";
      if (!message.trim()) {
        res.status(400).json({ error: "message is required" });
        return;
      }

      const history = Array.isArray(body.history)
        ? body.history
            .filter((turn: unknown) => {
              if (!turn || typeof turn !== "object") return false;
              const role = (turn as { role?: unknown }).role;
              const content = (turn as { content?: unknown }).content;
              return (
                (role === "user" || role === "assistant") &&
                typeof content === "string"
              );
            })
            .map((turn: { role: "user" | "assistant"; content: string }) => ({
              role: turn.role,
              content: turn.content,
            }))
        : [];

      const userId = await getRequestUserId(req);
      const result = await replyFromDropZoneAgent({
        userId,
        message,
        history,
        projectId: typeof body.projectId === "string" ? body.projectId : undefined,
        stageKey: typeof body.stageKey === "string" ? body.stageKey : undefined,
      });

      res.setHeader("Cache-Control", "no-store");
      res.json(result);
    } catch (error) {
      console.error("[drop-zone-chat] failed:", error);
      const message =
        error instanceof Error ? error.message : "Unknown LLM error";
      res.status(500).json({
        configured: false,
        modelLabel: "请求失败",
        reply: `工坊这次没有连上模型接口。\n原因：${message}\n请先检查 API 地址、Key 和模型名是否正确。`,
      });
    }
  });
  // ── Story Guide Agent (chat) ──────────────────────────────────────
  app.post("/api/archive/story-agent-chat", async (req, res) => {
    try {
      const body = req.body ?? {};
      const message = typeof body.message === "string" ? body.message : "";
      if (!message.trim()) {
        res.status(400).json({ error: "message is required" });
        return;
      }

      const history = Array.isArray(body.history)
        ? body.history
            .filter((turn: unknown) => {
              if (!turn || typeof turn !== "object") return false;
              const role = (turn as { role?: unknown }).role;
              const content = (turn as { content?: unknown }).content;
              return (
                (role === "user" || role === "assistant") &&
                typeof content === "string"
              );
            })
            .map((turn: { role: "user" | "assistant"; content: string }) => ({
              role: turn.role,
              content: turn.content,
            }))
        : [];

      const existingCardCount =
        typeof body.existingCardCount === "number"
          ? body.existingCardCount
          : 0;

      const summary =
        typeof body.summary === "string" ? body.summary.trim() : undefined;

      const similarCards = Array.isArray(body.similarCards)
        ? body.similarCards
            .filter((c: unknown) => c && typeof c === "object")
            .map((raw: Record<string, unknown>) => {
              const str = (v: unknown): string =>
                typeof v === "string" ? v.trim() : "";
              return {
                content: str(raw.content),
                rawText: str(raw.rawText) || undefined,
                emotion: str(raw.emotion) || undefined,
                emotionBlend: Array.isArray(raw.emotionBlend)
                  ? raw.emotionBlend.filter((v): v is string => typeof v === "string").slice(0, 4)
                  : undefined,
                retrievalQuery: str(raw.retrievalQuery) || undefined,
                themeHints: Array.isArray(raw.themeHints)
                  ? raw.themeHints.filter((v): v is string => typeof v === "string").slice(0, 4)
                  : undefined,
                personalTrace: str(raw.personalTrace) || undefined,
                score:
                  typeof raw.score === "number" && Number.isFinite(raw.score)
                    ? Math.max(0, Math.min(1, raw.score))
                    : undefined,
              };
            })
            .filter((c: { content: string }) => c.content)
            .slice(0, 3)
        : [];

      // 镜头表草稿——多向量上下文。前端送 11 列 + shotNo；服务端再校验一遍只取已知字段。
      const currentShots = Array.isArray(body.currentShots)
        ? body.currentShots
            .filter((s: unknown) => s && typeof s === "object")
            .map((raw: Record<string, unknown>) => {
              const str = (v: unknown): string =>
                typeof v === "string" ? v.trim() : "";
              return {
                shotNo:
                  typeof raw.shotNo === "number" ? raw.shotNo : 0,
                subject: str(raw.subject),
                action: str(raw.action),
                dialogue: str(raw.dialogue),
                shotType: str(raw.shotType),
                cameraAngle: str(raw.cameraAngle),
                cameraMove: str(raw.cameraMove),
                location: str(raw.location),
                timeLight: str(raw.timeLight),
                mood: str(raw.mood),
                sound: str(raw.sound),
                styleRef: str(raw.styleRef),
              };
            })
            .filter((s: { shotNo: number }) => s.shotNo > 0)
        : [];

      const result = await replyFromStoryAgent({
        message,
        history,
        existingCardCount,
        summary,
        currentShots,
        similarCards,
      });

      res.setHeader("Cache-Control", "no-store");
      res.json(result);
    } catch (error) {
      console.error("[story-agent-chat] failed:", error);
      const message =
        error instanceof Error ? error.message : "Unknown LLM error";
      res.status(500).json({
        configured: false,
        modelLabel: "请求失败",
        reply: `小酌没接上模型。\n原因：${message}`,
        card: null,
      });
    }
  });

  // ── Vision Agent: analyze one visual reference into film-art parameters ─
  app.post("/api/archive/vision-analyze", async (req, res) => {
    try {
      const body = req.body ?? {};
      const imageDataUrl =
        typeof body.imageDataUrl === "string" ? body.imageDataUrl : undefined;
      const imageUrl =
        typeof body.imageUrl === "string" ? body.imageUrl : undefined;
      const fileName =
        typeof body.fileName === "string" ? body.fileName.slice(0, 255) : undefined;
      const brief =
        typeof body.brief === "string" ? body.brief.trim().slice(0, 2000) : undefined;

      const result = await analyzeVisionReference({
        imageDataUrl,
        imageUrl,
        fileName,
        brief,
      });

      res.setHeader("Cache-Control", "no-store");
      res.json(result);
    } catch (error) {
      console.error("[vision-analyze] failed:", error);
      const message =
        error instanceof Error ? error.message : "Unknown vision analysis error";
      res.status(500).json({
        configured: false,
        modelLabel: "视觉分析失败",
        reply: `这张图暂时没有分析成功。\n原因：${message}`,
        error: message,
      });
    }
  });

  // ── Story Guide Agent (synthesize: characters + arc + shot list) ───
  app.post("/api/archive/story-agent-classify", async (req, res) => {
    try {
      const body = req.body ?? {};
      const cards = Array.isArray(body.cards)
        ? body.cards
            .filter((c: unknown) => {
              if (!c || typeof c !== "object") return false;
              const obj = c as Record<string, unknown>;
              return typeof obj.content === "string";
            })
            .map((c: Record<string, unknown>) => ({
              content: String(c.content),
              rawText: typeof c.rawText === "string" ? c.rawText : undefined,
              sourceQuote: typeof c.sourceQuote === "string" ? c.sourceQuote : undefined,
              emotion: typeof c.emotion === "string" ? c.emotion : undefined,
              emotionOptions: Array.isArray(c.emotionOptions)
                ? c.emotionOptions.filter((v): v is string => typeof v === "string")
                : undefined,
              emotionBlend: Array.isArray(c.emotionBlend)
                ? c.emotionBlend.filter((v): v is string => typeof v === "string")
                : undefined,
              intensity: typeof c.intensity === "number" ? c.intensity : undefined,
              direction: typeof c.direction === "string" ? c.direction : undefined,
              complexity: typeof c.complexity === "string" ? c.complexity : undefined,
              trigger: typeof c.trigger === "string" ? c.trigger : undefined,
              dramaticFunction: typeof c.dramaticFunction === "string" ? c.dramaticFunction : undefined,
              personalTrace: typeof c.personalTrace === "string" ? c.personalTrace : undefined,
              retrievalQuery: typeof c.retrievalQuery === "string" ? c.retrievalQuery : undefined,
              themeHints: Array.isArray(c.themeHints)
                ? c.themeHints.filter((v): v is string => typeof v === "string")
                : undefined,
              outlierSignal: typeof c.outlierSignal === "string" ? c.outlierSignal : undefined,
              softMembership: Array.isArray(c.softMembership)
                ? c.softMembership.filter((v): v is string => typeof v === "string")
                : undefined,
            }))
        : [];

      const characterHint =
        typeof body.characterHint === "string"
          ? body.characterHint.trim().slice(0, 80)
          : undefined;

      const result = await synthesizeShotList({ cards, characterHint });
      res.setHeader("Cache-Control", "no-store");
      res.json(result);
    } catch (error) {
      console.error("[story-agent-classify] failed:", error);
      const message =
        error instanceof Error ? error.message : "Unknown LLM error";
      res.status(500).json({
        configured: false,
        modelLabel: "请求失败",
        error: `创作素材整理失败：${message}`,
      });
    }
  });

  // ── Story Guide Agent (compress old turns into a working note) ────
  app.post("/api/archive/story-agent-summarize", async (req, res) => {
    try {
      const body = req.body ?? {};
      const priorSummary =
        typeof body.priorSummary === "string" ? body.priorSummary : undefined;

      const turnsToAbsorb = Array.isArray(body.turnsToAbsorb)
        ? body.turnsToAbsorb
            .filter((turn: unknown) => {
              if (!turn || typeof turn !== "object") return false;
              const role = (turn as { role?: unknown }).role;
              const content = (turn as { content?: unknown }).content;
              return (
                (role === "user" || role === "assistant") &&
                typeof content === "string"
              );
            })
            .map((turn: { role: "user" | "assistant"; content: string }) => ({
              role: turn.role,
              content: turn.content,
            }))
        : [];

      const result = await summarizeHistory({ priorSummary, turnsToAbsorb });
      res.setHeader("Cache-Control", "no-store");
      res.json(result);
    } catch (error) {
      console.error("[story-agent-summarize] failed:", error);
      const message =
        error instanceof Error ? error.message : "Unknown LLM error";
      res.status(500).json({
        configured: false,
        modelLabel: "请求失败",
        error: `历史压缩失败：${message}`,
      });
    }
  });

  // ── Stories: 持久化 drinking-time 工坊的故事/镜头表 ───────────────
  // iframe 是静态 HTML，吃不了 tRPC client，所以这里走 REST。返回 shape 跟
  // iframe 原本 localStorage 存的对象保持兼容，前端切换时只需替换 IO 层
  app.get("/api/archive/stories", async (req, res) => {
    try {
      const userId = await getRequestUserId(req);
      const items = await listUserStories(userId);
      res.setHeader("Cache-Control", "no-store");
      res.json({ stories: items });
    } catch (error) {
      console.error("[stories.list] failed:", error);
      res.status(500).json({ error: "Failed to list stories" });
    }
  });

  app.get("/api/archive/stories/:id", async (req, res) => {
    try {
      const userId = await getRequestUserId(req);
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        res.status(400).json({ error: "invalid id" });
        return;
      }
      const story = await getStoryById(id, userId);
      if (!story) {
        res.status(404).json({ error: "story not found" });
        return;
      }
      res.setHeader("Cache-Control", "no-store");
      res.json(story);
    } catch (error) {
      console.error("[stories.get] failed:", error);
      res.status(500).json({ error: "Failed to load story" });
    }
  });

  // POST 既是 create（无 id）也是 full upsert（有 id）。
  // 单字段 PATCH 暂时不做：iframe 那边本来就是「整故事 blob 写盘」的语义
  app.post("/api/archive/stories", async (req, res) => {
    try {
      const userId = await getRequestUserId(req);
      const body = req.body ?? {};
      const patch = pickStoryPatch(body);
      const id = typeof body.id === "number" ? body.id : null;

      const title = patch.title || "未命名";

      if (id) {
        const existing = await getStoryById(id, userId);
        if (!existing) {
          res.status(404).json({ error: "story not found" });
          return;
        }
        await updateStory(id, userId, { ...patch, title });
        const fresh = await getStoryById(id, userId);
        res.setHeader("Cache-Control", "no-store");
        res.json(fresh);
        return;
      }

      const { id: newId } = await createStory({
        userId,
        projectId: patch.projectId ?? null,
        title,
        logline: patch.logline ?? null,
        theme: patch.theme ?? null,
        arc: patch.arc ?? null,
        summary: patch.summary ?? null,
        body: (patch.body ?? { cards: [], characters: [], shots: [] }) as object,
      });
      const fresh = await getStoryById(newId, userId);
      res.setHeader("Cache-Control", "no-store");
      res.status(201).json(fresh);
    } catch (error) {
      console.error("[stories.upsert] failed:", error);
      res.status(500).json({ error: "Failed to save story" });
    }
  });

  app.delete("/api/archive/stories/:id", async (req, res) => {
    try {
      const userId = await getRequestUserId(req);
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        res.status(400).json({ error: "invalid id" });
        return;
      }
      await deleteStory(id, userId);
      res.setHeader("Cache-Control", "no-store");
      res.json({ ok: true });
    } catch (error) {
      console.error("[stories.delete] failed:", error);
      res.status(500).json({ error: "Failed to delete story" });
    }
  });

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
