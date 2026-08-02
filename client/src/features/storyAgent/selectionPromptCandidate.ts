import type { StoryPromptAggregate } from "@shared/promptLineage";
import type { SelectionContext } from "@shared/selectionContext";
import type { StoryShot } from "./types";
import { displayShotCode } from "@shared/shotIdentity";

const SHOT_FIELD_DIMENSIONS: Record<string, string> = {
  subject: "subject",
  action: "action",
  dialogue: "dialogue",
  emotion: "mood",
  intent: "intent",
  rationale: "rationale",
  beat: "beat",
  cameraMove: "camera_motion",
  location: "location",
  timeLight: "time_light",
  mood: "mood",
  sound: "sound",
  styleRef: "style_reference",
  videoPrompt: "video_prompt",
  promptDraft: "image_prompt",
  negativePrompt: "negative_prompt",
};

export type SelectionPromptTarget = {
  nodeId: number;
  stableShotId: string;
  dimension: string;
  label: string;
  currentContent: string | null;
};

export function resolveSelectionEditText(input: {
  selection: Pick<
    SelectionContext,
    "sourceType" | "selectedText" | "fullText"
  >;
  target: SelectionPromptTarget | null;
}): { fullText: string; selectedText: string } {
  const currentContent = input.target?.currentContent?.trim();
  if (
    input.selection.sourceType === "storyboard-image" &&
    currentContent
  ) {
    return {
      fullText: currentContent,
      selectedText: currentContent,
    };
  }
  return {
    fullText: input.selection.fullText,
    selectedText: input.selection.selectedText,
  };
}

function shotIdentity(shot: StoryShot | undefined): string | null {
  return shot?.stableShotId?.trim() || shot?.shotIdentity?.trim() || null;
}

export type FoundPromptLineageNode = {
  nodeId: number;
  currentContent: string | null;
};

/**
 * 按（维度, stableShotId）在故事的提示词聚合里找目标节点：优先镜头局部节点，
 * 其次故事级共享节点（同层内 id 越大越靠前，即越晚创建的候选优先）。
 *
 * 从 resolveSelectionPromptTarget 里提出来，供阶段 C（聊天触发候选）复用——
 * 避免第三次重写同一段"故事 vs 镜头作用域"匹配逻辑。
 */
export function findPromptLineageNode(input: {
  aggregate: StoryPromptAggregate;
  dimension: string;
  stableShotId: string;
}): FoundPromptLineageNode | null {
  const candidates = input.aggregate.nodes
    .filter(
      node =>
        node.dimension === input.dimension &&
        (node.stableShotId === input.stableShotId || node.scope === "story"),
    )
    .sort((left, right) => {
      const leftLocal = left.stableShotId === input.stableShotId ? 1 : 0;
      const rightLocal = right.stableShotId === input.stableShotId ? 1 : 0;
      return rightLocal - leftLocal || right.id - left.id;
    });
  const node = candidates[0];
  if (!node) return null;
  const currentRevision =
    node.currentRevisionId == null
      ? undefined
      : input.aggregate.revisions.find(
          revision => revision.id === node.currentRevisionId,
        );
  return { nodeId: node.id, currentContent: currentRevision?.content ?? null };
}

export function resolveSelectionPromptTarget(input: {
  selection: SelectionContext;
  shots: readonly StoryShot[];
  aggregate: StoryPromptAggregate;
}): SelectionPromptTarget | null {
  const isStoryboardImage =
    input.selection.sourceType === "storyboard-image";
  if (input.selection.sourceType !== "shot" && !isStoryboardImage) return null;

  const [rawIndex, field] = input.selection.sourceId.split(":");
  const index = input.selection.sourceType === "shot" ? Number(rawIndex) : -1;
  const dimension = isStoryboardImage
    ? "image_prompt"
    : SHOT_FIELD_DIMENSIONS[field];
  if (!dimension) return null;
  const shotByNumber =
    input.selection.shotNo == null
      ? undefined
      : input.shots.find(shot => shot.shotNo === input.selection.shotNo);
  const stableShotId =
    input.selection.stableShotId?.trim() ||
    shotIdentity(shotByNumber) ||
    shotIdentity(Number.isInteger(index) ? input.shots[index] : undefined);
  if (!stableShotId) return null;

  const found = findPromptLineageNode({ aggregate: input.aggregate, dimension, stableShotId });
  if (!found) return null;
  return {
    nodeId: found.nodeId,
    stableShotId,
    dimension,
    currentContent: found.currentContent,
    label: `${displayShotCode({
      cueCode:
        input.selection.cueCode ??
        (Number.isInteger(index) ? input.shots[index]?.cueCode : null),
      shotNo: input.selection.shotNo ?? index + 1,
    })} · ${isStoryboardImage ? "图片要求" : field}`,
  };
}
