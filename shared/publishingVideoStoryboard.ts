export const PUBLISHING_VIDEO_STORYBOARD_VERSION = 1 as const;
export const PUBLISHING_VIDEO_MINIMUM_SHOT_COUNT = 4;
export const PUBLISHING_VIDEO_MAXIMUM_SHOTS_PER_PARAGRAPH = 6;

export type PublishingVideoParagraphClassification =
  | "narrative"
  | "cta"
  | "formatting";

export type PublishingVideoSourceParagraph = {
  paragraphId: string;
  ordinal: number;
  duplicateOrdinal: number;
  text: string;
  classification: PublishingVideoParagraphClassification;
};

export type PublishingVideoScriptSegment = {
  segmentId: string;
  sourceParagraphId: string;
  scriptText: string;
  visualTreatment: string;
  treatmentReason: string | null;
  modelScriptText: string;
  userEdited: boolean;
  shotIds: string[];
};

export type PublishingVideoStoryboardShot = {
  draftShotId: string;
  stableShotId?: string;
  segmentIds: string[];
  sourceParagraphIds: string[];
  scriptText: string;
  subject: string;
  action: string;
  imageRequirement: string;
  videoRequirement: string;
};

export type PublishingVideoPreviewSource = {
  storyId: number;
  versionId: string;
  platform: string;
  storyRevision: number;
  publishingRevision: number;
  versionRevision: number;
  draftRevision: number;
  storyboardRevision: number;
  canonicalContentHash: string;
  formalCoverAssetId: number | null;
};

export type PublishingVideoOperationState =
  | {
      status: "pending";
      operationToken: string;
      requestHash: string;
      operationKind: "preview" | "confirm";
      claimedAt: number;
      expiresAt: number;
    }
  | {
      status: "completed";
      operationToken: string;
      requestHash: string;
      operationKind: "preview" | "confirm";
      resultId: string;
      completedAt: number;
    }
  | {
      status: "failed";
      operationToken: string;
      requestHash: string;
      operationKind: "preview" | "confirm";
      failedAt: number;
      retryable: boolean;
    };

export type PublishingVideoStoryboardPreview = {
  previewId: string;
  revision: number;
  status: "preview" | "confirmed" | "stale";
  createdAt: number;
  updatedAt: number;
  source: PublishingVideoPreviewSource | null;
  paragraphs: PublishingVideoSourceParagraph[];
  segments: PublishingVideoScriptSegment[];
  shots: PublishingVideoStoryboardShot[];
  staleReasons: Array<"content" | "core" | "cover" | "storyboard">;
};

export type PublishingVideoConfirmedSnapshot = {
  previewId: string;
  groupId: string;
  confirmedAt: number;
  confirmedStoryRevision: number;
  paragraphs: PublishingVideoSourceParagraph[];
  segments: PublishingVideoScriptSegment[];
  shots: PublishingVideoStoryboardShot[];
  baselineByStableShotId: Record<string, PublishingVideoStoryboardShot>;
};

export type PublishingVideoImpactKind =
  | "retain"
  | "content_update"
  | "split"
  | "merge"
  | "insert"
  | "remove"
  | "manual_field_conflict"
  | "ambiguous_source"
  | "active_version_replacement";

export type PublishingVideoImpactResolution =
  | "reuse"
  | "keep_old"
  | "retire_old"
  | "use_new"
  | "map_explicitly";

export type PublishingVideoImpactItem = {
  impactId: string;
  kind: PublishingVideoImpactKind;
  nextDraftShotId: string | null;
  previousStableShotIds: string[];
  proposedStableShotId: string | null;
  changedFields: string[];
  requiresResolution: boolean;
  resolution: PublishingVideoImpactResolution | null;
};

export type PublishingVideoImpactPlan = {
  items: PublishingVideoImpactItem[];
  unresolvedCount: number;
};

export type PublishingVideoStoryboardAggregate = {
  version: typeof PUBLISHING_VIDEO_STORYBOARD_VERSION;
  latestPreview: PublishingVideoStoryboardPreview | null;
  confirmed: PublishingVideoConfirmedSnapshot | null;
  impactPlan: PublishingVideoImpactPlan | null;
  operations: Record<string, PublishingVideoOperationState>;
};

export type PublishingVideoValidationIssue = {
  code:
    | "empty_source"
    | "missing_paragraph_segment"
    | "duplicate_segment_id"
    | "duplicate_shot_id"
    | "unknown_paragraph"
    | "unknown_segment"
    | "segment_without_shot"
    | "shot_without_segment"
    | "script_copies_source"
    | "too_few_shots"
    | "too_many_shots";
  message: string;
  targetId: string | null;
};

function normalizedText(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(/[\t ]+$/gm, "").trim();
}

function comparisonText(value: string): string {
  return normalizedText(value).replace(/\s+/g, " ").trim();
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, "0");
}

function classifyParagraph(text: string): PublishingVideoParagraphClassification {
  const compact = comparisonText(text);
  if (
    /(?:关注|点赞|收藏|转发|评论|私信|订阅|点击|查看更多|follow|subscribe|like|share)/i.test(
      compact
    )
  ) {
    return "cta";
  }
  if (/^(?:#{1,6}\s|[-*+]\s|>\s|\d+[.)]\s)/m.test(compact)) {
    return "formatting";
  }
  return "narrative";
}

export function canonicalizePublishingVideoParagraphs(
  body: string
): PublishingVideoSourceParagraph[] {
  const blocks = normalizedText(body)
    .split(/\n[\t ]*\n+/)
    .map(normalizedText)
    .filter(Boolean);
  const duplicateCounts = new Map<string, number>();
  return blocks.map((text, index) => {
    const duplicateOrdinal = (duplicateCounts.get(text) ?? 0) + 1;
    duplicateCounts.set(text, duplicateOrdinal);
    const ordinal = index + 1;
    return {
      paragraphId: `paragraph-${String(ordinal).padStart(3, "0")}-${duplicateOrdinal}-${stableHash(text)}`,
      ordinal,
      duplicateOrdinal,
      text,
      classification: classifyParagraph(text),
    };
  });
}

export function publishingVideoContentHash(
  paragraphs: readonly PublishingVideoSourceParagraph[]
): string {
  return stableHash(
    paragraphs
      .map(item => `${item.ordinal}\u0000${item.duplicateOrdinal}\u0000${item.text}`)
      .join("\u0001")
  );
}

export function emptyPublishingVideoStoryboardAggregate(): PublishingVideoStoryboardAggregate {
  return {
    version: PUBLISHING_VIDEO_STORYBOARD_VERSION,
    latestPreview: null,
    confirmed: null,
    impactPlan: null,
    operations: {},
  };
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function finiteInteger(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : fallback;
}

function normalizeParagraph(value: unknown): PublishingVideoSourceParagraph | null {
  const record = objectRecord(value);
  if (!record) return null;
  const paragraphId = stringValue(record.paragraphId).trim();
  const text = normalizedText(stringValue(record.text));
  if (!paragraphId || !text) return null;
  const classification =
    record.classification === "cta" || record.classification === "formatting"
      ? record.classification
      : "narrative";
  return {
    paragraphId,
    ordinal: Math.max(1, finiteInteger(record.ordinal, 1)),
    duplicateOrdinal: Math.max(1, finiteInteger(record.duplicateOrdinal, 1)),
    text,
    classification,
  };
}

function normalizeSegment(value: unknown): PublishingVideoScriptSegment | null {
  const record = objectRecord(value);
  if (!record) return null;
  const segmentId = stringValue(record.segmentId).trim();
  const sourceParagraphId = stringValue(record.sourceParagraphId).trim();
  if (!segmentId || !sourceParagraphId) return null;
  const scriptText = normalizedText(stringValue(record.scriptText));
  return {
    segmentId,
    sourceParagraphId,
    scriptText,
    visualTreatment: normalizedText(stringValue(record.visualTreatment)),
    treatmentReason:
      typeof record.treatmentReason === "string"
        ? normalizedText(record.treatmentReason)
        : null,
    modelScriptText: normalizedText(
      stringValue(record.modelScriptText) || scriptText
    ),
    userEdited: record.userEdited === true,
    shotIds: stringArray(record.shotIds),
  };
}

function normalizeShot(value: unknown): PublishingVideoStoryboardShot | null {
  const record = objectRecord(value);
  if (!record) return null;
  const draftShotId = stringValue(record.draftShotId).trim();
  if (!draftShotId) return null;
  const stableShotId = stringValue(record.stableShotId).trim();
  return {
    draftShotId,
    ...(stableShotId ? { stableShotId } : {}),
    segmentIds: stringArray(record.segmentIds),
    sourceParagraphIds: stringArray(record.sourceParagraphIds),
    scriptText: normalizedText(stringValue(record.scriptText)),
    subject: normalizedText(stringValue(record.subject)),
    action: normalizedText(stringValue(record.action)),
    imageRequirement: normalizedText(stringValue(record.imageRequirement)),
    videoRequirement: normalizedText(stringValue(record.videoRequirement)),
  };
}

function normalizePreview(value: unknown): PublishingVideoStoryboardPreview | null {
  const record = objectRecord(value);
  if (!record) return null;
  const previewId = stringValue(record.previewId).trim();
  if (!previewId) return null;
  const status =
    record.status === "confirmed" || record.status === "stale"
      ? record.status
      : "preview";
  const source = objectRecord(record.source);
  const normalizedSource = source
    ? {
        storyId: Math.max(1, finiteInteger(source.storyId, 1)),
        versionId: stringValue(source.versionId),
        platform: stringValue(source.platform),
        storyRevision: finiteInteger(source.storyRevision),
        publishingRevision: finiteInteger(source.publishingRevision),
        versionRevision: finiteInteger(source.versionRevision),
        draftRevision: finiteInteger(source.draftRevision),
        storyboardRevision: finiteInteger(source.storyboardRevision),
        canonicalContentHash: stringValue(source.canonicalContentHash),
        formalCoverAssetId:
          typeof source.formalCoverAssetId === "number" &&
          Number.isInteger(source.formalCoverAssetId) &&
          source.formalCoverAssetId > 0
            ? source.formalCoverAssetId
            : null,
      }
    : null;
  return {
    previewId,
    revision: Math.max(1, finiteInteger(record.revision, 1)),
    status,
    createdAt: finiteInteger(record.createdAt),
    updatedAt: finiteInteger(record.updatedAt),
    source: normalizedSource,
    paragraphs: Array.isArray(record.paragraphs)
      ? record.paragraphs.flatMap(item => {
          const paragraph = normalizeParagraph(item);
          return paragraph ? [paragraph] : [];
        })
      : [],
    segments: Array.isArray(record.segments)
      ? record.segments.flatMap(item => {
          const segment = normalizeSegment(item);
          return segment ? [segment] : [];
        })
      : [],
    shots: Array.isArray(record.shots)
      ? record.shots.flatMap(item => {
          const shot = normalizeShot(item);
          return shot ? [shot] : [];
        })
      : [],
    staleReasons: stringArray(record.staleReasons).filter(
      (reason): reason is PublishingVideoStoryboardPreview["staleReasons"][number] =>
        reason === "content" ||
        reason === "core" ||
        reason === "cover" ||
        reason === "storyboard"
    ),
  };
}

function normalizeOperationState(value: unknown): PublishingVideoOperationState | null {
  const record = objectRecord(value);
  if (!record) return null;
  const operationToken = stringValue(record.operationToken).trim();
  const requestHash = stringValue(record.requestHash).trim();
  const operationKind =
    record.operationKind === "confirm" ? "confirm" : "preview";
  if (!operationToken || !requestHash) return null;
  if (record.status === "pending") {
    return {
      status: "pending",
      operationToken,
      requestHash,
      operationKind,
      claimedAt: finiteInteger(record.claimedAt),
      expiresAt: finiteInteger(record.expiresAt),
    };
  }
  if (record.status === "completed") {
    const resultId = stringValue(record.resultId).trim();
    if (!resultId) return null;
    return {
      status: "completed",
      operationToken,
      requestHash,
      operationKind,
      resultId,
      completedAt: finiteInteger(record.completedAt),
    };
  }
  if (record.status === "failed") {
    return {
      status: "failed",
      operationToken,
      requestHash,
      operationKind,
      failedAt: finiteInteger(record.failedAt),
      retryable: record.retryable === true,
    };
  }
  return null;
}

export function normalizePublishingVideoStoryboardAggregate(
  value: unknown
): PublishingVideoStoryboardAggregate | null {
  const record = objectRecord(value);
  if (!record || record.version !== PUBLISHING_VIDEO_STORYBOARD_VERSION) {
    return null;
  }
  const latestPreview = normalizePreview(record.latestPreview);
  const confirmedRecord = objectRecord(record.confirmed);
  let confirmed: PublishingVideoConfirmedSnapshot | null = null;
  if (confirmedRecord) {
    const previewId = stringValue(confirmedRecord.previewId).trim();
    const groupId = stringValue(confirmedRecord.groupId).trim();
    if (previewId && groupId) {
      const shots = Array.isArray(confirmedRecord.shots)
        ? confirmedRecord.shots.flatMap(item => {
            const shot = normalizeShot(item);
            return shot ? [shot] : [];
          })
        : [];
      confirmed = {
        previewId,
        groupId,
        confirmedAt: finiteInteger(confirmedRecord.confirmedAt),
        confirmedStoryRevision: finiteInteger(
          confirmedRecord.confirmedStoryRevision
        ),
        paragraphs: Array.isArray(confirmedRecord.paragraphs)
          ? confirmedRecord.paragraphs.flatMap(item => {
              const paragraph = normalizeParagraph(item);
              return paragraph ? [paragraph] : [];
            })
          : [],
        segments: Array.isArray(confirmedRecord.segments)
          ? confirmedRecord.segments.flatMap(item => {
              const segment = normalizeSegment(item);
              return segment ? [segment] : [];
            })
          : [],
        shots,
        baselineByStableShotId: Object.fromEntries(
          shots.flatMap(shot =>
            shot.stableShotId ? [[shot.stableShotId, structuredClone(shot)]] : []
          )
        ),
      };
    }
  }
  const rawOperations = objectRecord(record.operations);
  return {
    version: PUBLISHING_VIDEO_STORYBOARD_VERSION,
    latestPreview,
    confirmed,
    impactPlan: null,
    operations: rawOperations
      ? Object.fromEntries(
          Object.entries(rawOperations).flatMap(([token, value]) => {
            const operation = normalizeOperationState(value);
            return operation && operation.operationToken === token
              ? [[token, operation]]
              : [];
          })
        )
      : {},
  };
}

export function buildPublishingVideoPreview(input: {
  paragraphs: PublishingVideoSourceParagraph[];
  rewrites: Array<{
    paragraphId: string;
    scriptText: string;
    visualTreatment: string;
    treatmentReason?: string | null;
    shots?: Array<
      Partial<
        Pick<
          PublishingVideoStoryboardShot,
          | "subject"
          | "action"
          | "imageRequirement"
          | "videoRequirement"
        >
      >
    >;
  }>;
  previewId?: string;
  now?: number;
  source?: PublishingVideoPreviewSource | null;
}): PublishingVideoStoryboardPreview {
  const now = input.now ?? Date.now();
  const rewriteByParagraph = new Map(
    input.rewrites.map(rewrite => [rewrite.paragraphId, rewrite])
  );
  const segments: PublishingVideoScriptSegment[] = [];
  const shots: PublishingVideoStoryboardShot[] = [];

  for (const paragraph of input.paragraphs) {
    const rewrite = rewriteByParagraph.get(paragraph.paragraphId);
    if (!rewrite) continue;
    const segmentId = `segment-${paragraph.paragraphId}`;
    const requestedShots = rewrite.shots?.length ? rewrite.shots : [{}];
    const shotIds: string[] = [];
    requestedShots.forEach((requested, shotIndex) => {
      const draftShotId = `draft-${paragraph.paragraphId}-${shotIndex + 1}`;
      shotIds.push(draftShotId);
      shots.push({
        draftShotId,
        segmentIds: [segmentId],
        sourceParagraphIds: [paragraph.paragraphId],
        scriptText: normalizedText(rewrite.scriptText),
        subject: normalizedText(requested.subject ?? ""),
        action: normalizedText(requested.action ?? rewrite.visualTreatment),
        imageRequirement: normalizedText(
          requested.imageRequirement ?? rewrite.visualTreatment
        ),
        videoRequirement: normalizedText(
          requested.videoRequirement ?? "让动作与情绪自然推进，保持画面连贯。"
        ),
      });
    });
    segments.push({
      segmentId,
      sourceParagraphId: paragraph.paragraphId,
      scriptText: normalizedText(rewrite.scriptText),
      visualTreatment: normalizedText(rewrite.visualTreatment),
      treatmentReason:
        rewrite.treatmentReason == null
          ? paragraph.classification === "narrative"
            ? null
            : `${paragraph.classification} 内容转为非逐字的画面/表演处理`
          : normalizedText(rewrite.treatmentReason),
      modelScriptText: normalizedText(rewrite.scriptText),
      userEdited: false,
      shotIds,
    });
  }

  let supplementIndex = 0;
  while (
    shots.length > 0 &&
    shots.length < PUBLISHING_VIDEO_MINIMUM_SHOT_COUNT
  ) {
    const source = shots[supplementIndex % shots.length]!;
    const draftShotId = `${source.draftShotId}-beat-${supplementIndex + 2}`;
    const supplement = {
      ...source,
      draftShotId,
      action: source.action
        ? `${source.action}，随后进入下一层动作。`
        : "动作继续发展，形成新的视觉节拍。",
    };
    shots.push(supplement);
    for (const segmentId of supplement.segmentIds) {
      const segment = segments.find(item => item.segmentId === segmentId);
      if (segment) segment.shotIds.push(draftShotId);
    }
    supplementIndex += 1;
  }

  return {
    previewId: input.previewId ?? `preview-${stableHash(`${now}:${publishingVideoContentHash(input.paragraphs)}`)}`,
    revision: 1,
    status: "preview",
    createdAt: now,
    updatedAt: now,
    source: input.source ?? null,
    paragraphs: structuredClone(input.paragraphs),
    segments,
    shots,
    staleReasons: [],
  };
}

export function validatePublishingVideoPreview(
  preview: PublishingVideoStoryboardPreview
): PublishingVideoValidationIssue[] {
  const issues: PublishingVideoValidationIssue[] = [];
  const paragraphsById = new Map(
    preview.paragraphs.map(item => [item.paragraphId, item])
  );
  const segmentsById = new Map<string, PublishingVideoScriptSegment>();
  const shotIds = new Set<string>();
  if (preview.paragraphs.length === 0) {
    issues.push({
      code: "empty_source",
      message: "正文没有可转写段落",
      targetId: null,
    });
  }
  for (const segment of preview.segments) {
    if (segmentsById.has(segment.segmentId)) {
      issues.push({
        code: "duplicate_segment_id",
        message: "剧本片段身份重复",
        targetId: segment.segmentId,
      });
    }
    segmentsById.set(segment.segmentId, segment);
    const paragraph = paragraphsById.get(segment.sourceParagraphId);
    if (!paragraph) {
      issues.push({
        code: "unknown_paragraph",
        message: "剧本片段引用了不存在的正文段落",
        targetId: segment.segmentId,
      });
    } else if (
      comparisonText(segment.scriptText) === comparisonText(paragraph.text)
    ) {
      issues.push({
        code: "script_copies_source",
        message: "剧本不能原样复制正文",
        targetId: segment.segmentId,
      });
    }
    if (segment.shotIds.length === 0) {
      issues.push({
        code: "segment_without_shot",
        message: "剧本片段没有对应镜头",
        targetId: segment.segmentId,
      });
    }
  }
  for (const paragraph of preview.paragraphs) {
    if (
      !preview.segments.some(
        segment => segment.sourceParagraphId === paragraph.paragraphId
      )
    ) {
      issues.push({
        code: "missing_paragraph_segment",
        message: "正文段落没有对应剧本片段",
        targetId: paragraph.paragraphId,
      });
    }
  }
  for (const shot of preview.shots) {
    if (shotIds.has(shot.draftShotId)) {
      issues.push({
        code: "duplicate_shot_id",
        message: "草稿镜头身份重复",
        targetId: shot.draftShotId,
      });
    }
    shotIds.add(shot.draftShotId);
    if (
      shot.segmentIds.length === 0 ||
      shot.segmentIds.some(segmentId => !segmentsById.has(segmentId))
    ) {
      issues.push({
        code: shot.segmentIds.length === 0 ? "shot_without_segment" : "unknown_segment",
        message: "镜头必须只引用存在的剧本片段",
        targetId: shot.draftShotId,
      });
    }
    if (
      shot.sourceParagraphIds.some(paragraphId => !paragraphsById.has(paragraphId))
    ) {
      issues.push({
        code: "unknown_paragraph",
        message: "镜头引用了不存在的正文段落",
        targetId: shot.draftShotId,
      });
    }
  }
  if (
    preview.paragraphs.length > 0 &&
    preview.shots.length <
      Math.max(PUBLISHING_VIDEO_MINIMUM_SHOT_COUNT, preview.paragraphs.length)
  ) {
    issues.push({
      code: "too_few_shots",
      message: "镜头数量不足以覆盖正文",
      targetId: null,
    });
  }
  if (
    preview.shots.length >
    Math.max(
      PUBLISHING_VIDEO_MINIMUM_SHOT_COUNT,
      preview.paragraphs.length * PUBLISHING_VIDEO_MAXIMUM_SHOTS_PER_PARAGRAPH
    )
  ) {
    issues.push({
      code: "too_many_shots",
      message: "镜头数量超出安全上限",
      targetId: null,
    });
  }
  return issues;
}

const BASELINE_FIELDS: Array<keyof PublishingVideoStoryboardShot> = [
  "scriptText",
  "subject",
  "action",
  "imageRequirement",
  "videoRequirement",
];

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length && left.every((item, index) => item === right[index])
  );
}

export function classifyPublishingVideoImpact(input: {
  previousShots: PublishingVideoStoryboardShot[];
  nextShots: PublishingVideoStoryboardShot[];
  currentFormalShots: PublishingVideoStoryboardShot[];
  confirmedBaselineByStableShotId: Record<string, PublishingVideoStoryboardShot>;
}): PublishingVideoImpactPlan {
  const nextOverlapCount = new Map<string, number>();
  for (const previous of input.previousShots) {
    if (!previous.stableShotId) continue;
    const count = input.nextShots.filter(next =>
      next.sourceParagraphIds.some(id => previous.sourceParagraphIds.includes(id))
    ).length;
    nextOverlapCount.set(previous.stableShotId, count);
  }

  const items = input.nextShots.map((next, index): PublishingVideoImpactItem => {
    const overlaps = input.previousShots.filter(previous =>
      next.sourceParagraphIds.some(id => previous.sourceParagraphIds.includes(id))
    );
    const exact = overlaps.filter(previous =>
      sameIds(previous.sourceParagraphIds, next.sourceParagraphIds)
    );
    let kind: PublishingVideoImpactKind = "insert";
    let proposedStableShotId: string | null = null;
    let changedFields: string[] = [];
    if (overlaps.length > 1 || next.sourceParagraphIds.length > 1) {
      kind = "merge";
    } else if (
      overlaps.length === 1 &&
      overlaps[0]?.stableShotId &&
      (nextOverlapCount.get(overlaps[0].stableShotId) ?? 0) > 1
    ) {
      kind = "split";
    } else if (exact.length === 1 && exact[0]?.stableShotId) {
      const stableShotId = exact[0].stableShotId;
      const baseline = input.confirmedBaselineByStableShotId[stableShotId];
      const current = input.currentFormalShots.find(
        shot => shot.stableShotId === stableShotId
      );
      if (baseline && current) {
        changedFields = BASELINE_FIELDS.filter(
          field => current[field] !== baseline[field]
        );
      }
      if (changedFields.length > 0) {
        kind = "manual_field_conflict";
      } else {
        kind = "retain";
        proposedStableShotId = stableShotId;
      }
    } else if (overlaps.length === 1) {
      kind = "content_update";
    } else if (next.sourceParagraphIds.length === 0) {
      kind = "ambiguous_source";
    }
    const previousStableShotIds = overlaps.flatMap(shot =>
      shot.stableShotId ? [shot.stableShotId] : []
    );
    return {
      impactId: `impact-${index + 1}-${next.draftShotId}`,
      kind,
      nextDraftShotId: next.draftShotId,
      previousStableShotIds,
      proposedStableShotId,
      changedFields,
      requiresResolution: !["retain", "insert"].includes(kind),
      resolution: kind === "retain" ? "reuse" : kind === "insert" ? "use_new" : null,
    };
  });

  const retainedPreviousIds = new Set(
    items.flatMap(item => item.previousStableShotIds)
  );
  for (const previous of input.previousShots) {
    if (!previous.stableShotId || retainedPreviousIds.has(previous.stableShotId)) continue;
    items.push({
      impactId: `impact-remove-${previous.stableShotId}`,
      kind: "remove",
      nextDraftShotId: null,
      previousStableShotIds: [previous.stableShotId],
      proposedStableShotId: null,
      changedFields: [],
      requiresResolution: true,
      resolution: null,
    });
  }

  return {
    items,
    unresolvedCount: items.filter(item => item.requiresResolution && !item.resolution)
      .length,
  };
}
