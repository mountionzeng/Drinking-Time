const DEFAULT_PROMPT_LIMIT = 3_400;

export function applyExplicitImageRenderInstruction(
  basePrompt: string,
  instruction: string | null | undefined,
  maxLength = DEFAULT_PROMPT_LIMIT
): string {
  const explicitInstruction = instruction?.trim();
  if (!explicitInstruction) return basePrompt.trim();

  const block = [
    "USER DIRECT EDIT INSTRUCTION — HIGHEST PRIORITY:",
    explicitInstruction,
    "Execute every requested change literally. This is a mandatory instruction, not a weighted suggestion.",
    "Keep the established film style, character identity, clothing, hair, materials, objects, lighting language, and all details not explicitly changed. Do not add or remove anything unless requested.",
  ].join("\n");

  const availableBaseLength = Math.max(0, maxLength - block.length - 2);
  const preservedBase = basePrompt.trim().slice(0, availableBaseLength);
  return preservedBase
    ? `${block}\n\n${preservedBase}`
    : block.slice(0, maxLength);
}
