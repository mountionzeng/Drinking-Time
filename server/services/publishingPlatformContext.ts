import { createHash } from "node:crypto";
import {
  MAX_PUBLISHING_PLATFORM_CONTEXT_CANDIDATES,
  normalizePublishingPlatformContextTags,
  type PublishingPlatformContextSnapshot,
  type PublishingTrendCandidate,
  type PublishingTrendPlatformId,
} from "../../shared/publishingPlatformContext";
import { canonicalJsonStringify } from "../../shared/canonicalJson";
import {
  readPlatformTrendProvider,
  type PlatformTrendProvider,
} from "./platformTrends/provider";

export type PublishingTrendRelevanceRanker = (
  candidates: PublishingTrendCandidate[],
  queryText: string
) => Promise<string[]>;

function defaultRankCandidateIds(
  candidates: PublishingTrendCandidate[],
  queryText: string
): Promise<string[]> {
  const normalizedQuery = queryText.normalize("NFKC").toLocaleLowerCase();
  return Promise.resolve(candidates
    .filter(candidate => {
      const label = candidate.label
        .normalize("NFKC")
        .toLocaleLowerCase();
      const compact = label.replace(/\s+/g, "");
      return label.length >= 2 &&
        (normalizedQuery.includes(label) ||
          (compact.length >= 2 && normalizedQuery.replace(/\s+/g, "").includes(compact)));
    })
    .map(candidate => candidate.id));
}

function digestRawResponse(value: unknown): string {
  return `sha256-${createHash("sha256")
    .update(canonicalJsonStringify(value))
    .digest("hex")}`;
}

function snapshotId(params: {
  providerId: string;
  versionId: string;
  platform: PublishingTrendPlatformId;
  fetchedAt: number;
  createdAt: number;
  rawDigest: string;
}): string {
  return `ctx-${createHash("sha256")
    .update(canonicalJsonStringify(params))
    .digest("hex")
    .slice(0, 24)}`;
}

export async function buildPublishingPlatformContextSnapshot(params: {
  provider: PlatformTrendProvider;
  platform: PublishingTrendPlatformId;
  versionId: string;
  sourceRevision: number;
  queryText: string;
  contentTags: string[];
  now?: number;
  contextRevision?: number;
  locale?: string;
  category?: string;
  rankCandidateIds?: PublishingTrendRelevanceRanker;
}): Promise<{ snapshot: PublishingPlatformContextSnapshot; persistable: boolean }> {
  const now = params.now ?? Date.now();
  const providerResult = await readPlatformTrendProvider(params.provider, {
    platform: params.platform,
    locale: params.locale ?? "zh-CN",
    category: params.category ?? "general",
    now,
  });
  const contentSuggestions = normalizePublishingPlatformContextTags(
    params.contentTags
  );
  if (providerResult.status !== "verified") {
    const rawDigest = digestRawResponse({
      status: providerResult.status,
      providerId: providerResult.providerId,
      parserVersion: providerResult.parserVersion,
    });
    return {
      persistable: false,
      snapshot: {
        snapshotId: snapshotId({
          providerId: providerResult.providerId,
          versionId: params.versionId,
          platform: params.platform,
          fetchedAt: now,
          createdAt: now,
          rawDigest,
        }),
        versionId: params.versionId,
        platform: params.platform,
        sourceRevision: params.sourceRevision,
        revision: (params.contextRevision ?? 0) + 1,
        status: providerResult.status,
        capability: "unavailable",
        providerId: providerResult.providerId,
        providerLabel: providerResult.providerLabel,
        authorization: {
          status: providerResult.authorization.status,
          reference: providerResult.authorization.reference,
        },
        coverage: "",
        fetchedAt: now,
        sourcePublishedAt: null,
        expiresAt: now,
        sourceDocument: providerResult.sourceDocument,
        parserVersion: providerResult.parserVersion,
        rawDigest,
        candidates: [],
        contentSuggestions,
        message: providerResult.message,
        createdAt: now,
      },
    };
  }
  const rawDigest = digestRawResponse(providerResult.rawResponse);
  const allowedIds = new Set(providerResult.candidates.map(candidate => candidate.id));
  const rankedIds = await (params.rankCandidateIds ?? defaultRankCandidateIds)(
    structuredClone(providerResult.candidates),
    params.queryText
  );
  const selectedIds = new Set(rankedIds.filter(id => allowedIds.has(id)));
  const candidates = providerResult.candidates
    .filter(candidate => selectedIds.has(candidate.id))
    .slice(0, MAX_PUBLISHING_PLATFORM_CONTEXT_CANDIDATES);
  const stale = providerResult.expiresAt <= now;
  const status = stale
    ? "verified_stale" as const
    : candidates.length > 0
      ? "verified_fresh" as const
      : "no_relevant" as const;
  return {
    persistable: true,
    snapshot: {
      snapshotId: snapshotId({
        providerId: providerResult.providerId,
        versionId: params.versionId,
        platform: params.platform,
        fetchedAt: providerResult.fetchedAt,
        createdAt: now,
        rawDigest,
      }),
      versionId: params.versionId,
      platform: params.platform,
      sourceRevision: params.sourceRevision,
      revision: (params.contextRevision ?? 0) + 1,
      status,
      capability: "verified",
      providerId: providerResult.providerId,
      providerLabel: providerResult.providerLabel,
      authorization: {
        status: providerResult.authorization.status,
        reference: providerResult.authorization.reference,
      },
      coverage: providerResult.coverage,
      fetchedAt: providerResult.fetchedAt,
      sourcePublishedAt: providerResult.sourcePublishedAt,
      expiresAt: providerResult.expiresAt,
      sourceDocument: providerResult.sourceDocument,
      parserVersion: providerResult.parserVersion,
      rawDigest,
      candidates,
      contentSuggestions,
      message: status === "verified_fresh"
        ? "已获取可验证的实时热门标签"
        : status === "verified_stale"
          ? "来源仍可核验，但已超过实时有效期"
          : "暂无与当前内容相关的热门标签",
      createdAt: now,
    },
  };
}
