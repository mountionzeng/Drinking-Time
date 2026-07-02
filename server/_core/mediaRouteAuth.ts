import type { Request } from "express";
import { sdk } from "./sdk";

export async function resolveMediaRouteUserId(
  req: Request
): Promise<number | null> {
  try {
    const user = await sdk.authenticateRequest(req);
    return user.id;
  } catch {
    return null;
  }
}
