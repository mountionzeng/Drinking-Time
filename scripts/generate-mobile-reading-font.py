from fontTools import subset
from fontTools.ttLib import TTFont
from pathlib import Path
import json
root=Path('client/src/assets/fonts/publishing-album/noto-serif-sc')
src=root/'NotoSerifSC[wght].ttf'
out=Path('client/src/assets/fonts/mobile-reading');out.mkdir(exist_ok=True)
font=TTFont(src);cmap=set(font.getBestCmap());text=''.join(json.loads(Path('client/src/features/uiLanguage/messages.json').read_text()).keys())
ui=({ord(c) for c in text}|set(range(0x250))|set(range(0x2000,0x2070)))&cmap
remaining=cmap-ui
groups=[('ui',ui)]+[(f'range-{start:x}',{c for c in remaining if start<=c<start+2048}) for start in range(0,max(cmap)+1,2048)]
css=[]
for name,chars in groups:
 if not chars:continue
 f=TTFont(src);opts=subset.Options();opts.flavor='woff';sub=subset.Subsetter(options=opts);sub.populate(unicodes=chars);sub.subset(f);f.flavor='woff';f.save(out/(name+'.woff'))
 ranges=[];nums=sorted(chars);start=last=nums[0]
 for cp in nums[1:]:
  if cp==last+1:last=cp
  else:ranges.append(f'U+{start:X}'+(f'-{last:X}' if last!=start else ''));start=last=cp
 ranges.append(f'U+{start:X}'+(f'-{last:X}' if last!=start else ''))
 css.append('@font-face {\n  font-family: "Mobile Reading";\n  src: url("../assets/fonts/mobile-reading/'+name+'.woff") format("woff");\n  font-weight: 200 900;\n  font-style: normal;\n  font-display: swap;\n  unicode-range: '+', '.join(ranges)+';\n}')
Path('client/src/styles/mobile-reading-font.css').write_text('\n\n'.join(css)+'\n\n'+'''/* Scoped to the mobile workspace, including its portalled sheets. */
html[data-mobile-ui] body,
html[data-mobile-ui] .font-sans,
html[data-mobile-ui] .font-serif,
html[data-mobile-ui] .font-mono,
html[data-mobile-ui] .font-chat-brand:not(.mobile-brand-logo) {
  font-family: "Mobile Reading", "Noto Serif SC", "Songti SC", serif;
  font-feature-settings: normal;
  letter-spacing: normal;
}
html[data-mobile-ui] button,
html[data-mobile-ui] input,
html[data-mobile-ui] textarea,
html[data-mobile-ui] select {
  font-family: inherit;
}
''')
(out/'OFL.txt').write_bytes((root/'OFL.txt').read_bytes())
(out/'README.md').write_text('Derived from ../publishing-album/noto-serif-sc/NotoSerifSC[wght].ttf (OFL). Variable weights 200–900, Chinese and Latin including French accents. UI characters load together; other code points load on demand in disjoint Unicode ranges. Generated with fontTools subset; no external font service.\n')
print('Generated',len(css),'font subsets,',sum(p.stat().st_size for p in out.glob('*.woff')),'bytes total; UI', (out/'ui.woff').stat().st_size)
