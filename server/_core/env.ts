import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

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

  // ── fal.ai 图片生成 ──
  falApiKey: process.env.FAL_KEY ?? "",                          // fal.ai API Key

  // ── Google OAuth ──
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",            // Google OAuth Client ID
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",    // Google OAuth Client Secret
  appOrigin: process.env.APP_ORIGIN ?? "",                       // 应用 origin（如 https://example.com）

  // ── Email OTP（Resend）──
  resendApiKey: process.env.RESEND_API_KEY ?? "",                // Resend API Key（用于发送 OTP 邮件）
  resendFromEmail: process.env.RESEND_FROM_EMAIL ?? "noreply@drinking-time.com", // 发件人地址
};
