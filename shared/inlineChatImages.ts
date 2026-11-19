/** Stored in message/draft text so inline positions survive the existing archive. */
export const inlineImageToken = (id: number) => `[[ref:image%3A${id}]]`;
export const hasInlineChatImages = (text: string) => text.includes('[[ref:');
export type InlineChatPart = { text: string; imageId?: number };
export function inlineChatParts(text: string): InlineChatPart[] {
  return text.split(/(\[\[ref:[^\]\n]+\]\])/g).filter(Boolean).map(text => {
    if (!text.startsWith('[[ref:')) return { text };
    let key = '';
    try { key = decodeURIComponent(text.slice(6, -2)); } catch { /* invalid reference below */ }
    if (!/^image:[1-9]\d*$/.test(key) || !Number.isSafeInteger(Number(key.slice(6))))
      throw new Error('图片引用无效，请删除后从仓库重新选择');
    return { text, imageId: Number(key.slice(6)) };
  });
}
export function inlineChatImageIds(text: string): number[] {
  const ids = [...new Set(inlineChatParts(text).flatMap(p => p.imageId ? [p.imageId] : []))];
  if (ids.length > 4) throw new Error('一次最多引用 4 张图片，请移除多余图片');
  return ids;
}
export function inlineChatInstruction(text: string): string {
  const ids = inlineChatImageIds(text);
  return inlineChatParts(text).map(p => p.imageId ? `图${ids.indexOf(p.imageId) + 1}（图片 #${p.imageId}）` : p.text).join('');
}
