export type EditingActionCapability = {
  id: string;
  label: string;
  requiresMediaSelection: boolean;
  reversible: boolean;
  examples: readonly string[];
};

/**
 * 剪辑工作台的聊天能力契约。
 *
 * 右侧新增可编辑动作时，应在这里登记，并为聊天执行层补上同等能力。
 * 这份清单同时用于对话里的能力说明，避免聊聊声称自己做了尚未接通的操作。
 */
export const EDITING_ACTION_CAPABILITIES = [
  {
    id: "timeline.reorder",
    label: "移动、重排、移除或恢复镜头",
    requiresMediaSelection: false,
    reversible: true,
    examples: ["把第三镜挪到最前面", "从成片移除第二镜"],
  },
  {
    id: "timeline.duration",
    label: "修改镜头时长",
    requiresMediaSelection: false,
    reversible: true,
    examples: ["把 0102 改成 2.5 秒"],
  },
  {
    id: "video.timing",
    label: "裁切、调速、倒放、静音、音量和心跳节奏运动",
    requiresMediaSelection: true,
    reversible: true,
    examples: [
      "把选中的视频改成 0.5 倍并倒放",
      "保留 1 秒到 3 秒",
      "把选中的视频的运动频率改成一个心跳的频率",
      "让选中的视频按 90 BPM 心跳缩放",
    ],
  },
  {
    id: "visual.transform",
    label: "旋转、镜像、缩放、水平位置和垂直位置",
    requiresMediaSelection: true,
    reversible: true,
    examples: ["把选中的画面旋转 180 度", "水平翻转并放大到 120%"],
  },
  {
    id: "video.append",
    label: "把选中的视频作为新片段加入镜头",
    requiresMediaSelection: true,
    reversible: true,
    examples: ["把这个视频多添到 0201 后面"],
  },
  {
    id: "transition.propose",
    label: "分析并提出相邻镜头衔接方案",
    requiresMediaSelection: false,
    reversible: false,
    examples: ["让 0102 自然衔接到 0103"],
  },
  {
    id: "timeline.undo",
    label: "撤销当前会话中的上一步剪辑",
    requiresMediaSelection: false,
    reversible: false,
    examples: ["撤销", "把刚才的修改改回来"],
  },
] as const satisfies readonly EditingActionCapability[];

export function editingCapabilityReply(): string {
  const labels = EDITING_ACTION_CAPABILITIES.map(
    capability => capability.label
  ).join("；");
  return `现在可以直接在这里执行：${labels}。你可以先双击或选中具体图片/视频，再说“把它倒放”“旋转 180 度”；也可以直接说“把 0102 放大到 120%”。每次实际改动后都可以说“撤销”或“把刚才的修改改回来”。`;
}
