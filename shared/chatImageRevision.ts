import type { VisualEditDocument } from "./visualClipModel";

export type ChatImageRevision = {
  requestId: string;
  stableShotId: string;
  shotNo: number;
  sourceImageId: number;
  createdAt: number;
  editorUserId?: number;
  instruction: string;
  status: "preparing" | "unknown" | "accepted" | "failed" | "succeeded";
  candidates: { imageId: number; imageUrl: string }[];
  error?: string;
  decision?: {
    kind: "kept" | "replaced";
    imageId?: number;
    at: number;
    userId: number;
  };
};

/** Only explicit replacement/retention language is a decision. Other messages stay chat. */
export function parseImageRevisionDecision(text: string) {
  const value = text.trim().replace(/[。.!！]+$/u, "");
  const exact = value.match(
    /^(?:用)?(?:图片|image)\s*#?(\d+)\s*(替换原图|替换原素材|replace original)$/i
  );
  if (exact)
    return {
      kind: "replace" as const,
      imageId: Number(exact[1]),
      shotNo: undefined,
      ordinal: undefined,
    };
  const match = value.match(
    /^(?:第\s*(\d+)\s*(?:个)?镜(?:头)?\s*[，,:：]?\s*)?(?:(?:用)?第\s*(\d+)\s*张\s*)?(替换(?:原图|原素材)?|采用新图|保留原图|先保留原图|不替换|replace(?: original)?|keep original)$/i
  );
  if (!match) return null;
  return {
    kind: /^(保留|先保留|不替换|keep)/i.test(match[3])
      ? ("keep" as const)
      : ("replace" as const),
    shotNo: match[1] ? Number(match[1]) : undefined,
    ordinal: match[2] ? Number(match[2]) : undefined,
  };
}

/** Replace only the source's existing slot; never add a new covering layer. */
export function replaceRevisionInDocument(
  document: VisualEditDocument,
  input: {
    stableShotId: string;
    sourceImageId: number;
    imageId: number;
    imageUrl: string;
    sourceIsPrimary: boolean;
    sourceIsFrame?: boolean;
  }
) {
  const owner = document.items.find(i => i.stableShotId === input.stableShotId);
  if (!owner) throw new Error("原镜头已不在时间线上，请重新选择");
  const clips =
    owner.imageClips?.filter(c => c.imageId === input.sourceImageId) ?? [];
  if (clips.length > 1)
    throw new Error("原图有多个剪辑位置，请先选定要替换的位置");
  const primary =
    owner.referencedImageId === input.sourceImageId ||
    (!owner.referencedImageId && input.sourceIsPrimary);
  if (!clips.length && !primary && !input.sourceIsFrame)
    throw new Error("原素材已经变化，请重新审阅新图");
  const transfer = <T>(values: Record<string, T> | undefined) =>
    values?.[input.sourceImageId]
      ? { ...values, [input.imageId]: values[input.sourceImageId] }
      : values;
  return {
    ...document,
    items: document.items.map(i =>
      i !== owner
        ? i
        : {
            ...i,
            ...(primary ? { referencedImageId: input.imageId } : {}),
            imageClips: i.imageClips?.map(c =>
              c.imageId === input.sourceImageId
                ? { ...c, imageId: input.imageId, imageUrl: input.imageUrl }
                : c
            ),
            imageTransforms: transfer(i.imageTransforms),
            imageTextOverlays: transfer(i.imageTextOverlays),
          }
    ),
  };
}

export function replaceRevisionFrameRoles(
  raw: unknown,
  source: number,
  replacement: number
) {
  if (raw == null) return raw;
  let params: Record<string, unknown>;
  try {
    params = typeof raw === "string" ? JSON.parse(raw) : { ...(raw as object) };
  } catch {
    return raw;
  }
  if (!params || typeof params !== "object" || Array.isArray(params))
    return raw;
  const before = JSON.stringify(params);
  for (const key of ["firstFrameImageId", "lastFrameImageId"])
    if (params[key] === source) params[key] = replacement;
  if (Array.isArray(params.referenceFrameImageIds))
    params.referenceFrameImageIds = params.referenceFrameImageIds.map(id =>
      id === source ? replacement : id
    );
  if (
    params.storyboardFrameRoles &&
    typeof params.storyboardFrameRoles === "object"
  ) {
    const roles = { ...params.storyboardFrameRoles } as Record<string, unknown>;
    for (const key of ["firstImageId", "lastImageId"])
      if (roles[key] === source) roles[key] = replacement;
    if (Array.isArray(roles.referenceImageIds))
      roles.referenceImageIds = roles.referenceImageIds.map(id =>
        id === source ? replacement : id
      );
    params.storyboardFrameRoles = roles;
  }
  if (JSON.stringify(params) === before) return raw;
  return typeof raw === "string" ? JSON.stringify(params) : params;
}
