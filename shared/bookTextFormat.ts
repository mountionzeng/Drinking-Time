import { bookLatexParts } from './bookLatex';

export type BookTextPart =
  | { kind: 'text'; raw: string; literal?: boolean }
  | { kind: 'math'; raw: string; formula: string; display: boolean }
  | { kind: 'strong' | 'emphasis' | 'heading'; raw: string; children: BookTextPart[]; command: string; markdown: boolean; level?: number };

function escaped(text: string, at: number) {
  let slashes = 0;
  while (at > 0 && text[--at] === '\\') slashes++;
  return slashes % 2 === 1;
}
function closingBrace(text: string, start: number) {
  let depth = 1;
  for (let i = start; i < text.length; i++) {
    if (escaped(text, i)) continue;
    if (text[i] === '`') {
      const marker = text.startsWith('```', i) ? '```' : '`';
      const end = text.indexOf(marker, i + marker.length);
      if (end < 0) return -1;
      i = end + marker.length - 1;
      continue;
    }
    if (text[i] === '{') depth++;
    if (text[i] === '}' && --depth === 0) return i;
  }
  return -1;
}

/** A small, safe text-format grammar, not a TeX document compiler or HTML renderer. */
export function bookTextParts(text: string, depth = 0): BookTextPart[] {
  if (depth >= 8) return [{ kind: 'text', raw: text }];
  const math = new Map(bookLatexParts(text).filter(part => part.kind === 'math').map(part => [part.start, part]));
  const parts: BookTextPart[] = [];
  let start = 0, i = 0;
  const flush = (end: number) => { if (end > start) parts.push({ kind: 'text', raw: text.slice(start, end) }); };
  while (i < text.length) {
    if (escaped(text, i)) { i++; continue; }
    if (text[i] === '`') {
      const marker = text.startsWith('```', i) ? '```' : '`';
      const closing = text.indexOf(marker, i + marker.length);
      const end = closing < 0 ? text.length : closing + marker.length;
      flush(i); parts.push({ kind: 'text', raw: text.slice(i, end), literal: true });
      start = i = end; continue;
    }
    const formula = math.get(i);
    if (formula) {
      flush(i); parts.push({ kind: 'math', raw: formula.raw, formula: formula.formula!, display: Boolean(formula.display) });
      start = i = formula.end; continue;
    }
    const heading = (i === 0 || text[i - 1] === '\n') ? /^(#{1,6})[ \t]+([^\n]+)/.exec(text.slice(i)) : null;
    if (heading) {
      const level = Math.min(heading[1].length, 3);
      flush(i); parts.push({ kind: 'heading', raw: heading[0], children: bookTextParts(heading[2], depth + 1), command: ['section', 'subsection', 'subsubsection'][level - 1], markdown: true, level });
      start = i = i + heading[0].length; continue;
    }
    const command = text[i] === '\\' ? /^\\(textbf|textit|emph|section|subsection|subsubsection)\{/.exec(text.slice(i)) : null;
    if (command) {
      const contentStart = i + command[0].length;
      const end = closingBrace(text, contentStart);
      if (end >= 0) {
        const level = ['section', 'subsection', 'subsubsection'].indexOf(command[1]) + 1;
        flush(i); parts.push({ kind: level ? 'heading' : command[1] === 'textbf' ? 'strong' : 'emphasis', raw: text.slice(i, end + 1), children: bookTextParts(text.slice(contentStart, end), depth + 1), command: command[1], markdown: false, ...(level ? { level } : {}) });
        start = i = end + 1; continue;
      }
      // An unfinished command stays literal, including its unfinished children.
      // Do not repeatedly rescan an arbitrarily long sequence of unmatched braces.
      break;
    }
    const marker = text.startsWith('**', i) ? '**' : text.startsWith('__', i) && !/[\p{L}\p{N}_]/u.test(text[i - 1] ?? '') ? '__' : null;
    if (marker && text[i + 2] && !/\s/.test(text[i + 2]) && text[i + 2] !== marker[0]) {
      let end = -1;
      for (let j = i + 2; j < text.length && text[j] !== '\n'; j++) {
        const nestedMath = math.get(j);
        if (nestedMath) { j = nestedMath.end - 1; continue; }
        if (text[j] === '`' && !escaped(text, j)) {
          const fence = text.startsWith('```', j) ? '```' : '`';
          const close = text.indexOf(fence, j + fence.length);
          if (close < 0) break;
          j = close + fence.length - 1; continue;
        }
        if (text.startsWith(marker, j) && !escaped(text, j)) { end = j; break; }
      }
      const content = end >= 0 ? text.slice(i + 2, end) : '';
      if (content && !content.includes('\n') && !/\s$/.test(content)) {
        flush(i); parts.push({ kind: 'strong', raw: text.slice(i, end + 2), children: bookTextParts(content, depth + 1), command: 'textbf', markdown: true });
        start = i = end + 2; continue;
      }
    }
    i++;
  }
  flush(text.length);
  return parts;
}

/** Only format model-created text. Never run over saved manual text or outside a rewrite selection. */
export function generatedBookText(text: string) {
  const escapeText = (raw: string) => raw.replace(/\\(?:textbackslash\{\}|[{}%&#_$])|[\\{}%&#_$]/g, char => char.length > 1 ? char : char === '\\' ? '\\textbackslash{}' : `\\${char}`);
  function write(parts: BookTextPart[], inside = false): string {
    return parts.map(part => {
      if (part.kind === 'math') return part.raw;
      if (part.kind === 'text') return inside && !part.literal ? escapeText(part.raw) : part.raw;
      return `\\${part.command}{${write(part.children, part.markdown)}}`;
    }).join('');
  }
  return write(bookTextParts(text));
}

export function displayLatexText(text: string) {
  return text.replace(/\\textbackslash\{\}|\\([{}%&#_$])/g, (_, char: string | undefined) => char ?? '\\');
}

export const BOOK_TEXT_FORMAT_RULE = String.raw`正文使用可直接阅读的普通文字与 LaTeX 格式，不使用 Markdown 的 **、__、# 标题标记。需要加粗时写 \textbf{文字}，标题单独一段可写 \section{标题} / \subsection{标题}；不要给每段都加格式。数学公式保留 $...$、\(...\)、$$...$$ 或 \[...\]，不要把普通中文段落放进数学环境。不输出导言区、宏包或完整TeX文档。返回JSON时必须正确转义反斜杠（JSON字符串里写双反斜杠），不能将\textbf的\t变成制表符。`;
