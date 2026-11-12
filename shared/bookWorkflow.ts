import { z } from "zod";
import type { StoredChapterBlocks, StoredChapterLayout } from "./chapterStore";

export const manuscriptKindSchema = z.enum(["text", "storyboard"]);
export type ManuscriptKind = z.infer<typeof manuscriptKindSchema>;
export const creationIntentSchema = z.object({
  purpose: z.string().trim().min(1).max(1000),
  audience: z.string().trim().min(1).max(300),
  platform: z.string().trim().min(1).max(200),
});
export type CreationIntent = z.infer<typeof creationIntentSchema>;
export type VersionActor = { userId: number; name: string };
export type ManuscriptContent = {
  title: string;
  blocks: StoredChapterBlocks;
  layout: StoredChapterLayout | null;
};
export type ManuscriptReference = {
  id: string;
  kind: ManuscriptKind;
  number: number;
};
export type VideoManuscriptReference = {
  kind: "video";
  id: string;
  number: number;
  timelineVersion: number;
  videoVersionId?: string;
  exportId?: string;
};
export type ManuscriptSource = ManuscriptReference | VideoManuscriptReference;
export type ManuscriptVersion = ManuscriptReference & {
  name: string;
  createdAt: number;
  intent: CreationIntent;
  author: VersionActor;
  confirmedBy: VersionActor;
  editedBy?: VersionActor;
  aiAssisted: boolean;
  summary: string;
  parentId?: string;
  source?: ManuscriptSource;
  chapters: ManuscriptContent[];
  fingerprint: string;
};
export type ConversionDraft = {
  videoTextMethod?: "rewrite" | "local-transcript";
  submissionUncertain?: boolean;
  conversation?: Array<{ role: "user" | "assistant"; content: string }>;
  id: string;
  target: ManuscriptKind;
  source: ManuscriptSource;
  intent: CreationIntent;
  request: string;
  author: VersionActor;
  createdAt: number;
  status: "generating" | "review" | "failed" | "adopted";
  error?: string;
  editedBy?: VersionActor;
  updatedAt?: number;
  revision: number;
  chapters?: ManuscriptContent[];
  sourceFingerprint: string;
  targetFingerprint: string;
  adoptedId?: string;
  videoEvidence?: {
    localTextSource?: "timeline-subtitles" | "local-ocr" | "local-whisper";
    transcript: string;
    sampledSeconds: number[];
    modelLabel: string;
    videoSha256: string;
    quoteFingerprint: string;
  };
};
export type BookWorkflowState = {
  schemaVersion: 1;
  revision: number;
  versions: ManuscriptVersion[];
  current: Partial<Record<ManuscriptKind, string>>;
  conversions: ConversionDraft[];
};
export const emptyBookWorkflow = (): BookWorkflowState => ({
  schemaVersion: 1,
  revision: 0,
  versions: [],
  current: {},
  conversions: [],
});
export function readBookWorkflow(value: unknown): BookWorkflowState {
  if (value == null) return emptyBookWorkflow();
  const state = value as BookWorkflowState;
  if (
    state.schemaVersion !== 1 ||
    !Number.isSafeInteger(state.revision) ||
    !Array.isArray(state.versions) ||
    !Array.isArray(state.conversions) ||
    !state.current
  )
    throw new Error("稿件版本记录无法读取，已有内容保留");
  return structuredClone(state);
}
export const manuscriptLabel = (kind: ManuscriptKind | "video") =>
  kind === "text" ? "文字版" : kind === "video" ? "视频" : "分镜版";
export const chapterKind = (blocks: StoredChapterBlocks): ManuscriptKind =>
  blocks.manuscriptKind ?? "text";
export const versionReference = ({
  id,
  kind,
  number,
}: ManuscriptVersion): ManuscriptReference => ({ id, kind, number });
export function currentManuscript(
  state: BookWorkflowState,
  kind: ManuscriptKind
) {
  return state.versions.find(version => version.id === state.current[kind]);
}
/** Follow restoration/adaptation ancestry without losing the original text source. */
export function textManuscriptSource(
  state: BookWorkflowState,
  version?: ManuscriptVersion
): ManuscriptReference | undefined {
  const visited = new Set<string>();
  while (version?.source && !visited.has(version.id)) {
    visited.add(version.id);
    if (version.source.kind === "text") return version.source;
    if (version.source.kind === "video") return undefined;
    version = state.versions.find(item => item.id === version!.source!.id);
  }
}
