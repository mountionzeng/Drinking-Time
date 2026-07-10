export const CONSISTENCY_DIMENSIONS = [
  "face",
  "hairstyle",
  "clothing",
  "scene",
  "style",
] as const;

export type ConsistencyDimension = (typeof CONSISTENCY_DIMENSIONS)[number];

export const CONSISTENCY_DIMENSION_LABELS: Record<
  ConsistencyDimension,
  string
> = {
  face: "五官",
  hairstyle: "发型",
  clothing: "服饰",
  scene: "场景",
  style: "画风",
};

export type ShotConsistencyMismatch = {
  dimension: ConsistencyDimension;
  note: string;
};

export type ShotConsistencyVerdict = "consistent" | "inconsistent" | "unknown";

export type ShotConsistencyFinding = {
  imageId: number;
  shotNo: string | null;
  imageUrl: string;
  verdict: ShotConsistencyVerdict;
  mismatches: ShotConsistencyMismatch[];
  /** 模型看不清/单图分析失败时的补充说明（verdict=unknown 时使用） */
  note?: string;
};

export type ShotConsistencyAnalysis =
  | {
      status: "ok";
      anchorImageUrl: string;
      modelLabel: string;
      findings: ShotConsistencyFinding[];
    }
  | { status: "not_configured"; message: string }
  | { status: "error"; message: string };
