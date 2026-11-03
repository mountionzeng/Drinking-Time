import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import katex from 'katex';
import { bookTextParts, displayLatexText, type BookTextPart } from '@shared/bookTextFormat';
import 'katex/dist/katex.min.css';
import './bookMathText.css';

export function renderBookFormula(formula: string, display: boolean) {
  if (formula.length > 12_000) return null;
  try {
    return katex.renderToString(formula, { displayMode:display, throwOnError:true, trust:false, strict:'ignore', maxExpand:500, maxSize:20, output:'htmlAndMathml' });
  } catch { return null; }
}

function renderText(parts: BookTextPart[], latexText = false): { content: ReactNode[]; formatted: boolean } {
  let formatted = false;
  const content = parts.map((part, index) => {
    if (part.kind === 'text') return <span key={index}>{latexText && !part.literal ? displayLatexText(part.raw) : part.raw}</span>;
    if (part.kind === 'math') {
      const html = renderBookFormula(part.formula, part.display);
      if (html) formatted = true;
      return html ? <span key={index} dangerouslySetInnerHTML={{ __html: html }} /> : <span key={index}>{part.raw}</span>;
    }
    formatted = true;
    const nested = renderText(part.children, latexText || !part.markdown).content;
    if (part.kind === 'strong') return <strong key={index}>{nested}</strong>;
    if (part.kind === 'emphasis') return <em key={index}>{nested}</em>;
    return <span key={index} role="heading" aria-level={part.level} className={`book-text-heading book-text-heading-${part.level}`}>{nested}</span>;
  });
  return { content, formatted };
}

/** Shared with chat rewrite previews; React escapes text, only KaTeX creates safe HTML. */
export function BookFormattedText({ text }: { text: string }) {
  const rendered = useMemo(() => renderText(bookTextParts(text)), [text]);
  return <span className="book-formatted-text">{rendered.content}</span>;
}

/** The original textarea stays mounted: preview never becomes stored document HTML. */
export function BookMathText({ text, id, sourceVisible, style, children }: { text: string; id: string; sourceVisible: boolean; style: CSSProperties; children: ReactNode }) {
  const [focused,setFocused]=useState(false);
  const rendered=useMemo(()=>renderText(bookTextParts(text)),[text]);
  if (!rendered.formatted) return children;
  const editing=focused||sourceVisible;
  return <div className="book-math-block relative h-full w-full" data-source={editing} style={style}
    onFocusCapture={()=>setFocused(true)} onBlurCapture={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))setFocused(false);}}>
    <div data-book-math-preview={id} aria-hidden={editing} className="book-math-preview book-formatted-text pointer-events-none absolute inset-x-0 top-0 whitespace-pre-wrap break-words px-1">
      {rendered.content}
    </div>
    <div className="book-math-source h-full w-full">{children}</div>
  </div>;
}
