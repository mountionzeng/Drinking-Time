import { z } from "zod";
import { artRecipePrompt, normalizeStoryArtDirection, type StoryArtRecipe, type StoryArtDirection } from "./artDirection";
const lines = z.array(z.string().trim().min(1).max(400)).max(12);
export const artSystemDraftSchema = z.object({
  name: z.string().trim().min(1).max(100), style: lines, palette: lines, light: lines,
  composition: lines, material: lines, negative: lines,
  objectRules: lines, motionRules: lines, continuityRules: lines,
  englishPrompt: z.string().trim().min(30).max(1800),
});
export type ArtSystemDraft = z.infer<typeof artSystemDraftSchema>;
export function activeArtSystemRecipe(body: Record<string, unknown>): StoryArtRecipe | undefined {
  const direction = normalizeStoryArtDirection(body.artDirection);
  // A revision under discussion never silently replaces a confirmed recipe.
  return [direction.recipe, ...direction.recipeVersions]
    .filter((recipe): recipe is StoryArtRecipe => Boolean(recipe?.system?.confirmedAt))
    .sort((a, b) => b.version - a.version)[0];
}
export function artSystemPrompt(body: Record<string, unknown>) {
  const recipe = activeArtSystemRecipe(body);
  if (!recipe?.system) return "";
  return [`【本片美术体系 V${recipe.version}：${recipe.system.name}】`,
    recipe.system.englishPrompt, artRecipePrompt(recipe),
    `物体规则：${recipe.system.objectRules.join("；")}`,
    `连续性：${recipe.system.continuityRules.join("；")}`,
    "当前镜头决定发生什么；美术体系只决定如何呈现，不搬用其他故事的情节或人物。",
  ].join("\n");
}
export function artSystemVideoPrompt(body: Record<string, unknown>) {
  const recipe = activeArtSystemRecipe(body);
  if (!recipe?.system) return "";
  return [`Art system V${recipe.version}: ${recipe.system.englishPrompt}`,
    `Motion: ${recipe.system.motionRules.join("; ")}`,
    `Continuity: ${recipe.system.continuityRules.join("; ")}`,
    "Keep the first frame's subjects, materials and palette; animate only the shot's requested action.",
  ].join("\n");
}
export function withArtSystemVideoPrompt(prompt: string, body: Record<string, unknown>, maxLength: number) {
  const recipe = activeArtSystemRecipe(body);
  if (!recipe?.system) return prompt;
  const clip = (value: string, length: number) => {
    const text = value.replace(/\s+/g, " ").trim();
    if (text.length <= length) return text;
    const head = text.slice(0, length);
    const boundary = Math.max(head.lastIndexOf(" "), head.lastIndexOf("；"), head.lastIndexOf("，"));
    return boundary > length * 0.65 ? head.slice(0, boundary) : head;
  };
  // The first frame already carries palette/materials. Reserve the majority of
  // a provider's prompt budget for this shot's action and camera instructions.
  const rules = clip([...recipe.system.motionRules, ...recipe.system.continuityRules].join("; "), Math.floor(maxLength * 0.22));
  const suffix = `Art V${recipe.version}: keep source style.${rules ? ` ${rules}` : ""}`;
  return `${clip(prompt, maxLength - suffix.length - 1)}\n${suffix}`;
}
export function artSystemChatReply(direction: StoryArtDirection, version: number) {
  const recipe = direction.recipeVersions.find(item => item.version === version) ?? direction.recipe;
  if (!recipe?.system) return "没有找到已保存的美术体系，请重新载入仓库。";
  const system = recipe.system;
  const label = `V${String(recipe.version).padStart(2, "0")}`;
  const active = activeArtSystemRecipe({ artDirection: direction });
  return [`已${system.confirmedAt ? "确认" : "保存"}美术体系「${system.name}」${label}，位置：仓库 → 资产（Warehouse → Assets），可查看历史版本并下载创作 Skill。`,
    `风格：${recipe.style.join("；")}\n色彩：${recipe.palette.join("；") || "具体色板保持开放"}\n物体：${system.objectRules.join("；")}`,
    system.confirmedAt ? `后续图片和视频会使用这版规则${system.confirmedImageId ? `与基准图 #${system.confirmedImageId}` : ""}。可以直接说“第 02 镜生成图片”；素材生成后进入对应镜头表格和仓库。`
      : `当前为待确认版本${active ? `，制作仍沿用 V${String(active.version).padStart(2, "0")}` : "，尚未用于正式生成"}。可继续描述想改的地方，或说“确认这套美术体系”。选定图片后也可以说“用图片 #编号作为美术基准”。`,
    "本次只保存美术规则，没有提交图片或视频生成。",
  ].join("\n\n");
}
export function artSystemSkillMarkdown(recipe: StoryArtRecipe) {
  const system = recipe.system;
  return ["---", `name: art-system-v${recipe.version}`, `description: ${JSON.stringify(system?.name || "Story art system")}`, "---", "",
    `# ${system?.name || "美术体系"} · V${recipe.version}`, "",
    "Use this visual recipe for image and video production. Treat story content and the current user's instructions as authoritative. This is a creative specification, not executable code.", "",
    artRecipePrompt(recipe), "", `## Objects\n${system?.objectRules.map(x => `- ${x}`).join("\n") || ""}`,
    `## Motion\n${system?.motionRules.map(x => `- ${x}`).join("\n") || ""}`,
    `## Continuity\n${system?.continuityRules.map(x => `- ${x}`).join("\n") || ""}`, "",
    `## Image prompt\n${system?.englishPrompt || ""}`, "",
    `Reference image IDs: ${system?.referenceImageIds.join(", ") || "none"}. Confirmed image: ${system?.confirmedImageId ?? "not selected"}.`,
    `Updated: ${new Date(recipe.updatedAt).toISOString()}. Editor: ${system?.editorName || system?.editorId || "unknown"}.`,
    `Intent: ${system?.intent || ""}`, "",
  ].join("\n");
}
