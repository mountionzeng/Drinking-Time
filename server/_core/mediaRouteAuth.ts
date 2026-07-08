import type { Request } from "express";
import { getUserByOpenId } from "../db";
import { sdk } from "./sdk";

export async function resolveMediaRouteUserId(
  req: Request
): Promise<number | null> {
  // 与 context.ts 的固定身份逻辑保持一致：本机开发时媒体路由也解析成同一个
  // 用户，否则浏览器换了 cookie 后 tRPC 能读到故事、视频却全部 401/404。
  const fixedOpenId = process.env.DEV_FIXED_GUEST_OPEN_ID?.trim();
  if (fixedOpenId && process.env.NODE_ENV !== "production") {
    const user = await getUserByOpenId(fixedOpenId);
    if (user) return user.id;
  }
  try {
    const user = await sdk.authenticateRequest(req);
    return user.id;
  } catch {
    return null;
  }
}
