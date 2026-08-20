# 让故事版出图出片达到「脚本路径」的水准

> 起因：2026-08-19 为 SheSelf V03 的 0307 镜头做尾帧和视频。
> 同一个 302 账号、同一个模型、同一张参考图，**脚本直调 `generateImage` 一次就出对，
> 走产品「渲染 4 张」连试九轮没有一张能用**。本文件是把那九轮里查出来的差异，
> 逐条落回产品的施工计划。
>
> 已经修掉并带测试的部分见文末「已完成」，不要重复做。

---

## 背景：为什么脚本行、产品不行

把两条路径的最终提示词打出来对比，差异是压倒性的：

| | 脚本路径 | 产品路径（`renderGate.engineerImagePrompt`） |
|---|---|---|
| 长度 | ~600 字 | **2615 字** |
| 结构块 | 无 | **11 个**（内容主权 / 用户持续要求 / 人物参考边界 / 故事板视觉事实 / 文本美术信号 / 私人策展库审美底线 / 艺术谱系 / 手作完成度 / 艺术跃迁 / 风格化硬约束 / 静态图片无字硬约束） |
| 用户写的镜头美术要求占比 | ~100% | **14.1%** |
| 语言 | 英文、聚焦、纯肯定 | 中文、发散、大量禁令 |

九轮失败的实际表现：脸和发型每轮都换人、四人群像塌成单人特写、配色跑成橄榄绿、
画面长出胶片齿孔和印刷数字。**每一种都能对应到上面某个块。**

复现命令（只读，不花钱）：

```bash
pnpm tsx -e 'import { engineerImagePrompt } from "./server/services/renderGate"; console.log(await engineerImagePrompt({ prompt: "任意镜头美术要求", storyId: 1186, shotNo: "SH22", outputPurpose: "story-frame", storyboardReferenceTruth: true }))'
```

---

## P0 — 直接决定出图能不能用

### 1. 镜头图提示词改成「纯肯定 + 短」

**问题.** 扩散模型没有「不」。正向提示词里每出现一个被禁止的名词，都是在点名要画它。
封面链路早就写下过这条教训（`server/routers/publishingDraft.ts:1990` 的注释：
*"no newspapers" is how a man ends up buried in newspapers*），
但故事版这条路反着来 —— `renderGate.ts` 的两条硬约束里点了二十来个带字的东西：

```
【静态图片无字硬约束】…禁止可读文字、伪文字、字母、数字、Logo、品牌标记、签名、
水印、标题、字幕、标签、书脊字和界面字符。不要描绘钟表、日历、书页、报纸、招牌、
包装、屏幕…
【风格化硬约束】…不要摄影写实、产品布光、镜头虚化和塑料质感。
```

写「不要水印」之后那一轮，出图长出了胶片齿孔和顶部印刷数字；写「不要绿色」之后
出图变绿；写「绝对不要推成脸部特写」之后连着两轮都是大头照。

**做什么.**
- 参照 `server/services/publishingCoverStoryboardPrompt.ts` 的
  `compilePublishingCoverStoryboardPrompt`，给 story-frame 用途加一道**编译为
  一段英文纯肯定描述**的收口（封面已经这么跑了几周）。
- 两条硬约束改写成肯定句（封面用的是 `plain unmarked surfaces throughout`）。
- 压制交给 provider 层的 `--no`：`imageGen.ts` 的 `withMidjourneyNegativeTerms` +
  `MIDJOURNEY_DEFAULT_NEGATIVE_TERMS` 已经无条件合并，**正向提示词里的禁令是纯冗余**。

**注意.** 用户 2026-08-19 明确说过「约束你别改了」，所以这一条**动手前要先跟他确认**。
证据齐了再谈，不要默默改。

**验收.** 同一镜头、同一美术要求，编译结果里不出现任何「不要 / 禁止 / avoid / no X」，
且 MJ 提交串里 `--no` 参数完整。

### 2. `authoredBrief` 已落地，但要扩到其它入口

用户逐字写了图片要求且有故事板参考帧时，跳过生成性美术块。
已在 `renderGate.ts` + `server/routers/storyAgent.ts` 实装（11 块 → 6 块，
2615 字 → 1538 字，用户话语权 14.1% → 约 48%）。

**还要做.** 精确改图（`outputPurpose: "image-edit"`）和封面走的是另外的入口，
判断是否同样需要；以及在故事版 UI 上让用户看得见「这一镜用的是我自己的美术」。

### 3. 人物设定要有一个稳定的落点（角色圣经）

**问题.** 现在锁人物长相只有两条路，两条都不可靠：

- `describeReferenceIdentity()`（`imageGen.ts`）每次现场调视觉模型提取五官 ——
  2026-08-19 连着六七轮全部 `timeout`，等于**在没有身份锁的情况下出图**。
- MJ 的 `--oref` 只认公网 http(s)（MJ 服务端要自己去拉图），而故事版的帧一律是
  本机 `/api/images/...`，**从来没有生效过**（见 P1-7）。

`story.body.characters` 只有文字设定、没有外观；`references` 表是空的；
`art-repository/` 那 99 张标着 `usage: derived-dna-only` + `rawImagesAtRuntime: false`，
是画风库不是人物参考。**产品里没有任何地方存着「她长什么样」。**

**做什么.** 每个故事一份可编辑的角色外观设定，随每次出图注入：

```
脸：瓷白冷调肤色、双颊淡红晕；心形脸，下巴微尖圆润；大眼、眼距略宽；
    鼻梁细直鼻头小；唇偏小、上薄下略厚、明亮红橙唇色
发型：纯黑齐下巴波波头，偏分斜刘海斜扫过额头，发尾微内扣
服饰：骨白无袖细肩带及地长裙，厚重面料长竖褶拖地，圆润低领口，无花纹配饰
```

（这份是 2026-08-19 从 0305 / 0306 / 0307 三张已确认画面里读出来并被用户确认的，
可以直接作为 SheSelf 的初始值。注意**斜刘海**和**及地长裙** —— 早先误写成
「齐眉刘海 + 亚麻短吊带」，导致连续几轮人物不对。）

要点：
- 视觉提取失败时**回落到这份文字设定**，而不是静默地什么都不锁。
- 设定文字必须让用户能改 —— 是他定的，不是模型猜的。

**验收.** 断开视觉接口（模拟 timeout），出图仍然锁得住脸、发型、服饰。

### 4. 「四宫格选首帧」要看图的真实来源

`client/src/features/storyAgent/views/ShotMaterialBasket.tsx` 的 `cropFrameQuadrant`
默认任何一张图都是 MJ 的 2×2 宫格，切四块给用户选。Kontext 出的是单张完整画面，
切出来就是四个无意义的局部 —— 用户看到的「四个候选」其实是同一张图的四个裁切面。

**做什么.** 只有确实来自 MJ 四宫格任务的图才提供象限裁切；单图来源直接展示整张。
落库时记下 provider / 是否宫格（现在 `generatedImages` 完全没有这个字段）。

---

## P1 — 决定链路稳不稳

### 5. Kontext 的行为边界要写进代码注释和 UI 提示

九轮试出来的硬事实，别让下一个人再花一天：

- **它继承参考图的机位。** 六次极端机位指令（顶视、贴地仰角、正侧 90°、
  强俯视看头顶、强仰视看下颌底面）**全部还回平视**，因为参考图是平视。
  要换机位必须换一张已经是那个机位的参考图。
- **变形强度和构图保真此消彼长。** 钉住构图它就拒绝变形；放开变形它就丢角色、改取景。
- **它加不回被删掉的人物。** 拿「已经变成树但女人没了」的图去让它「把三个女人加回来」，
  结果是把树也一起丢了，退化成普通肖像。
- **过程描述无效，解剖学描述有效。** 写「树皮正在爬上她的手臂」→ 它在旁边加一根枝条；
  写「她右臂原来的位置现在是一根同样长度同样角度的裸枝，肩关节是木头上的节疤」→ 成了。
- **「只改一小块」不能用整帧重绘。** 让它抹掉画面里一条小径，它给了一张林中巨脸。

### 6. 局部重绘要有入口

承上：擦掉一条路、改一只手这类需求，正确工具是**遮罩重绘** ——
`editImage(..., { editMaskImageUrl })` 会走 302 gpt-image 遮罩端点，
且代码明确保证不回退成整帧重绘（`imageGen.ts` 的 `editMaskImageUrl` 分支）。
后端是现成的，**缺的是从故事版画面栏框选一块的 UI**。

2026-08-19 手工验证过：在图上画一个多边形遮罩去抹一条小径，其余像素一个不动，
一次就成 —— 而同一件事用整帧重绘试了四轮全失败。

**做什么.** 画面栏上给一个「改这一块」：框选 → 生成 alpha=0 遮罩 → 走遮罩重绘。

### 7. 参考图需要一个公网 URL

MJ 的人物锁 `--oref` 只认公网 http(s)。当前唯一能把本机帧变成公网 URL 的是
`server/storage.ts` 的 `storagePut`（Forge/302 存储），而 2026-08-19 全天返回
**503「当前无可用模型」**，于是人物一致性整条断掉。

探测脚本已留在 `scripts/check-302-storage.ts`（只读，几十字节，不产图不扣费）：

```bash
pnpm tsx scripts/check-302-storage.ts
```

**做什么.** 存储要有备用去处（用户有阿里云 OSS bucket `mountion`），
并且**拿不到公网 URL 时要让调用方知道**，而不是静默降级成没有身份锁。
现在的降级路径是 `imageGen.ts` 里新加的「MJ 无 `--oref` → 改走 Kontext」，
那是止血，不是根治。

### 8. 视频提示词不许加戏

2026-08-19 第一条 0307 视频里凭空出现了一群涌进画面的女性、人物走位和一个森林结尾，
全都不在镜头表里 —— 是提示词自己编的。用户的原话：「不希望你加上其他莫名其妙的元素」。

**做什么.** 视频提示词编译要以镜头表为闭集：人数、在场人物、场景、动作范围都由
`shots[]` 决定；模型只能描述这些元素怎么动。同时：

- 显式声明人数和「没有人进入画面」，实测有效。
- Vidu 有内容审核（`AuditSubmitIllegal`）：「俯身靠近」「脸挨着她」这类描述会被判亲密内容
  而整单驳回。编译出来的中文要走中性措辞。
- 视频要保住厚涂油画的刮刀肌理，提示词里要正面要求材质，否则会被平滑掉。

---

## P2 — 体验和自动化

### 9. 聊天框直接出视频

用户要的最终形态：「在截图的区域，或者直接在聊天框输入一段文字就可以直接得到视频」。
第一部分（画面栏按钮）已经可用，**聊天框这条链路完全没有**，需要单独设计
意图识别 → 定位镜头 → 组装首尾帧 → 提交渲染。

### 10. 时长上限 8 秒

`shared/startEndVideo.ts` 的 `parseStartEndVideoConfig` 把 `durationSec` 夹在 1–8，
因为 viduq2-turbo 单次上限 8 秒。用户问过 16 秒 —— 要支持得拼两段或换模型，
现在 UI 上没有任何地方告诉他这个上限。

---

## 已完成（带测试，不要重做）

| 改动 | 文件 | 测试 |
|---|---|---|
| 身份锁不再无条件塞蒙眼措辞，按遮眼/露眼/未知三态分支 | `server/services/imageGen.ts` | `imageGen.test.ts` ×3 |
| 身份锁声明「只管身份不管取景」，避免群像被收成特写 | 同上 | `imageGen.test.ts` ×1 |
| MJ 拿不到公网 `--oref` 时改走单参考图 Kontext | 同上 | `imageGen.test.ts` ×2 |
| 一个 MJ 任务的四宫格候选全部入库并回传 | `server/routers/storyAgent.ts`、`client/.../rerender.ts` | `routers.storyAgent.test.ts`、`rerender.test.ts` |
| `authoredBrief`：用户写了美术要求时跳过生成性美术块 | `server/services/renderGate.ts`、`server/routers/storyAgent.ts` | — |
| 硬切不再把 1440 成片压回 720 | `server/services/videoTransition302.ts`、`editingTransitionWorkflow.ts` | `videoTransition302.hardcut.test.ts` ×3 |
| 故事版每镜可选视频时长（1–8s）与运动幅度 | `StoryboardReviewBoard.tsx`、`storyboardReviewModel.ts` | `storyboardStartEndTuning.test.ts` ×7 |
| 转场脚本支持 `--movement` | `scripts/generate-302-turn-transition.ts` | — |

**先决条件.** 上面这些都在**主 checkout 的未提交工作区**。2026-08-19 期间另有会话
在同一 checkout 上改剪辑行相关文件（`storyboardEditRow.*`、`views/StoryboardEditRow.tsx`），
动手前先跑 `pnpm env:status` 并确认没有别的会话在写。

**账本.** 相关功能卡：`unified-static-image-prompt`（working）、
`start-end-shot-video`（working，本次新建）。改完记得 `pnpm feature:validate`。
