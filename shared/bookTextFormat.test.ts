import { describe, expect, it } from 'vitest';
import { bookTextParts, generatedBookText } from './bookTextFormat';

describe('generated book text formatting', () => {
  it('converts leaked Markdown to LaTeX while retaining text, emphasis and headings', () => {
    expect(generatedBookText('**第 1 幕 · 小茶壶蹦出来**\n正文 **值得珍视**。\n## 下一幕')).toBe(String.raw`\textbf{第 1 幕 · 小茶壶蹦出来}
正文 \textbf{值得珍视}。
\subsection{下一幕}`);
  });
  it('preserves formulas, code, incomplete markup and deliberate star notation', () => {
    const text = String.raw`$x^{**}$ \(a_1\) $$\begin{matrix}a&b\\c&d\end{matrix}$$` + '\n`**源码**`\n```python\na ** b\n```\n未闭合 **标题\n2 ** 3';
    expect(generatedBookText(text)).toBe(text);
    expect(generatedBookText(String.raw`\**字面量\**`)).toBe(String.raw`\**字面量\**`);
  });
  it('keeps math and code inside emphasis unchanged and is idempotent', () => {
    const original = '**公式 $a**b$ 与 `x**y`**';
    const expected = String.raw`\textbf{公式 $a**b$ 与 ` + '`x**y`' + '}';
    expect(generatedBookText(original)).toBe(expected);
    expect(generatedBookText(expected)).toBe(expected);
  });
  it('recognizes safe LaTeX text commands and leaves arbitrary commands literal', () => {
    const parts = bookTextParts(String.raw`\section{标题} \textbf{重要 \emph{文字}} \input{secret}`);
    expect(parts[0]).toMatchObject({ kind: 'heading', level: 1 });
    expect(parts[2]).toMatchObject({ kind: 'strong', children: [{ kind: 'text', raw: '重要 ' }, { kind: 'emphasis' }] });
    expect(parts.at(-1)).toMatchObject({ kind: 'text', raw: String.raw` \input{secret}` });
  });
  it('normalizes mixed LaTeX and Markdown without changing already escaped text or literal code', () => {
    expect(generatedBookText(String.raw`\section{**准确率 50\%**}`)).toBe(String.raw`\section{\textbf{准确率 50\%}}`);
    const text = '**代码 `}` 与 `{`**';
    const normalized = generatedBookText(text);
    expect(bookTextParts(normalized)).toMatchObject([{ kind: 'strong', children: [
      { raw: '代码 ' }, { raw: '`}`', literal: true }, { raw: ' 与 ' }, { raw: '`{`', literal: true },
    ] }]);
    expect(generatedBookText(normalized)).toBe(normalized);
    const incomplete = String.raw`\textbf{未闭合 **原样**`;
    expect(generatedBookText(incomplete)).toBe(incomplete);
  });
});
