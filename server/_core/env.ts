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
};
