/* 把原型里的矢量art导出成 @3x PNG。
   艺术函数直接从 index.html 里切出来跑，不重抄一遍，避免和页面渲染的分叉。 */
const fs = require('fs');
const path = require('path');
const sharp = require('/Users/yuandai/Documents/New project/drinking-time-local/node_modules/sharp');

const ROOT = '/Users/yuandai/Documents/New project/drinking-time-local/docs/prototypes/liaohuier-miniapp';
const OUT  = path.join(ROOT, 'assets');
fs.mkdirSync(OUT, { recursive: true });

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const lines = html.split('\n');
// 按锚点切纯函数区（THEMES → characterSvg），行号会随原型变动，别写死
const _a = html.indexOf('const THEMES = {');
const _b = html.indexOf('/* ---------------------------------------------------------------------------\n   故事与会话');
const artSrc = html.slice(_a, _b);

const sandbox = {};
new Function('exports', artSrc + `
  Object.assign(exports, { THEMES, ELEMENT_ORDER, DRINK_ART, drinkSvg, characterSvg });
`)(sandbox);
const { THEMES, ELEMENT_ORDER, drinkSvg, characterSvg } = sandbox;

const SCALE = 3;                       // @3x，覆盖 iPhone 三倍屏
function fixSvg(svg, w, h) {
  return svg.replace(/^\s*<svg/, `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"`);
}

const jobs = [];
for (const el of ELEMENT_ORDER) {
  jobs.push(['cup-'    + el, fixSvg(drinkSvg(el, 'a', false),  54 * SCALE,  60 * SCALE)]);
  jobs.push(['avatar-' + el, fixSvg(drinkSvg(el, 'a', true),   26 * SCALE,  29 * SCALE)]);
  jobs.push(['char-'   + el, fixSvg(characterSvg(el),         208 * SCALE, 242 * SCALE)]);
}

(async () => {
  let total = 0;
  const rows = [];
  for (const [name, svg] of jobs) {
    const file = path.join(OUT, name + '.png');
    await sharp(Buffer.from(svg)).png({ compressionLevel: 9, palette: true }).toFile(file);
    const size = fs.statSync(file).size;
    total += size;
    rows.push([name, size]);
  }
  rows.sort((a, b) => b[1] - a[1]);
  for (const [n, s] of rows) console.log(String(s).padStart(7), n + '.png');
  console.log('---');
  console.log(jobs.length + ' 张，共 ' + (total / 1024).toFixed(1) + ' KB');
})();
