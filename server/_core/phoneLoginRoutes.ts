import type { Express, Request, Response } from "express";
import { phoneSmsConfigured } from "../services/phoneSms";
import {
  PhoneLoginError,
  requestPhoneLoginCode,
  verifyPhoneLoginCode,
} from "../services/phoneLogin";

export function registerPhoneLoginRoutes(
  app: Express,
  establishSession: (
    req: Request,
    res: Response,
    userId: number
  ) => Promise<void>
) {
  app.get("/api/auth/phone/config", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ configured: phoneSmsConfigured() });
  });
  const endpoint =
    (run: (req: Request, res: Response) => Promise<void>) =>
    async (req: Request, res: Response) => {
      res.setHeader("Cache-Control", "no-store");
      try {
        await run(req, res);
      } catch (error) {
        if (error instanceof PhoneLoginError) {
          if (error.retryAfterMs)
            res.setHeader(
              "Retry-After",
              String(Math.ceil(error.retryAfterMs / 1000))
            );
          res
            .status(error.status)
            .json({
              error: error.code,
              ...(error.retryAfterMs
                ? { retryAfterMs: error.retryAfterMs }
                : {}),
            });
        } else res.status(503).json({ error: "phone_login_unavailable" });
      }
    };
  app.post(
    "/api/auth/phone/request",
    endpoint(async (req, res) => {
      res.json(
        await requestPhoneLoginCode(
          req.body?.phone,
          req.ip || req.socket.remoteAddress || "unknown"
        )
      );
    })
  );
  app.post(
    "/api/auth/phone/verify",
    endpoint(async (req, res) => {
      const userId = await verifyPhoneLoginCode(
        req.body?.phone,
        req.body?.code,
        req.ip || req.socket.remoteAddress || "unknown"
      );
      await establishSession(req, res, userId);
      res.json({ ok: true });
    })
  );
}
