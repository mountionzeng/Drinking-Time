import type { RequestHandler } from "express";

export function parseCspMediaOrigins(value: string): string[] {
  const candidates = value.split(/[\s,]+/).filter(Boolean);
  if (candidates.length === 0) {
    throw new Error("CSP_MEDIA_ORIGINS must contain explicit HTTPS origins");
  }
  const origins = candidates.map(candidate => {
    if (candidate.includes("*") || candidate.includes("'")) {
      throw new Error("CSP_MEDIA_ORIGINS cannot contain wildcards or directives");
    }
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      throw new Error(`CSP_MEDIA_ORIGINS contains an invalid URL: ${candidate}`);
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      throw new Error(
        `CSP_MEDIA_ORIGINS must use origin-only HTTPS values: ${candidate}`
      );
    }
    return url.origin;
  });
  return [...new Set(origins)];
}

export function buildSecurityHeaders(input: {
  isProduction: boolean;
  secureRequest: boolean;
  cspMediaOrigins: string;
}): Record<string, string> {
  const headers: Record<string, string> = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), geolocation=(), microphone=()",
    "X-Frame-Options": "DENY",
  };
  if (!input.isProduction) return headers;

  const mediaOrigins = parseCspMediaOrigins(input.cspMediaOrigins).join(" ");
  headers["Content-Security-Policy"] = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    `img-src 'self' data: blob: ${mediaOrigins}`,
    `media-src 'self' blob: ${mediaOrigins}`,
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "upgrade-insecure-requests",
  ].join("; ");
  if (input.secureRequest) {
    headers["Strict-Transport-Security"] =
      "max-age=31536000; includeSubDomains";
  }
  return headers;
}

export function createSecurityHeadersMiddleware(input: {
  isProduction: boolean;
  cspMediaOrigins: string;
}): RequestHandler {
  return (req, res, next) => {
    const headers = buildSecurityHeaders({
      ...input,
      secureRequest: req.protocol === "https",
    });
    for (const [name, value] of Object.entries(headers)) {
      res.setHeader(name, value);
    }
    next();
  };
}

export function createHttpsRedirectMiddleware(input: {
  isProduction: boolean;
  appOrigin: string;
}): RequestHandler {
  return (req, res, next) => {
    if (
      !input.isProduction ||
      req.protocol === "https" ||
      req.path === "/healthz" ||
      req.path === "/readyz"
    ) {
      next();
      return;
    }
    res.redirect(308, new URL(req.originalUrl || "/", input.appOrigin).toString());
  };
}
