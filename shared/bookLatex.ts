export type BookLatexPart = { kind: 'text' | 'math'; raw: string; start: number; end: number; formula?: string; display?: boolean };

function escaped(text: string, at: number) {
  let count = 0;
  while (at > 0 && text[--at] === '\\') count++;
  return count % 2 === 1;
}

/** Explicit delimiters only; ordinary currency and unfinished input stay literal. */
export function bookLatexParts(text: string): BookLatexPart[] {
  const parts: BookLatexPart[] = [];
  const missingClosers=new Set<string>();
  let plain = 0, i = 0;
  while (i < text.length) {
    if (escaped(text, i)) { i++; continue; }
    // Markdown code examples are source text, not equations.
    if (text[i] === '`') {
      const fence = text.startsWith('```', i) ? '```' : '`';
      const end = text.indexOf(fence, i + fence.length);
      i = end < 0 ? text.length : end + fence.length; continue;
    }
    const open = text.startsWith('$$', i) ? '$$' : text.startsWith('\\[', i) ? '\\[' : text.startsWith('\\(', i) ? '\\(' : text[i] === '$' ? '$' : null;
    if (!open || open === '$' && (/\s/.test(text[i + 1] ?? '') || !text[i + 1])) { i++; continue; }
    const close = open === '\\[' ? '\\]' : open === '\\(' ? '\\)' : open;
    if(missingClosers.has(close)){i+=open.length;continue;}
    let end = i + open.length;
    for (; end < text.length; end++) {
      if (open === '$' && text[end] === '\n') break;
      if (text.startsWith(close, end) && !escaped(text, end) && (open !== '$' || text[end + 1] !== '$')) break;
    }
    const formula = text.slice(i + open.length, end);
    if(end===text.length)missingClosers.add(close);
    const valid = text.startsWith(close, end) && formula.trim() && !(open === '$' && (/\s$/.test(formula) || /^\d/.test(text[end + 1] ?? '')));
    if (!valid) { i += open.length; continue; }
    if (plain < i) parts.push({ kind:'text', raw:text.slice(plain,i), start:plain, end:i });
    const after = end + close.length;
    parts.push({kind:'math',raw:text.slice(i,after),formula,display:open==='$$'||open==='\\[',start:i,end:after});
    plain = i = after;
  }
  if (plain < text.length || !parts.length) parts.push({kind:'text',raw:text.slice(plain),start:plain,end:text.length});
  return parts;
}

/** New/pasted display equations keep their physical newlines in one stable module. */
export function splitBookTextModules(text: string) {
  const normalized = text.replace(/\r\n?/g, '\n');
  const math = bookLatexParts(normalized).filter(part => part.kind === 'math');
  const result: string[] = [];
  let start = 0, partIndex = 0;
  for (let i = 0; i < normalized.length; i++) {
    while (math[partIndex] && math[partIndex].end <= i) partIndex++;
    if (normalized[i] === '\n' && !(math[partIndex] && i > math[partIndex].start && i < math[partIndex].end)) {
      result.push(normalized.slice(start,i)); start=i+1;
    }
  }
  result.push(normalized.slice(start));
  return result;
}

export function insideBookLatex(text: string, cursor: number) {
  const parts = bookLatexParts(text);
  if (parts.some(part => part.kind === 'math' && cursor > part.start && cursor < part.end)) return true;
  // Enter while typing a new display formula must not split off its opening delimiter.
  const prefix=text.slice(0,cursor);
  let pending: string|null=null;
  for (const token of prefix.matchAll(/```[\s\S]*?(?:```|$)|`[^`]*(?:`|$)|\$\$|\\\[|\\\]/g)) {
    if (escaped(prefix,token.index) || parts.some(part=>part.kind==='math'&&token.index>=part.start&&token.index<part.end)) continue;
    if(token[0].startsWith('`'))continue;
    if(token[0]==='$$') pending=pending==='$$'?null:pending??'$$';
    else if(token[0]==='\\[') pending??='\\[';
    else if(pending==='\\[') pending=null;
  }
  return Boolean(pending);
}
