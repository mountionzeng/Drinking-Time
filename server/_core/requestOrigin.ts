import type { RequestHandler } from "express";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function normalizedOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function decideRequestOrigin(input: {
  isProduction: boolean;
  appOrigin: string;
  method: string;
  origin: string | undefined;
}): {
  allowed: boolean;
  reason: "development" | "safe_method" | "trusted_origin" | "invalid_origin";
} {
  if (!input.isProduction) return { allowed: true, reason: "development" };
  if (SAFE_METHODS.has(input.method.toUpperCase())) {
    return { allowed: true, reason: "safe_method" };
  }
  const expected = normalizedOrigin(input.appOrigin);
  const actual = input.origin ? normalizedOrigin(input.origin) : null;
  if (expected && actual === expected) {
    return { allowed: true, reason: "trusted_origin" };
  }
  return { allowed: false, reason: "invalid_origin" };
}

export function createRequestOriginMiddleware(input: {
  isProduction: boolean;
  appOrigin: string;
}): RequestHandler {
  return (req, res, next) => {
    const decision = decideRequestOrigin({
      ...input,
      method: req.method,
      origin: req.get("origin"),
    });
    if (!decision.allowed) {
      res.status(403).json({ error: "invalid_origin" });
      return;
    }
    next();
  };
}
