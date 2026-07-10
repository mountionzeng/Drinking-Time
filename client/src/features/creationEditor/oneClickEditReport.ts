import type { StoryMaterialState } from "@shared/storyMaterial";
import type { VideoTakeAsset } from "@shared/videoAsset";
import {
  VIDEO_TARGET_ASPECT_RATIOS,
  type VideoTargetAspectRatio,
} from "@shared/videoConform";
import type { CreationEditorShot } from "./CreationEditorContext";

export const ONE_CLICK_TARGET_ASPECT_RATIOS = VIDEO_TARGET_ASPECT_RATIOS;

export type OneClickTargetAspectRatio = VideoTargetAspectRatio;

export type OneClickIssueSeverity = "blocking" | "warning";

export type OneClickIssueKind =
  | "off_timeline"
  | "missing_current_video"
  | "missing_current_image"
  | "aspect_mismatch"
  | "stale_video"
  | "missing_character_reference"
  | "missing_scene_reference";

export type OneClickShotIssue = {
  kind: OneClickIssueKind;
  severity: OneClickIssueSeverity;
  label: string;
};

export type OneClickShotCheck = {
  shotNo: number;
  stableShotId: string;
  sceneKey: string;
  sceneLabel: string;
  title: string;
  dialogue: string;
  imageUrl: string | null;
  videoTakeId: number | null;
  videoUrl: string | null;
  videoAspectRatio: string | null;
  targetAspectRatio: OneClickTargetAspectRatio;
  onTimeline: boolean;
  hasCurrentImage: boolean;
  hasCurrentVideo: boolean;
  hasCharacterReference: boolean;
  hasSceneReference: boolean;
  anchorLabels: {
    character: string[];
    scene: string[];
  };
  issues: OneClickShotIssue[];
  healthScore: number;
};

export type OneClickSceneGroup = {
  key: string;
  label: string;
  checks: OneClickShotCheck[];
};

export type OneClickEditReport = {
  targetAspectRatio: OneClickTargetAspectRatio;
  totalShots: number;
  readyShots: number;
  currentVideoCount: number;
  currentImageCount: number;
  timelineCount: number;
  aspectMismatchCount: number;
  visualWarningCount: number;
  blockingCount: number;
  warningCount: number;
  checks: OneClickShotCheck[];
  sceneGroups: OneClickSceneGroup[];
};

export type OneClickAnchorCandidate = {
  id: string;
  label: string;
  imageUrl?: string;
  shotNo?: number;
  source: "prompt" | "reference" | "current_image";
};

function shotLabel(shotNo: number) {
  return `SH${String(shotNo).padStart(2, "0")}`;
}

function stableShotId(shot: CreationEditorShot, index: number): string {
  return (
    shot.stableShotId ??
    shot.shotIdentity ??
    shot.shotKey ??
    `legacy-${shotLabel(shot.shotNo || index + 1)}`
  );
}

function normalizeAspectRatio(value: string | null | undefined): string | null {
  if (!value) return null;
  const compact = value.toLowerCase().replace(/\s+/g, "");
  if (compact === "square") return "1:1";
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(compact);
  if (!match) return compact;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || height === 0) {
    return compact;
  }
  const ratio = width / height;
  if (Math.abs(ratio - 1) < 0.04) return "1:1";
  if (Math.abs(ratio - 16 / 9) < 0.04) return "16:9";
  if (Math.abs(ratio - 9 / 16) < 0.04) return "9:16";
  return compact;
}

export function aspectRatioMatches(
  value: string | null | undefined,
  target: OneClickTargetAspectRatio
): boolean {
  return normalizeAspectRatio(value) === target;
}

function hasDimension(
  shot: CreationEditorShot,
  dimension: "character_reference" | "scene_reference"
): boolean {
  const override = shot.promptOverrides?.[dimension]?.value?.trim();
  if (override) return true;
  return Boolean(shot.promptRun?.usedDimensions?.includes(dimension));
}

function promptReferenceLabels(
  shot: CreationEditorShot,
  role: "character" | "scene"
): string[] {
  const references = shot.promptRun?.references ?? [];
  return references.flatMap(reference => {
    if (role === "character") {
      return reference.kind === "characterRef" ? [reference.label] : [];
    }
    if (reference.kind === "styleRef") return [reference.label];
    return /场景|scene|空间|环境|gallery|room|wall/i.test(reference.label)
      ? [reference.label]
      : [];
  });
}

function overrideLabel(
  shot: CreationEditorShot,
  dimension: "character_reference" | "scene_reference"
): string[] {
  const value = shot.promptOverrides?.[dimension]?.value?.trim();
  if (!value) return [];
  return [value.length > 42 ? `${value.slice(0, 42)}…` : value];
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map(value => value.trim()).filter(Boolean)));
}

function materialForShot(
  materialState: StoryMaterialState | null | undefined,
  shot: CreationEditorShot,
  shotId: string
) {
  return (
    materialState?.shots.find(
      item => item.stableShotId === shotId || item.shotNo === shot.shotNo
    ) ?? null
  );
}

function selectedVideo(
  shot: CreationEditorShot,
  material: ReturnType<typeof materialForShot>
): VideoTakeAsset | null {
  return material?.currentVideo ?? shot.selectedVideoTake ?? null;
}

function scoreFromIssues(issues: readonly OneClickShotIssue[]): number {
  return Math.max(
    0,
    100 -
      issues.reduce(
        (score, issue) => score + (issue.severity === "blocking" ? 28 : 12),
        0
      )
  );
}

function issue(
  kind: OneClickIssueKind,
  severity: OneClickIssueSeverity,
  label: string
): OneClickShotIssue {
  return { kind, severity, label };
}

export function buildOneClickEditReport(input: {
  shots: readonly CreationEditorShot[];
  materialState: StoryMaterialState | null | undefined;
  timelineShotIds: readonly string[];
  targetAspectRatio: OneClickTargetAspectRatio;
}): OneClickEditReport {
  const checks = input.shots.map((shot, index): OneClickShotCheck => {
    const shotId = stableShotId(shot, index);
    const material = materialForShot(input.materialState, shot, shotId);
    const currentVideo = selectedVideo(shot, material);
    const currentImage = material?.currentImage ?? null;
    const imageUrl = currentImage?.imageUrl ?? shot.imageUrl ?? null;
    const videoUrl = currentVideo?.videoUrl ?? null;
    const onTimeline =
      input.timelineShotIds.length === 0 ||
      input.timelineShotIds.includes(shotId);
    const hasCurrentImage = Boolean(imageUrl);
    const hasCurrentVideo = Boolean(
      currentVideo?.status === "available" && currentVideo.videoUrl
    );
    const hasCharacterReference =
      hasDimension(shot, "character_reference") ||
      promptReferenceLabels(shot, "character").length > 0;
    const hasSceneReference =
      hasDimension(shot, "scene_reference") ||
      promptReferenceLabels(shot, "scene").length > 0;
    const characterLabels = unique([
      ...overrideLabel(shot, "character_reference"),
      ...promptReferenceLabels(shot, "character"),
    ]);
    const sceneLabels = unique([
      ...overrideLabel(shot, "scene_reference"),
      ...promptReferenceLabels(shot, "scene"),
    ]);
    const issues: OneClickShotIssue[] = [];

    if (!onTimeline) {
      issues.push(issue("off_timeline", "blocking", "未进入时间轴"));
    }
    if (!hasCurrentVideo) {
      issues.push(issue("missing_current_video", "blocking", "缺当前视频"));
    }
    if (!hasCurrentImage) {
      issues.push(issue("missing_current_image", "warning", "缺首帧"));
    }
    if (
      currentVideo?.aspectRatio &&
      !aspectRatioMatches(currentVideo.aspectRatio, input.targetAspectRatio)
    ) {
      issues.push(
        issue(
          "aspect_mismatch",
          "blocking",
          `${currentVideo.aspectRatio} → ${input.targetAspectRatio}`
        )
      );
    }
    if (currentVideo?.isStale) {
      issues.push(issue("stale_video", "warning", "视频已过期"));
    }
    if (!hasCharacterReference) {
      issues.push(
        issue("missing_character_reference", "warning", "缺人物锚点")
      );
    }
    if (!hasSceneReference) {
      issues.push(issue("missing_scene_reference", "warning", "缺场景锚点"));
    }

    return {
      shotNo: shot.shotNo,
      stableShotId: shotId,
      sceneKey: shot.sceneNo || "未分场",
      sceneLabel:
        [shot.sceneNo, shot.sceneTitle].filter(Boolean).join(" · ") || "未分场",
      title: shot.subject || shot.action || shotLabel(shot.shotNo),
      dialogue: shot.dialogue || shot.action || shot.visualAnchorText || "",
      imageUrl,
      videoTakeId: currentVideo?.id ?? null,
      videoUrl,
      videoAspectRatio: currentVideo?.aspectRatio ?? null,
      targetAspectRatio: input.targetAspectRatio,
      onTimeline,
      hasCurrentImage,
      hasCurrentVideo,
      hasCharacterReference,
      hasSceneReference,
      anchorLabels: {
        character: characterLabels,
        scene: sceneLabels,
      },
      issues,
      healthScore: scoreFromIssues(issues),
    };
  });

  const sceneGroups = Array.from(
    checks.reduce((groups, check) => {
      const list = groups.get(check.sceneKey) ?? [];
      list.push(check);
      groups.set(check.sceneKey, list);
      return groups;
    }, new Map<string, OneClickShotCheck[]>())
  ).map(([key, groupChecks]) => ({
    key,
    label: groupChecks[0]?.sceneLabel ?? key,
    checks: groupChecks,
  }));
  const issueList = checks.flatMap(check => check.issues);

  return {
    targetAspectRatio: input.targetAspectRatio,
    totalShots: checks.length,
    readyShots: checks.filter(check => check.issues.length === 0).length,
    currentVideoCount: checks.filter(check => check.hasCurrentVideo).length,
    currentImageCount: checks.filter(check => check.hasCurrentImage).length,
    timelineCount: checks.filter(check => check.onTimeline).length,
    aspectMismatchCount: issueList.filter(
      item => item.kind === "aspect_mismatch"
    ).length,
    visualWarningCount: issueList.filter(
      item =>
        item.kind === "missing_character_reference" ||
        item.kind === "missing_scene_reference"
    ).length,
    blockingCount: issueList.filter(item => item.severity === "blocking")
      .length,
    warningCount: issueList.filter(item => item.severity === "warning").length,
    checks,
    sceneGroups,
  };
}

export function collectOneClickAnchorCandidates(
  checks: readonly OneClickShotCheck[],
  role: "character" | "scene"
): OneClickAnchorCandidate[] {
  const candidates = new Map<string, OneClickAnchorCandidate>();
  for (const check of checks) {
    for (const label of check.anchorLabels[role]) {
      const id = `${role}:prompt:${label}`;
      candidates.set(id, {
        id,
        label,
        shotNo: check.shotNo,
        source: "prompt",
      });
    }
    if (check.imageUrl) {
      const id = `${role}:image:${check.shotNo}`;
      candidates.set(id, {
        id,
        label: `${shotLabel(check.shotNo)} 当前首帧`,
        imageUrl: check.imageUrl,
        shotNo: check.shotNo,
        source: "current_image",
      });
    }
  }
  return Array.from(candidates.values()).slice(0, 12);
}
