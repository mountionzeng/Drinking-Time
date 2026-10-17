/** Only explicit alternative requests branch. Local edits remain in the editor. */
export function creativeVersionIntent(text: string): "fork" | "clarify" | null {
  const value = text.trim();
  if (!value || /[“「『"].*(?:原版|另一版|新版本).*?[”」』"]/.test(value)) return null;
  if (/(?:不要|不用|别|不想|不必).{0,6}(?:另|新建|新版本|再做|再来|再写|保留|留着)/.test(value)) return null;
  const alternative = /(?:再|另)(?:来|做|写|试|生成)(?:一|个|一个|一种)?.*(?:版|方案)|另存(?:一版|为)|新建(?:一个)?版本/.test(value);
  const preserve = /(?:保留|留着|留下).{0,6}(?:原|旧|这|当前)|(?:原|旧|这|当前).{0,6}(?:保留|留着|留下|不动)/.test(value);
  if (alternative && preserve) return "fork";
  if (/^(?:请|帮我|咱们)?(?:换个感觉|换一种感觉|再试一种风格|试试另一种风格)[。！!？?]*$/.test(value)) return "clarify";
  return null;
}
