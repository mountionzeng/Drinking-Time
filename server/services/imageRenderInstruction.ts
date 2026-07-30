const DEFAULT_PROMPT_LIMIT = 3_400;

export function applyStoryFrameVisualTruth(
  prompt: string,
  maxLength = DEFAULT_PROMPT_LIMIT
): string {
  const block = [
    "SUPPLIED STORYBOARD FRAMES ARE THE VISUAL SOURCE OF TRUTH — HIGHEST PRIORITY:",
    "Generate inside the same story world shown by the supplied current and neighboring storyboard frames.",
    "Preserve their character identity, apparent age, face, hair, clothing, location, architecture, props, palette, lighting, materials, texture, and production design unless the user's direct instruction explicitly changes one of them.",
    "EXACT CHARACTER AND WARDROBE LOCK: preserve the exact clothing construction, silhouette, neckline, back exposure, straps, sleeves, hem, fabric, fit, hairstyle, and grooming visible in the supplied frames. Do not redesign, restyle, simplify, or replace them.",
    "GARMENT LENGTH IS IDENTITY: when the primary frame shows a floor-length or ankle-length gown, its hem must remain at the floor and cover the legs exactly as shown. Never shorten it into a calf-length, knee-length, mini, tunic, or short dress.",
    "PRIMARY PALETTE LOCK: preserve the dominant hue family of the primary frame. Do not introduce blue, cyan, teal, or another cool color cast when it is absent from the primary frame.",
    "NO NEW ACCESSORIES: if eyewear, sunglasses, blindfolds, hats, jewelry, gloves, belts, bags, or other accessories are absent from the supplied frames, they must remain absent.",
    "Treat scene-art-library text and story metadata as narrative guidance only. Ignore any art-library element that conflicts with or is not visually supported by the supplied storyboard frames.",
    "Do not introduce unrelated people, costumes, rooms, props, symbols, text, or a different visual genre.",
  ].join("\n");
  const availablePromptLength = Math.max(0, maxLength - block.length - 2);
  const preservedPrompt = prompt.trim().slice(0, availablePromptLength);
  return preservedPrompt
    ? `${block}\n\n${preservedPrompt}`
    : block.slice(0, maxLength);
}

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
