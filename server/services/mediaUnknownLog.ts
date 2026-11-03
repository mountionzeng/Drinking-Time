/** Structured diagnostics for "result unknown" media calls: HTTP status, response type, elapsed time. */
export type MediaCallDiagnostics = {
  kind: string;
  startedAt: number;
  httpStatus: number | null;
  contentType: string | null;
};

export function startMediaDiagnostics(kind: string, now = Date.now()): MediaCallDiagnostics {
  return { kind, startedAt: now, httpStatus: null, contentType: null };
}

/** Wrap a fetch so the last response's status and content-type are recorded. */
export function trackMediaResponse<F extends (...args: never[]) => Promise<Response>>(fetcher: F, diag: MediaCallDiagnostics): F {
  return (async (...args: Parameters<F>) => {
    const response = await fetcher(...args);
    diag.httpStatus = response.status;
    diag.contentType = response.headers?.get?.("content-type") ?? null;
    return response;
  }) as F;
}

export function mediaUnknownRecord(diag: MediaCallDiagnostics, reason: string, now = Date.now()) {
  return {
    kind: diag.kind,
    httpStatus: diag.httpStatus, // null = no response at all (timeout / connection dropped)
    contentType: diag.contentType,
    elapsedMs: now - diag.startedAt,
    reason,
  };
}

export function logMediaUnknown(diag: MediaCallDiagnostics, reason: string, log: (msg: string, extra: unknown) => void = console.warn) {
  log("[media-unknown] provider result unknown", mediaUnknownRecord(diag, reason));
}
