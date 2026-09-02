import type { CookieOptions, Request } from "express";

function isSecureRequest(req: Request) {
  // Express derives protocol from X-Forwarded-Proto only when the direct peer
  // matches the app's restricted trust-proxy policy. Reading the raw header
  // here would let an untrusted client manufacture a Secure session context.
  return req.protocol === "https";
}

export function getSessionCookieOptions(
  req: Request
): Pick<CookieOptions, "domain" | "httpOnly" | "path" | "sameSite" | "secure"> {
  const secure = isSecureRequest(req);

  return {
    httpOnly: true,
    path: "/",
    // The mobile flow is same-origin, so Lax is sufficient and adds a CSRF
    // boundary without breaking normal top-level navigation back to /m.
    sameSite: "lax",
    secure,
  };
}
