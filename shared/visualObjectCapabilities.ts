import type { VisualObjectRef } from "./visualObject";

export type VisualObjectCommand =
  | "move"
  | "split"
  | "extract-frame"
  | "chat"
  | "copy"
  | "delete"
  | "generate-video"
  | "set-anchor";

export type VisualObjectCapability = {
  command: VisualObjectCommand;
  enabled: boolean;
  disabledReason?: string;
};

const STORY_SHOT_COMMANDS: readonly VisualObjectCommand[] = [
  "move",
  "split",
  "extract-frame",
  "chat",
  "copy",
  "delete",
  "set-anchor",
];
const OWNED_CLIP_COMMANDS: readonly VisualObjectCommand[] = [
  "move",
  "split",
  "extract-frame",
  "delete",
];
const IMAGE_COMMANDS: readonly VisualObjectCommand[] = [
  "move",
  "chat",
  "copy",
  "delete",
  "generate-video",
  "set-anchor",
];

/** Capabilities follow creative meaning only; layer number and storage host are irrelevant. */
export function visualObjectCapabilities(
  object: VisualObjectRef
): readonly VisualObjectCapability[] {
  const commands =
    object.type === "story-shot"
      ? STORY_SHOT_COMMANDS
      : object.type === "owned-video-clip"
        ? OWNED_CLIP_COMMANDS
        : IMAGE_COMMANDS;
  return commands.map(command => ({ command, enabled: true }));
}

/** Legacy overlays are readable, but writes stay visibly disabled until U6 normalizes them. */
export const LEGACY_OVERLAY_WRITE_CAPABILITY: VisualObjectCapability = {
  command: "move",
  enabled: false,
  disabledReason: "旧版叠加素材需先转换后才能修改",
};

export function createVisualObjectPendingGuard() {
  const identities = new Set<string>();
  return {
    isPending(identity: string) {
      return identities.has(identity);
    },
    async run<T>(
      identity: string,
      command: () => Promise<T>
    ): Promise<T | null> {
      if (identities.has(identity)) return null;
      identities.add(identity);
      try {
        return await command();
      } finally {
        identities.delete(identity);
      }
    },
  };
}
