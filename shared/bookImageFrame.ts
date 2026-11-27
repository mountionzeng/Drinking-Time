export const bookImageRatios = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"] as const;
export type BookImageRatio = typeof bookImageRatios[number];
export const squareBookImage: BookImageRatio = "1:1";
export function supportsBookGptRatio(ratio: string) {
  return ["1:1", "3:2", "2:3"].includes(ratio);
}

export function isBookImageRatio(value: unknown): value is BookImageRatio {
  return bookImageRatios.some(ratio => ratio === value);
}

/** Read an instruction about the canvas, independently of the shape of objects inside the frame. */
export function bookImageRatioRequest(text: string) {
  if (/[？?]/u.test(text)) return;
  const command = text.trim().replace(/[。！!]+$/u, "").trim();
  const match = /^(?:请|麻烦|帮我|我想|我要|请帮我)?\s*(?:把|将|让)?\s*(?:(?:之后|以后|接下来|默认|全片|本片|所有|全部|整本|整篇|这部片子)(?:的)?\s*)*(?:(?:第\s*(\d{1,4})\s*镜(?:头)?|(这张|这幅|这次|这一镜|本镜))(?:的)?\s*)?(?:(?:书页|书里|分镜|新生成|生成|渲染)(?:的)?)?(?:图片|图像|插图|画面|出图|生图|图)?(?:默认|都|的)?(?:尺寸|画幅|宽高比|比例)?\s*(?:(?:调|设|改|换|变|做)(?:整|置)?(?:为|成|到)|用|使用|要|按|保持|恢复(?:为|成)?|是|为)?\s*(正方形|正方图|方形|方图|横(?:向|屏|版|图)|竖(?:向|屏|版|图)|\d{1,2}\s*[:：比]\s*\d{1,2})(?:的)?(?:比例|尺寸|画幅|图片|图)?$/u.exec(command);
  if (!match) return;
  const token = match[3].replace(/\s/g, "").replace(/[：比]/, ":");
  const ratio = /^方|^正方/u.test(token) ? "1:1" : token.startsWith("横") ? "16:9" : token.startsWith("竖") ? "9:16" : token;
  if (!isBookImageRatio(ratio)) return;
  return { ratio, shotNo: match[1] ? Number(match[1]) : undefined, current: Boolean(match[2]) };
}

export function bookRoundRatio(adjustment?: string) {
  return adjustment?.split(/[，,。；;\n]/u).map(bookImageRatioRequest).filter(Boolean).at(-1)?.ratio;
}
