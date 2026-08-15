import { z } from "zod";
import {
  MAX_PUBLISHING_PLATFORM_CONTEXT_CANDIDATES,
  normalizePublishingTrendCandidateId,
  normalizePublishingTrendText,
  type PublishingTrendAuthorizationStatus,
  type PublishingTrendCandidate,
  type PublishingTrendPlatformId,
} from "../../../shared/publishingPlatformContext";

export type PlatformTrendProviderManifest = {
  providerId: string;
  providerLabel: string;
  platforms: PublishingTrendPlatformId[];
  authorization: {
    status: PublishingTrendAuthorizationStatus;
    reference: string;
    verifiedAt?: number;
  };
  sourceDocument: string;
  parserVersion: string;
};

export type PlatformTrendProvider = {
  manifest: PlatformTrendProviderManifest;
  fetch(input: {
    platform: PublishingTrendPlatformId;
    locale: string;
    category: string;
    now: number;
    signal: AbortSignal;
  }): Promise<unknown>;
};

export const DEFAULT_PLATFORM_TREND_PROVIDER_TIMEOUT_MS = 10_000;

export type VerifiedPlatformTrendProviderResult = {
  status: "verified";
  providerId: string;
  providerLabel: string;
  authorization: PlatformTrendProviderManifest["authorization"];
  sourceDocument: string;
  parserVersion: string;
  coverage: string;
  fetchedAt: number;
  sourcePublishedAt: number | null;
  expiresAt: number;
  candidates: PublishingTrendCandidate[];
  rawResponse: unknown;
};

export type PlatformTrendProviderResult =
  | VerifiedPlatformTrendProviderResult
  | {
      status: "unavailable" | "provider_error" | "invalid_response";
      providerId: string;
      providerLabel: string;
      authorization: PlatformTrendProviderManifest["authorization"];
      sourceDocument: string;
      parserVersion: string;
      message: string;
    };

const providerResponseSchema = z.object({
  providerId: z.string().trim().min(1).max(120),
  coverage: z.string().trim().min(1).max(500),
  fetchedAt: z.number().int().nonnegative(),
  sourcePublishedAt: z.number().int().nonnegative().nullable(),
  expiresAt: z.number().int().nonnegative(),
  candidates: z.array(z.object({
    id: z.string().trim().min(1).max(160),
    label: z.string().trim().min(1).max(200),
    sourcePublishedAt: z.number().int().nonnegative().nullable(),
  }).strict()).max(MAX_PUBLISHING_PLATFORM_CONTEXT_CANDIDATES),
}).strict();

function verifiedAuthorization(status: PublishingTrendAuthorizationStatus): boolean {
  return status === "official" || status === "contract_authorized";
}

function unavailableResult(
  manifest: PlatformTrendProviderManifest,
  status: "unavailable" | "provider_error" | "invalid_response",
  message: string
): Exclude<PlatformTrendProviderResult, VerifiedPlatformTrendProviderResult> {
  return {
    status,
    providerId: manifest.providerId,
    providerLabel: manifest.providerLabel,
    authorization: structuredClone(manifest.authorization),
    sourceDocument: manifest.sourceDocument,
    parserVersion: manifest.parserVersion,
    message,
  };
}

async function readPlatformTrendProviderOnce(
  provider: PlatformTrendProvider,
  input: {
    platform: PublishingTrendPlatformId;
    locale: string;
    category: string;
    now: number;
    timeoutMs?: number;
  }
): Promise<PlatformTrendProviderResult> {
  const manifest = provider.manifest;
  if (
    !manifest.platforms.includes(input.platform) ||
    !verifiedAuthorization(manifest.authorization.status) ||
    !manifest.authorization.reference.trim() ||
    !manifest.authorization.verifiedAt ||
    !manifest.sourceDocument.trim() ||
    !manifest.parserVersion.trim()
  ) {
    return unavailableResult(
      manifest,
      "unavailable",
      "未获得可验证的平台趋势授权与当期接口资料"
    );
  }
  let rawResponse: unknown;
  const controller = new AbortController();
  const timeoutMs = Math.max(
    1,
    Math.min(input.timeoutMs ?? DEFAULT_PLATFORM_TREND_PROVIDER_TIMEOUT_MS, 60_000)
  );
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    rawResponse = await Promise.race([
      provider.fetch({
        platform: input.platform,
        locale: input.locale,
        category: input.category,
        now: input.now,
        signal: controller.signal,
      }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error(`趋势来源请求超过 ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    return unavailableResult(
      manifest,
      "provider_error",
      error instanceof Error ? error.message.slice(0, 300) : "趋势来源请求失败"
    );
  } finally {
    if (timeout) clearTimeout(timeout);
  }
  const parsed = providerResponseSchema.safeParse(rawResponse);
  if (!parsed.success || parsed.data.providerId !== manifest.providerId) {
    return unavailableResult(
      manifest,
      "invalid_response",
      "趋势来源响应结构与已验证 parser 不一致"
    );
  }
  const impossibleTimestamps =
    (manifest.authorization.verifiedAt ?? 0) > input.now ||
    parsed.data.fetchedAt > input.now ||
    parsed.data.sourcePublishedAt === null ||
    parsed.data.sourcePublishedAt > parsed.data.fetchedAt ||
    parsed.data.expiresAt <= parsed.data.fetchedAt ||
    parsed.data.candidates.some(candidate =>
      candidate.sourcePublishedAt !== null &&
      candidate.sourcePublishedAt > parsed.data.fetchedAt
    );
  const candidateIds = parsed.data.candidates.map(candidate =>
    normalizePublishingTrendCandidateId(candidate.id)
  );
  const invalidCandidateContent = parsed.data.candidates.some((candidate, index) =>
    !candidateIds[index] || !normalizePublishingTrendText(candidate.label)
  );
  if (
    impossibleTimestamps ||
    invalidCandidateContent ||
    new Set(candidateIds).size !== candidateIds.length
  ) {
    return unavailableResult(
      manifest,
      "invalid_response",
      "趋势来源时间戳或候选身份无法通过校验"
    );
  }
  const candidates = parsed.data.candidates.flatMap(candidate => {
    const id = normalizePublishingTrendCandidateId(candidate.id);
    const label = normalizePublishingTrendText(candidate.label);
    return id && label
      ? [{ id, label, sourcePublishedAt: candidate.sourcePublishedAt }]
      : [];
  });
  return {
    status: "verified",
    providerId: manifest.providerId,
    providerLabel: manifest.providerLabel,
    authorization: structuredClone(manifest.authorization),
    sourceDocument: manifest.sourceDocument,
    parserVersion: manifest.parserVersion,
    coverage: normalizePublishingTrendText(parsed.data.coverage, 500),
    fetchedAt: parsed.data.fetchedAt,
    sourcePublishedAt: parsed.data.sourcePublishedAt,
    expiresAt: parsed.data.expiresAt,
    candidates,
    rawResponse,
  };
}

const inFlightProviderReads = new WeakMap<
  PlatformTrendProvider,
  Map<string, Promise<PlatformTrendProviderResult>>
>();

export function readPlatformTrendProvider(
  provider: PlatformTrendProvider,
  input: {
    platform: PublishingTrendPlatformId;
    locale: string;
    category: string;
    now: number;
    timeoutMs?: number;
  }
): Promise<PlatformTrendProviderResult> {
  let providerReads = inFlightProviderReads.get(provider);
  if (!providerReads) {
    providerReads = new Map();
    inFlightProviderReads.set(provider, providerReads);
  }
  const key = JSON.stringify({
    providerId: provider.manifest.providerId,
    parserVersion: provider.manifest.parserVersion,
    platform: input.platform,
    locale: input.locale,
    category: input.category,
  });
  const existing = providerReads.get(key);
  if (existing) return existing;
  const request = readPlatformTrendProviderOnce(provider, input);
  providerReads.set(key, request);
  const cleanup = () => {
    if (providerReads?.get(key) === request) providerReads.delete(key);
  };
  void request.then(cleanup, cleanup);
  return request;
}
