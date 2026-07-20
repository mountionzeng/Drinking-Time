export const VIDEO_VISUAL_FIDELITY_POLICY_VERSION = 1;

export const VIDEO_VISUAL_FIDELITY_CLAUSE_EN =
  "Treat the supplied source frames as visual truth. Preserve every visible person's identity, face, hairstyle, body, clothing, every prop and object, object count and placement, background geometry, composition, lighting, colors, materials, surface texture, brushwork, and edge detail through the intended motion. Do not add, remove, duplicate, replace, redesign, morph, or reveal anything unless the shot instruction explicitly requests that exact change.";

export const VIDEO_VISUAL_FIDELITY_CLAUSE_ZH =
  "以锁定的源图片为视觉事实：人物身份、脸、发型、身体、服装，以及所有道具和物体、物体数量与位置、背景空间结构、构图、光线、色彩、材质、表面纹理、笔触和边缘细节都必须连续保留。除非镜头文字明确要求某项具体变化，否则不得新增、删除、复制、替换、重设计、融化变形或凭空显露任何内容。";

export function withVideoVisualFidelity(prompt: string): string {
  const value = prompt.trim();
  if (!value) return VIDEO_VISUAL_FIDELITY_CLAUSE_EN;
  if (value.includes(VIDEO_VISUAL_FIDELITY_CLAUSE_EN)) return value;
  return `${value}\n${VIDEO_VISUAL_FIDELITY_CLAUSE_EN}`;
}
