export const VIDEO_MATERIAL_PROFILE_VERSION =
  "video-material-profile/v1" as const;

export const VIDEO_MATERIAL_MEDIA = [
  "oil-painting",
  "watercolor",
  "gouache",
  "ink-wash",
  "printmaking",
  "pastel",
  "charcoal",
  "pencil-drawing",
  "collage",
  "digital-painting",
  "photographic",
  "mixed-media",
  "other",
] as const;

export type VideoMaterialMedium = (typeof VIDEO_MATERIAL_MEDIA)[number];

export type VideoMaterialProfile = {
  version: typeof VIDEO_MATERIAL_PROFILE_VERSION;
  medium: VideoMaterialMedium;
  support: string;
  markMaking: string;
  pigmentBehavior: string;
  temporalRules: string;
  prohibitedDrift: string;
  confidence: number;
};

type MaterialProfilePayload = Partial<
  Record<
    | "medium"
    | "support"
    | "markMaking"
    | "pigmentBehavior"
    | "temporalRules"
    | "prohibitedDrift"
    | "confidence",
    unknown
  >
>;

function text(value: unknown, max = 180): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\r\n]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[,;:\s.]+|[,;:\s.]+$/g, "")
    .trim()
    .slice(0, max);
}

function medium(value: unknown): VideoMaterialMedium {
  const normalized = text(value, 60)
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
  return VIDEO_MATERIAL_MEDIA.includes(normalized as VideoMaterialMedium)
    ? (normalized as VideoMaterialMedium)
    : "other";
}

export function normalizeVideoMaterialProfile(
  value: unknown
): VideoMaterialProfile | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as MaterialProfilePayload;
  const support = text(raw.support);
  const markMaking = text(raw.markMaking);
  const pigmentBehavior = text(raw.pigmentBehavior);
  const temporalRules = text(raw.temporalRules, 240);
  const prohibitedDrift = text(raw.prohibitedDrift, 240);
  if (
    !support &&
    !markMaking &&
    !pigmentBehavior &&
    !temporalRules &&
    !prohibitedDrift
  ) {
    return null;
  }
  const confidence = Number(raw.confidence);
  return {
    version: VIDEO_MATERIAL_PROFILE_VERSION,
    medium: medium(raw.medium),
    support,
    markMaking,
    pigmentBehavior,
    temporalRules,
    prohibitedDrift,
    confidence: Number.isFinite(confidence)
      ? Math.max(0, Math.min(1, confidence))
      : 0,
  };
}

export function compileVideoMaterialLock(input: {
  profile?: VideoMaterialProfile | null;
  materialTexture?: string;
}): string {
  const profile = input.profile;
  if (!profile) {
    const declaredMaterial = text(input.materialTexture, 180);
    const basis = declaredMaterial
      ? `${declaredMaterial}; use the source image as the exact material reference`
      : "preserve the exact source-image medium and support";
    return `MATERIAL LOCK: ${basis}; keep identical support texture, mark-making, pigment behavior, brush or grain structure, and edge character in every frame; avoid photorealistic conversion, CGI smoothing, plastic surfaces, texture flicker, or medium drift.`;
  }

  const mediumAndSupport = profile.support
    ? `${profile.medium} on ${profile.support}`
    : profile.medium;
  const visibleSignature = [profile.markMaking, profile.pigmentBehavior]
    .filter(Boolean)
    .join(" and ");
  const prohibited =
    profile.prohibitedDrift ||
    "photorealistic conversion, CGI smoothing, texture flicker, or medium drift";
  return [
    `MATERIAL LOCK: ${mediumAndSupport}`,
    visibleSignature ? `retain ${visibleSignature}` : "",
    "keep support texture, mark scale/direction, pigment and edges frame-stable",
    `forbid ${prohibited}`,
  ]
    .filter(Boolean)
    .join("; ")
    .concat(".");
}

export function splitVideoMaterialLock(value: string): {
  materialLock: string;
  remainder: string;
} {
  const normalized = value.trim();
  const lines = normalized.split(/\r?\n/);
  const index = lines.findIndex(line => /^MATERIAL LOCK:/i.test(line.trim()));
  if (index < 0) return { materialLock: "", remainder: normalized };
  const materialLock = lines[index].trim();
  lines.splice(index, 1);
  return {
    materialLock,
    remainder: lines.join("\n").trim(),
  };
}
