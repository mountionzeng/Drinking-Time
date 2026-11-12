/**
 * Render profile snapshot: frozen at submission and stored with the task, so
 * recovery and billing read what was actually bought, never the current config.
 * Field reference: /workspace/render-snapshot-fields-20261111.md.
 */
import {
  getRenderProfile,
  quoteRenderProfile,
  RENDER_SNAPSHOT_VERSION,
  type RenderProfileId,
  type RenderProfileSnapshot,
  type RenderQuote,
  type RenderQuoteInput,
  type RenderSnapshotValue,
} from "@shared/renderProfiles";

export { RENDER_SNAPSHOT_VERSION };

export type { RenderProfileSnapshot, RenderSnapshotValue } from "@shared/renderProfiles";

function sanitizeValue(value: unknown): RenderSnapshotValue | undefined {
  if (value == null) return null;
  if (typeof value === "function") return undefined;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.startsWith("data:")) return "[inline-image]";
    if (/^https?:\/\//i.test(value) || value.startsWith("/api/")) return "[url]";
    return value.length > 120 ? `${value.slice(0, 120)}…` : value;
  }
  if (Array.isArray(value)) return `[${value.length} item${value.length === 1 ? "" : "s"}]`;
  return "[object]";
}

export function buildRenderSnapshot(
  profileId: RenderProfileId,
  input: {
    params?: Record<string, unknown>;
    quoteInput?: RenderQuoteInput;
    endpoint?: string;
    baseUrl?: string;
    pollPath?: string;
    model?: string;
    promptChars?: number;
    now?: Date;
  } = {}
): RenderProfileSnapshot {
  const profile = getRenderProfile(profileId);
  const allowed = new Set(profile.allowedParams);
  const params: Record<string, RenderSnapshotValue> = {};
  const ignored: string[] = [];
  for (const [key, value] of Object.entries(input.params ?? {})) {
    if (value === undefined || typeof value === "function") continue;
    if (key === "fetcher" || key === "sleep" || key === "renderProfileId") continue;
    if (!allowed.has(key)) { ignored.push(key); continue; }
    const clean = sanitizeValue(value);
    if (clean !== undefined) params[key] = clean;
  }
  let quote: RenderQuote | null = null;
  let quoteError: string | undefined;
  try {
    quote = quoteRenderProfile(profileId, input.quoteInput ?? {});
  } catch (error) {
    quoteError = error instanceof Error ? error.message : "报价失败";
  }
  const fixedParams: Record<string, RenderSnapshotValue> = {};
  for (const [key, value] of Object.entries(profile.fixedParams)) {
    if (key === "pollPath") continue;
    fixedParams[key] = value;
  }
  const profilePoll = typeof profile.fixedParams.pollPath === "string" ? profile.fixedParams.pollPath : undefined;
  return {
    version: RENDER_SNAPSHOT_VERSION,
    profileId,
    provider: profile.provider,
    model: input.model ?? profile.model,
    endpoint: input.endpoint ?? profile.endpoint,
    ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
    ...((input.pollPath ?? profilePoll) ? { pollPath: input.pollPath ?? profilePoll } : {}),
    fixedParams,
    params,
    ...(ignored.length ? { ignoredParams: ignored.sort() } : {}),
    quote,
    ...(quoteError ? { quoteError } : {}),
    maxPromptChars: profile.maxPromptChars,
    ...(input.promptChars != null ? { promptChars: input.promptChars } : {}),
    outputCount: profile.outputCount,
    submittedAt: (input.now ?? new Date()).toISOString(),
  };
}
