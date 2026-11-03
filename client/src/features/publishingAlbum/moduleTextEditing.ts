export type TextPosition = { start: number; end: number };
export const textModuleLines = (body: string) => body.replace(/\r\n?/g, '\n').split('\n');

export function textModuleOffset(body: string, index: number) {
  return textModuleLines(body).slice(0, index).reduce((sum, line) => sum + line.length + 1, 0);
}

export function textModulePosition(body: string, position: number) {
  const before = body.slice(0, Math.max(0, Math.min(position, body.length)));
  const lines = before.split('\n');
  return { index: lines.length - 1, cursor: lines[lines.length - 1].length };
}

/** Preserve empty and repeated lines: every Enter creates a distinct editable slot. */
export function replaceTextModule(body: string, index: number, value: string, cursor: number) {
  const lines = textModuleLines(body);
  const normalized = value.replace(/\r\n?/g, '\n');
  const offset = textModuleOffset(body, index);
  lines.splice(index, 1, ...normalized.split('\n'));
  const next = lines.join('\n');
  const position = offset + value.slice(0, cursor).replace(/\r\n?/g, '\n').length;
  return { body: next, position };
}

/**
 * 生成稿（模型输出）段落之间是空行，写进书稿后每个空行都会变成一个空的
 * 「写下这一段…」模块。只在写入生成稿时去掉空白行；用户手动敲出的空行
 * 仍按 replaceTextModule 的约定保留。规则与 chapterPackageLines 一致。
 */
export function compactGeneratedBody(body: string): string {
  return textModuleLines(body).filter(line => line.trim() !== '').join('\n');
}
