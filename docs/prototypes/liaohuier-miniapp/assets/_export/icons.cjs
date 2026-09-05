const fs = require('fs'), path = require('path');
const sharp = require('/Users/yuandai/Documents/New project/drinking-time-local/node_modules/sharp');
const ROOT = '/Users/yuandai/Documents/New project/drinking-time-local/docs/prototypes/liaohuier-miniapp';
const OUT = path.join(ROOT, 'assets');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/** 从 html 里按锚点切出一段 <svg>…</svg> */
function grabSvg(anchor, before) {
  const i = html.indexOf(anchor);
  if (i < 0) throw new Error('anchor not found: ' + anchor);
  const s = before ? html.lastIndexOf('<svg', i) : html.indexOf('<svg', i);
  const e = html.indexOf('</svg>', s) + 6;
  return html.slice(s, e);
}

const ICONS = {
  'tab-story': grabSvg('<span>故事</span>', true),
  'tab-me'   : grabSvg('<span>我</span>',   true),
  'ic-attach': grabSvg('data-act="attach"', false),
  'ic-mic'   : grabSvg('data-act="voice"',  false),
  'ic-send'  : grabSvg('id="sendBtn"',      false)
};

// 主题色：--gold-deep（页签选中）与 --paper（发送键上的白）
const GOLD_DEEP = { metal:'#8a6b2a', wood:'#3d6b48', water:'#40707c', fire:'#6b2a22', earth:'#4a3228' };
const PAPER     = { metal:'#fbf8ee', wood:'#f6f9f2', water:'#f4f8fa', fire:'#fdf6f3', earth:'#faf6f0' };
const TAB_OFF   = '#9a8f7c';   // 未选中
const MUTED     = '#7a7264';   // 回形针 / 麦克风

function paint(svg, color, w, h) {
  return svg
    .replace(/currentColor/g, color)
    .replace(/^\s*<svg/, `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"`);
}

const S = 3, jobs = [];
for (const key of ['tab-story', 'tab-me']) {
  jobs.push([`${key}-off`, paint(ICONS[key], TAB_OFF, 22*S, 22*S)]);
  for (const el of Object.keys(GOLD_DEEP))
    jobs.push([`${key}-${el}`, paint(ICONS[key], GOLD_DEEP[el], 22*S, 22*S)]);
}
jobs.push(['ic-attach', paint(ICONS['ic-attach'], MUTED, 16*S, 16*S)]);
jobs.push(['ic-mic',    paint(ICONS['ic-mic'],    MUTED, 16*S, 16*S)]);
for (const el of Object.keys(PAPER))
  jobs.push([`ic-send-${el}`, paint(ICONS['ic-send'], PAPER[el], 16*S, 16*S)]);

(async () => {
  let total = 0;
  for (const [name, svg] of jobs) {
    const f = path.join(OUT, name + '.png');
    await sharp(Buffer.from(svg)).png({ compressionLevel: 9, palette: true }).toFile(f);
    total += fs.statSync(f).size;
  }
  console.log(jobs.length + ' 张图标，' + (total/1024).toFixed(1) + ' KB');
  const all = fs.readdirSync(OUT).filter(f => f.endsWith('.png'));
  const sum = all.reduce((a,f) => a + fs.statSync(path.join(OUT,f)).size, 0);
  console.log('assets/ 合计 ' + all.length + ' 张，' + (sum/1024).toFixed(1) + ' KB');
})();
