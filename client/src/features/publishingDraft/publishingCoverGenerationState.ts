export type CoverGenerationMode = "fresh" | "revise";

export function getCoverGenerationPresentation(
  mode: CoverGenerationMode | null
) {
  return {
    freshLoading: mode === "fresh",
    reviseLoading: mode === "revise",
    message:
      mode === "fresh"
        ? "正在生成新一轮 4 张候选。为避免重复扣费，其他出图操作暂时锁定。"
        : mode === "revise"
          ? "正在基于这张候选生成 4 张新图。为避免重复扣费，其他出图操作暂时锁定。"
          : null,
  };
}
