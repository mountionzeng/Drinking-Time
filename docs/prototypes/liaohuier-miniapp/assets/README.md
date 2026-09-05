# assets — 从原型导出的位图

为了让小程序上的界面和原型**逐像素一致**，把矢量 art 全部导成了 PNG。
所有图都由 `_export/*.cjs` 从 `../index.html` 里**直接切出艺术函数运行**再光栅化，
不是另抄一遍路径，所以不会和页面渲染分叉。改了原型重跑脚本即可。
（切源码按锚点定位，不写死行号——原型一改行号就漂。）

底部页签**没有顶边横线、杯子也没有圆底和外框**，整条并进纸色，
所以这里不需要任何「按钮外框」类的图。

```
cd <仓库根>
node docs/prototypes/liaohuier-miniapp/assets/_export/export.cjs
node docs/prototypes/liaohuier-miniapp/assets/_export/icons.cjs
node docs/prototypes/liaohuier-miniapp/assets/_export/anim.cjs
```

（必须是 `.cjs`：仓库 `package.json` 是 `"type": "module"`，`.js` 会被当 ESM。）

**49 张，284 KB**（小程序主包上限 2MB）。静态图 @3x，动画帧 @2x。

## 对照表

| 文件 | 显示尺寸 | 用在哪 |
| --- | --- | --- |
| `cup-<五行>.png` | 54×60 | 底部「来聊会儿」的饮品（收起态同图缩到 27×30）|
| `avatar-<五行>.png` | 26×29 | 聊天里助手气泡的抬头 |
| `char-body-<五行>.png` | 208×242 | 杯子变小人 · 杯子层 |
| `char-face-<五行>.png` | 208×242 | 杯子变小人 · 五官层（WXSS 淡入）|
| `char-limbs-<五行>.png` | 208×242 × 15 格 | 杯子变小人 · 手脚逐帧雪碧图 |
| `tab-story-off / -<五行>.png` | 22×22 | 「故事」页签，未选中 + 五套选中色 |
| `tab-me-off / -<五行>.png` | 22×22 | 「我」页签，同上 |
| `ic-attach.png` `ic-mic.png` | 16×16 | 撰写区回形针 / 麦克风 |
| `ic-send-<五行>.png` | 16×16 | 发送键（白色图标，压在实心圆上）|

`char-<五行>.png` 是整只小人的合成图，只用于比对，上机用分层那三张。

## 杯子变小人的 WXSS

只有「手脚一笔笔画出来」必须逐帧；缩放、五官淡入、站定后晃一下都交给 WXSS。
时间轴与 `index.html` 里的 CSS 完全一致。

```css
.char { position: relative; width: 208px; height: 242px;
        animation: rise .5s cubic-bezier(.2,.9,.3,1.2) both; }

/* ⚠️ 用后代选择器，别写 .char > i：三层通常还套在做「晃动」的那层里面，
   子选择器匹配不到，宽高会塌成 0（这个坑我踩过一次）。 */
.char i { position: absolute; left: 0; top: 0; width: 208px; height: 242px;
          background-repeat: no-repeat; display: block; }

.l-body  { background-size: 208px 242px; }
.l-face  { background-size: 208px 242px; opacity: 0;
           animation: faceIn .3s ease-out .34s both; }
.l-limbs { background-size: 208px auto; background-position: 0 0;
           animation: limbs .58s steps(14) .42s both; }

@keyframes rise   { from { opacity:0; transform: translateY(16px) scale(.72) } to { opacity:1; transform:none } }
@keyframes faceIn { from { opacity:0; transform: translateY(-2px) }          to { opacity:1 } }
@keyframes limbs  { to   { background-position: 0 -3388px } }   /* 242 × 14 */

/* 站定后打个招呼，套在最外层 */
.wave { animation: wave 1s ease-in-out .8s both; transform-origin: 104px 222px; }
@keyframes wave { 0%,100%{transform:rotate(0)} 30%{transform:rotate(-3.5deg)} 65%{transform:rotate(2.5deg)} }
```

雪碧图共 **15 格**：14 格动画 + 1 格重复尾帧。
尾帧是必需的——`steps(14)` 会停在 `to` 那一格上，没有它动画结束瞬间会闪成空白。

## 验证页（本地开发用，不进小程序包）

- `_contact.html` — 54 张按真实显示尺寸排开
- `_anim.html` — 三层 PNG 按上面的 WXSS 拼回去跑一遍
- `_frames.html` — 雪碧图逐格拆开看（0 空 → 1 起手 → 5 起腿 → 13 站定 → 14 尾帧）

## 这一步解决了什么、没解决什么

导图**只解决了「WXML 不支持内联 SVG」这一条**。下面这些和图无关，还得改代码：

DOM / `innerHTML` 要换 `setData`；凸起的中间页签要 `custom-tab-bar`；
`Intl.DateTimeFormat` 在安卓上不可靠（纳音算今天靠它，得手算 UTC+8）；
`<textarea>` 是原生组件会盖住浮层；没有 safe-area 处理；
`position: sticky` 配软键盘不稳；滚动容器要换 `<scroll-view>`；
`backdrop-filter` 安卓无效；`prefers-reduced-motion` 媒体查询 WXSS 不支持。

字体另算：`../honglei-zhuoshu-ui.ttf`（40 字 21KB）要 base64 内联进 WXSS，
或 `wx.loadFontFace` 走 https —— WXSS 的 `@font-face` 不认包内相对路径。
