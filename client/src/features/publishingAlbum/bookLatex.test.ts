import { describe, expect, it } from 'vitest';
import { bookLatexParts, insideBookLatex, splitBookTextModules } from './bookLatex';
import { renderBookFormula } from './BookMathText';
import { blockBody, insertBlockText, newWritingBlock, restoreStyledBlocks, restoreWritingBlocks, writingStyleOf } from './chapterBlockTree';
import { layoutBookBlocks } from './bookBlockLayout';

describe('book LaTeX',()=>{
  it.each(['$E=mc^2$',String.raw`\(\frac{1}{2}\)`,String.raw`$$\sum_{i=1}^n i$$`,String.raw`\[\sqrt{x}\]`])('recognizes delimiters without changing source: %s',math=>{
    const source='前文 '+math+' 后文';
    const parts=bookLatexParts(source);
    expect(parts.map(part=>part.raw).join('')).toBe(source);
    expect(parts.filter(part=>part.kind==='math')).toHaveLength(1);
    const formula=parts.find(part=>part.kind==='math')!;
    expect(source.slice(formula.start,formula.end)).toBe(math);
  });
  it.each([String.raw`价格 $5 和 $10，转义 \$ 不变`, '未完成 $x + 1', '`$x$` 与 ```latex\n$$x$$\n```',String.raw`未完成 \[x`])('keeps plain text, prices, code and unfinished delimiters literal: %s',source=>{
    expect(bookLatexParts(source).every(part=>part.kind==='text')).toBe(true);
    expect(bookLatexParts(source).map(part=>part.raw).join('')).toBe(source);
  });
  it('keeps complete multiline display equations together across paste and save/reopen',()=>{
    const math='$$\n'+String.raw`\begin{aligned}a &= b+c \\ d &= e\end{aligned}`+'\n$$';
    const text='前文\n'+math+'\n\n后文';
    expect(splitBookTextModules(text)).toEqual(['前文',math,'','后文']);
    const blocks=restoreWritingBlocks(text,null);
    expect(blocks).toHaveLength(4);
    expect(blockBody(restoreStyledBlocks(text,writingStyleOf(blocks)))).toBe(text);
    expect(restoreStyledBlocks(text,writingStyleOf(blocks)).map(b=>b.id)).toEqual(blocks.map(b=>b.id));
    expect(insertBlockText([newWritingBlock('')],0,text).blocks.map(b=>b.text)).toEqual(['前文',math,'','后文']);
  });
  it('retains empty lines, repeated paragraphs and existing module boundaries',()=>{
    const text='重复\n\n重复';expect(splitBookTextModules(text)).toEqual(['重复','','重复']);
    const old=[newWritingBlock('$$'),newWritingBlock('x'),newWritingBlock('$$')];
    expect(restoreStyledBlocks(blockBody(old),writingStyleOf(old))).toEqual(old);
  });
  it('keeps Enter inside complete or still-being-typed display formulas',()=>{
    expect(insideBookLatex('$$x$$',3)).toBe(true);
    expect(insideBookLatex('$$x$$',5)).toBe(false);
    expect(insideBookLatex('$$',2)).toBe(true);
    expect(insideBookLatex(String.raw`\[x`,3)).toBe(true);
    expect(insideBookLatex('普通正文',2)).toBe(false);
    expect(insideBookLatex('代码 `$$`',7)).toBe(false);
  });
  it('renders fractions/matrices as safe HTML and MathML, with invalid input falling back',()=>{
    const html=renderBookFormula(String.raw`\frac{1}{2}+\begin{pmatrix}a&b\\c&d\end{pmatrix}`,true)!;
    expect(html).toContain('<math');expect(html).toContain('katex-display');expect(html).toContain('mfrac');
    expect(renderBookFormula(String.raw`\frac{`,false)).toBeNull();
    expect(renderBookFormula('x'.repeat(12001),false)).toBeNull();
    for(const raw of [String.raw`\href{javascript:alert(1)}{x}`,String.raw`\htmlClass{injected}{x}`,String.raw`\includegraphics{https://example.com/x}`]){
      const result=renderBookFormula(raw,false)??'';
      expect(result).not.toMatch(/<a\b|<img\b|class="injected"/);
    }
  });
  it('reserves measured height so tall formulas cannot overlap the next paragraph',()=>{
    const blocks=[newWritingBlock('$$x$$'),newWritingBlock('下一段')];
    const measured=layoutBookBlocks(blocks,{},900,new Set(),{[blocks[0].id]:220});
    expect(measured[0].placement.rect.height).toBe(220);
    expect(measured[1].placement.rect.y).toBeGreaterThanOrEqual(measured[0].placement.rect.y+220);
  });
});
