import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { BookFormattedText, BookMathText } from './BookMathText';
import { generatedBookText } from '@shared/bookTextFormat';

vi.stubGlobal('React', React);

describe('formatted book reading', () => {
  it.each(['**第 1 幕 · 小茶壶蹦出来**\n## 下一幕', String.raw`\textbf{第 1 幕 · 小茶壶蹦出来}
\subsection{下一幕}`])('shows emphasis and headings without visible source markers: %s', text => {
    const html = renderToStaticMarkup(<BookFormattedText text={text} />);
    expect(html).toContain('<strong><span>第 1 幕 · 小茶壶蹦出来</span></strong>');
    expect(html).toContain('role="heading" aria-level="2"');
    expect(html).not.toMatch(/\*\*|##|\\textbf|\\subsection/);
  });
  it('keeps nested math, literal code and escaped special characters readable', () => {
    const text = generatedBookText('**准确率 50% & $x^2$ 与 `**源码**`**');
    const html = renderToStaticMarkup(<BookFormattedText text={text} />);
    expect(html).toContain('准确率 50% &amp; ');
    expect(html).toContain('class="katex"');
    expect(html).toContain('`**源码**`');
    expect(html).not.toContain('\\%');
  });
  it('renders text as escaped React nodes without executing arbitrary HTML or TeX', () => {
    const text = String.raw`\textbf{<img src=x onerror=alert(1)>} \input{secret} $\frac{$`;
    const html = renderToStaticMarkup(<BookFormattedText text={text} />);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
    expect(html).toContain(String.raw`\input{secret}`);
    expect(html).toContain(String.raw`$\frac{$`);
  });
  it('retains the original editable source and supports selection-driven source visibility', () => {
    const text = '**旧标题**\n正文 $x^2$';
    for (const sourceVisible of [false, true]) {
      const html = renderToStaticMarkup(<BookMathText id="paragraph" text={text} style={{}} sourceVisible={sourceVisible}><textarea defaultValue={text} /></BookMathText>);
      expect(html).toContain(`<textarea>${text}</textarea>`);
      expect(html).toContain(`data-source="${sourceVisible}"`);
      expect(html).toContain('data-book-math-preview="paragraph"');
    }
  });
});
