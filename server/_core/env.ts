import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { normalizeImageProvider } from "@shared/imageProvider";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

// PM2/SSH 部署时 process.cwd() 可能不是项目根目录，所以这里补读源码态与 dist 态的 .env。
dotenv.config();
dotenv.config({ path: path.resolve(moduleDir, "../../.env") });
dotenv.config({ path: path.resolve(moduleDir, "../.env") });

export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",

  // ── 大模型相关配置 ──
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",       // 大模型 API 地址（OpenAI 兼容格式）
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",       // 大模型 API 密钥
  llmModel: process.env.LLM_MODEL ?? "gemini-2.5-flash",      // 默认使用的模型名称
  llmSupportsImage: process.env.LLM_SUPPORTS_IMAGE === "true", // 模型是否支持图片输入
  llmSupportsResponseFormat: process.env.LLM_SUPPORTS_RESPONSE_FORMAT !== "false", // 模型是否支持 structured output
  voiceTranscriptionModel: process.env.VOICE_TRANSCRIPTION_MODEL ?? "whisper-1", // 语音转文字模型

  // ── DROP ZONE 聊天 Agent 专用配置 ──
  dropZoneApiUrl: process.env.DROP_ZONE_API_URL ?? "",         // 聊天 Agent 单独的 API 地址（可选，不填则用 forgeApiUrl）
  dropZoneModel: process.env.DROP_ZONE_MODEL ?? "",            // 聊天 Agent 单独的模型（可选）

  // ── 视觉分析 Agent 专用配置 ──
  visionApiUrl: process.env.VISION_API_URL ?? "",               // 视觉模型 API 地址（可选，不填则复用 DROP_ZONE/forge）
  visionModel: process.env.VISION_MODEL ?? "",                  // 视觉模型名称（可选，不填则复用 DROP_ZONE/LLM）

  // ── 老黄历 API 配置 ──
  huangliProvider: process.env.HUANGLI_PROVIDER ?? "",          // tianapi / jisu，默认由 key 推断
  huangliApiKey: process.env.HUANGLI_API_KEY ?? "",             // 通用老黄历 API Key
  tianapiKey: process.env.TIANAPI_KEY ?? "",                    // 天行数据 Key（可选，优先于通用 key）
  jisuapiAppKey: process.env.JISUAPI_APPKEY ?? "",              // 极速数据 AppKey（可选，优先于通用 key）
  huangliApiBaseUrl: process.env.HUANGLI_API_BASE_URL ?? "",    // 测试或私有代理覆盖
  huangliTimeoutMs: process.env.HUANGLI_TIMEOUT_MS ?? "5000",

  // ── 流派库 ──
  styleLibraryDir: process.env.STYLE_LIBRARY_DIR ?? "",          // 流派库 entries 目录覆盖（默认 docs/style-library/entries，相对 cwd）

  // ── 生成图本地资产库 ──
  // 所有端口/工作树共享的同一个绝对目录；空值回退 <cwd>/.webdev/images。
  // 图片字节落在这里，对外只暴露同源稳定路由 /api/images/<file>。
  localImageDir: process.env.LOCAL_IMAGE_DIR ?? "",

  // ── fal.ai 图片生成 ──
  falApiKey: process.env.FAL_KEY ?? "",                          // fal.ai API Key

  // ── 302.ai 图片生成（不填 API Key 时自动回退 fal）──
  imageProviderDefault: normalizeImageProvider(process.env.IMAGE_PROVIDER_DEFAULT, "midjourney"), // 默认出图 provider：fal / gpt-image / midjourney（产品主力 = MJ Turbo，没配时默认走 MJ）
  api302Key: process.env.API302_KEY ?? process.env.IMAGE_302_API_KEY ?? "", // 302.ai API Key，图片生成专用；不写进代码
  api302BaseUrl: process.env.API302_BASE_URL ?? process.env.IMAGE_302_BASE_URL ?? "https://api.302.ai", // 302.ai 网关地址
  image302GptModel: process.env.IMAGE_302_GPT_MODEL ?? "gpt-image-1.5", // GPT-image 模型，按 302 控制台可用模型填写
  image302GptSize: process.env.IMAGE_302_GPT_SIZE ?? "1024x1024", // GPT-image 默认尺寸
  image302GptQuality: process.env.IMAGE_302_GPT_QUALITY ?? "high", // GPT-image 默认质量
  image302MjAuthHeader: process.env.IMAGE_302_MJ_AUTH_HEADER ?? "bearer", // Midjourney 鉴权：bearer 或 mj-api-secret
  image302DraftModel: process.env.IMAGE_302_DRAFT_MODEL ?? "flux-schnell", // 双轨出图的快轨模型（302 /302/submit/<model>，5-10s 草稿小样）
  image302MjPollMs: process.env.IMAGE_302_MJ_POLL_MS ?? "2000", // Midjourney 轮询间隔（出完尽快发现，省平均 ~2s）
  image302MjSubmitTimeoutMs: process.env.IMAGE_302_MJ_SUBMIT_TIMEOUT_MS ?? "90000", // Midjourney submit 单次请求上限（区别于任务轮询总时长）
  image302MjTimeoutMs: process.env.IMAGE_302_MJ_TIMEOUT_MS ?? "180000", // Midjourney 总等待上限

  // ── 302.ai 视觉分析（不填模型或 Key 时回退原视觉通道）──
  vision302ApiKey: process.env.VISION_302_API_KEY ?? process.env.API302_KEY ?? "", // 302.ai 视觉模型 API Key
  vision302BaseUrl: process.env.VISION_302_BASE_URL ?? process.env.API302_BASE_URL ?? "https://api.302.ai", // 302.ai 视觉网关地址
  vision302Model: process.env.VISION_302_MODEL ?? "", // 302.ai 视觉模型，如 gemini-3-pro-preview

  // ── Google OAuth ──
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",            // Google OAuth Client ID
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",    // Google OAuth Client Secret
  appOrigin: process.env.APP_ORIGIN ?? "",                       // 应用 origin（如 https://example.com）

  // ── Email OTP（Resend）──
  resendApiKey: process.env.RESEND_API_KEY ?? "",                // Resend API Key（用于发送 OTP 邮件）
  resendFromEmail: process.env.RESEND_FROM_EMAIL ?? "noreply@drinking-time.com", // 发件人地址
};
