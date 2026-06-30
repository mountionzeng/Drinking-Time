import type {
  PromptModality,
  PromptNode,
  PromptNodeBinding,
  PromptRevision,
} from "./promptLineage";
import { normalizePromptWeight } from "./promptDimensionWeights";

export type CompiledPromptTarget = {
  modality: Exclude<PromptModality, "shared">;
  finalText: string;
  revisionIds: number[];
  inputFingerprint: string;
};

type CompiledPromptInput = {
  nodeId: number;
  dimension: string;
  revisionId: number;
  content: string;
  weight: number;
};

type CompileInput = {
  stableShotId: string;
  nodes: readonly PromptNode[];
  revisions: readonly PromptRevision[];
  bindings: readonly PromptNodeBinding[];
  revisionOverrides?: Readonly<Record<number, number>>;
};

const targets = ["dialogue", "image", "video"] as const;

function fingerprint(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function scopeRank(node: PromptNode): number {
  if (node.scope === "story") return 0;
  if (node.scope === "shot") return 1;
  return 2;
}

function renderWeight(weight: number): string {
  return `${Math.round(normalizePromptWeight(weight) * 100)}%`;
}

export function renderCompiledPromptText(
  inputs: readonly Pick<CompiledPromptInput, "dimension" | "content" | "weight">[],
): string {
  return inputs
    .map(
      input =>
        `${input.dimension}(${renderWeight(input.weight)}): ${input.content}`,
    )
    .join("\n");
}

export function fingerprintCompiledPromptInputs(input: {
  stableShotId: string;
  modality: Exclude<PromptModality, "shared">;
  inputs: readonly CompiledPromptInput[];
}): string {
  return fingerprint(
    JSON.stringify({
      stableShotId: input.stableShotId,
      modality: input.modality,
      inputs: input.inputs.map(item => ({
        nodeId: item.nodeId,
        dimension: item.dimension,
        revisionId: item.revisionId,
        content: item.content,
        weight: normalizePromptWeight(item.weight),
      })),
    }),
  );
}

export function compilePromptTargets(
  input: CompileInput,
): Record<(typeof targets)[number], CompiledPromptTarget> {
  const revisionById = new Map(
    input.revisions.map(revision => [revision.id, revision]),
  );
  const bindingOrder = new Map(
    input.bindings
      .filter(
        binding =>
          binding.stableShotId == null ||
          binding.stableShotId === input.stableShotId,
      )
      .map(binding => [binding.nodeId, binding.sortOrder]),
  );

  const eligibleNodes = input.nodes
    .filter(
      node =>
        node.scope === "story" || node.stableShotId === input.stableShotId,
    )
    .sort((left, right) => {
      const scopeDelta = scopeRank(left) - scopeRank(right);
      if (scopeDelta !== 0) return scopeDelta;
      const orderDelta =
        (bindingOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
        (bindingOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER);
      return orderDelta || left.id - right.id;
    });

  return Object.fromEntries(
    targets.map(modality => {
      const inputs = eligibleNodes
        .filter(
          node => node.modality === "shared" || node.modality === modality,
        )
        .map(node => {
          const revisionId =
            input.revisionOverrides?.[node.id] ?? node.currentRevisionId;
          const revision =
            revisionId == null ? undefined : revisionById.get(revisionId);
          if (!revision || revision.nodeId !== node.id) return null;
          return { node, revision };
        })
        .filter(
          (
            value,
          ): value is {
            node: PromptNode;
            revision: PromptRevision;
          } => Boolean(value),
        )
        .map(({ node, revision }) => ({
          nodeId: node.id,
          dimension: node.dimension,
          revisionId: revision.id,
          content: revision.content,
          weight: normalizePromptWeight(revision.weight),
        }));
      const finalText = renderCompiledPromptText(inputs);
      const revisionIds = inputs.map(input => input.revisionId);
      return [
        modality,
        {
          modality,
          finalText,
          revisionIds,
          inputFingerprint: fingerprintCompiledPromptInputs({
            stableShotId: input.stableShotId,
            modality,
            inputs,
          }),
        },
      ];
    }),
  ) as Record<(typeof targets)[number], CompiledPromptTarget>;
}
