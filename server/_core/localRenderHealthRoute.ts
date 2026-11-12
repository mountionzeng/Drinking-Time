import type { Request, Response } from "express";
import { imageProviderHealthSnapshot } from "../services/imageProviderHealth";

function isLoopback(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

/**
 * Process-local circuit-breaker state for the render self-check. Development
 * only and loopback only; returns provider/model keys and timestamps, never
 * credentials or prompts.
 */
export function localRenderHealthRoute(req: Request, res: Response) {
  if (process.env.NODE_ENV === "production" || !isLoopback(req.socket.remoteAddress)) {
    res.status(404).end();
    return;
  }
  res.json({ imageProviderHealth: imageProviderHealthSnapshot(), pid: process.pid });
}
