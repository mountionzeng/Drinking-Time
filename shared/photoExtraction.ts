/** Short replies have an explicit category; descriptive replies stay verbatim for vision. */
export function photoExtractionTarget(
  focus: string
): "character" | "pet" | "scene" | "object" | "all" | "custom" {
  const reply = focus
    .trim()
    .replace(/[。！!]/g, "")
    .replace(/^(?:请)?(?:只)?(?:提取|保留)/, "");
  if (/^(人物|人像|这个人|人)$/.test(reply)) return "character";
  if (/^(宠物|小猫|猫咪|猫|小狗|狗|这只猫|这只小猫|这只狗)$/.test(reply))
    return "pet";
  if (/^(背景|场景|背景场景)$/.test(reply)) return "scene";
  if (/^(物体|物品|道具)$/.test(reply)) return "object";
  if (/^(整张|全部|整张图片|整张照片)$/.test(reply)) return "all";
  return "custom";
}

export function isPhotoSaveOnlyReply(text: string): boolean {
  const reply = text.trim()
    .replace(/^(?:不要|不用|无需)(?:提取|分析|识别)[，,。\s]*/, "")
    .replace(/[，,。\s]*(?:不要|不用|无需)(?:提取|分析|识别|生成)[。！!]?$/, "");
  return /^(?:只|先|仅)(?:保存|上传)(?:图片|照片)?[。！!]?$/u.test(reply);
}

export const PHOTO_EXTRACTION_QUESTION = "你想提取图片里的哪一部分？";
export const PHOTO_EXTRACTION_REPLIES = [
  "只提取人物",
  "只提取宠物",
  "只提取背景",
  "只提取物体",
  "提取整张",
  "只保存图片",
] as const;
