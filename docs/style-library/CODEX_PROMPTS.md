# 在 Codex 上修库 · 提示词套装

> 你（岱岱）出图、出眼光；Codex 动手改 `docs/style-library/` 里的文件。
> 这份是**复制即用**的提示词。`MANUAL.md` 是手艺规矩的真相源，这里的 prompt 会让 Codex 先去读它，所以两边永远一致。
>
> **怎么用**：在 repo 根目录（`drinking-time-local`）开一个 Codex 会话 →
> 新会话第一条先发 **§0 开场预热**（把规矩一次喂饱）→ 之后按任务粘 §1–§7 的模板，填掉【方括号】即可。
> 模板都是自洽的：哪怕不发 §0、单独粘一条也能用。

---

## 0. 开场预热（每个新会话先发这一条）

```
你来帮我维护一个「美术流派库」，文件都在 docs/style-library/ 下。动手前先读这三处，照它们办：
- docs/style-library/MANUAL.md      ← 手艺规矩、光谱五轴、落点先验、守则
- docs/style-library/_TEMPLATE.yaml ← 条目的字段与顺序，严格照抄
- docs/style-library/entries/ 里挑 2–3 条现成的看语气和粒度

不可破的规矩：
1. 严格照 _TEMPLATE.yaml 的字段和顺序，YAML 必须合法。
2. id = 英文小写连字符 slug，定了别改；文件名 = entries/<id>.yaml。
3. 一条目只放一个流派，绝不在条目里混搭。
4. 写「画得出来的词」（媒介/技法/光/流派名/"in the manner of X"），别堆形容词。
5. 每条必有一个一眼 signature——低分辨率草稿也认得出这个流派。
6. negative 写「它最怕变成什么」，和正面一样重要。
7. affinity（age/profession/wuxing，权重 0–3）宁可少标别硬标，不确定就留空或给 0。
8. 新增或大改一律 status: draft。只有我出图校准后才会自己改成 active，你别擅自转。
9. references 用 ./refs/<id>-1.jpg 占位，别假装图已经存在。
10. 守则：库只换「怎么好看」，不换「发生了什么」——不为戏剧放大、不翻负、不正向失真。
11. 只动 docs/style-library/ 下的文件；每次改完用一句话说明改了什么、为什么。
听懂回「好」，然后等我派活。
```

---

## 1. 新增一条（从流派名）

```
往流派库新增一条目。规矩照开场预热（没发过就先读 docs/style-library/MANUAL.md + _TEMPLATE.yaml + 几条现成 entries）。

要新增的流派 / 一句气质：
【例：莫奈式印象派外光，碎笔触、明亮的户外自然光、空气感】

要求：
- 新建 docs/style-library/entries/<id>.yaml，字段顺序照 _TEMPLATE，YAML 合法。
- style 必须点名（流派/艺术家/电影/"in the manner of X"）；写画得出来的词。
- 给一个一眼 signature；negative 写清最怕变成什么；一条目只一个流派。
- affinity 宁缺别硬标；references 写 ./refs/<id>-1.jpg；status: draft。
- 动手前扫一遍现有 entries，确认这条和已有的「拉得开」（媒介/色温/年代/繁简/情绪温度别撞车）。
完事一句话：新增了什么、它补的是光谱哪个角。
```

## 2. 从「好提示词」精修一条

```
我跑图攒了段好用的提示词，用它把某条目改精准。先读 MANUAL.md + _TEMPLATE.yaml。

目标条目：docs/style-library/entries/【id】.yaml
我的提示词 / 关键词（可能中英混、零散）：
【原样贴这里】

要求：
- 把里面「画得出来的词」拆进对应槽位（style/palette/light/composition/material/era_culture），别整段塞一个字段。
- 提炼或更新 signature；该补的 negative 也补上。
- 别改 id；emotion_fit/theme_fit/affinity 除非提示词明确指向某情绪/题材，否则别动。
- YAML 合法、字段顺序照 _TEMPLATE；status 保持 draft。
只改这一个文件。完事给我 before/after：哪几栏改了、为什么。
```

## 3. 从「好图」反推视觉 DNA

```
我看到/跑出一张很对的图，想把它的视觉 DNA 喂进库。先读 MANUAL.md + _TEMPLATE.yaml。

图（我贴图或描述）：【贴图，或描述：媒介、色、光、构图、质感、最像哪个流派/艺术家】

要求：
- 先把图拆成画得出来的词：媒介/技法、palette、light、composition、material、era_culture，并点名最像的流派/艺术家。
- 判断该「精修已有条目」还是「新开一条」：
  · 和现有某条同流派 → 精修那条（说明是哪条、改哪几栏）。
  · 库里还没有这流派 → 新开一条（照 §1 规矩，status: draft）。
- signature 抓准这张图一眼最抓人的点；references 先留 ./refs/<id>-1.jpg 占位（图我之后放）。
只动 docs/style-library/ 下文件。完事说明：精修了哪条 / 新增了哪条，补在光谱哪个角。
```

## 4. 出图校准过了，draft → active

```
这几条我出图校准过、认得出流派也好看，转正。
把 docs/style-library/entries/ 下这些条目的 status 从 draft 改成 active：
【列 id：例如 ghibli-watercolor、kodak-film、morandi-still】
只改 status 这一个字段，别动其它内容。完事确认改了哪几条。
```

## 5. 放了范例图，更新引用

```
我把范例图放进 docs/style-library/refs/ 了：
- 文件名：【vaporwave-neon-1.jpg、vaporwave-neon-2.jpg】
- 对应条目：【vaporwave-neon】
帮我确认 entries/【id】.yaml 的 references 指向这些图（路径 ./refs/文件名）；多张就列成数组。
只改这一个条目的 references 栏。
```

## 6. 整库「拉得开」体检（只看不改）

```
给整个流派库做一次「拉得开」体检。读 docs/style-library/MANUAL.md（§4 光谱五轴 + §5 落点）和 entries/ 下所有条目。

先别改任何文件，只给我：
1. 一张表：每条目在 媒介/色温/年代/繁简/情绪温度 五轴上的落点。
2. 撞车预警：哪几条挤在同一个角、几乎重复（举例像在哪）。
3. 空洞预警：哪些角还没人占（对照 MANUAL 底部「下一批坑」）。
4. 落点体检：哪些 affinity 像是硬标的（违反「宁可少标别硬标」），建议留空的列出来。
给结论，我决定怎么改，要动手时我再单独派。
```

## 7. 补 MANUAL 底部指定的一个坑

```
照 MANUAL 底部「下一批坑」，给我补这一个：
【黑白纪实摄影（森山大道 / 布列松）—— 补「黑白 + 硬纪实」这个空角】

规矩同新增（先读 MANUAL + _TEMPLATE + 几条现成 entries；点名；signature；negative；一条目一学派；affinity 宁缺；status: draft；references 占位）。
特别确认它和库里已有摄影类条目（kodak-film / wong-kar-wai / nordic-minimal 等）真的拉得开，别又变成一条暖色胶片。
只动 docs/style-library/ 下文件。完事一句话：补在哪个角、和最接近的现有条目差在哪。
```

---

## 附：想更省事？

把开场预热那套规矩落成 `docs/style-library/AGENTS.md`，Codex 在这个目录干活会**自动读到**，你就不用每次发 §0 了，直接派 §1–§7 即可。要的话跟我说一声，我来写。
