---
date: 2026-08-21
topic: story-visual-assets
status: 根因已定位并修复（改走 gpt-image 结构化编辑），背面视角已真实付费验收通过；剩正面与侧面各需重生成一次（约 ¥2.98）
branch: codex/story-visual-assets
story_id: 1186
---

# 交接：Story 锁定式视觉资产与人物三视图

## 一句话结论

第一次真实付费生成的 P0（模型只产出一张三分之四侧身肖像，服务端却机械切三栏并全标 `pass`）已经修完：生成底图改成程序生成的三栏布局模板、切片前加了 fail-closed 的结构质检、Story 1186 那四张错误通过的视图已通过正式 mutation 改判为 `fail`，锁定入口已在页面上关闭。**两次付费证明「让模型一次画出整张多格标准板」这条路走不通**（第一次死守单人构图，第二次把灰色模板当画风）。生成策略已改成分视角生成、服务端合板：模型每次只画一个视角，构图交给代码。代码和测试已就绪，**等一次真实付费验收**。

## 用户的硬要求

- 人物资产必须锁死脸、发型、服饰和固定配件。
- 场景资产必须锁死空间、材质和固定道具。
- 美术风格资产必须锁死媒介、笔触、造型语言和色彩语言。
- 镜头景别、机位、动作、表情和光线可以变化，但上述三类固定元素必须与资产标准视图一致。
- 人物资产需要一张正面全身、严格 90° 侧面全身、背面全身的三视图标准板。
- 镜头只关联一次人物/场景/风格，图片生成和视频生成共同使用同一不可变版本。
- 任何付费提交都必须先显示费用并由用户确认；不要自动重复购买。

## 当前环境

- 真仓库：`/Users/yuandai/Documents/New project/drinking-time-local`
- 当前分支：`codex/story-visual-assets`
- 固定验证入口：`http://localhost:3000/editing`
- 2026-08-21 19:25 左右确认 `localhost:3000` 返回 HTTP 200。
- 项目铁律：只有主仓库允许运行 `pnpm dev`，固定端口 3000；worktree 禁止启动服务或写 `.webdev/` 数据。
- 工作树非常脏，夹杂其他会话/用户改动。**禁止 reset、checkout 或删除不属于本功能的改动。**
- 每次环境诊断第一步运行 `pnpm env:status`；若沙箱阻止 `tsx` IPC，可在获批环境运行，或先用 `curl -sI http://localhost:3000/` 做只读存活检查。

## 真实 Story 与资产数据

- Story：`SheSelf V03`
- Story ID：`1186`
- 人物资产：`va_kXGdymUxHEsK`
- 人物版本：`vav_j2q_zmCuGVCp`
- 参考图：`#1616 / #1658 / #1645`
- 固定人物造型已保存：
  - face：年轻女性、椭圆脸、高颧骨、小而挺的鼻子、薄唇、浅色眼眸、冷白肤色
  - hair：黑色齐耳短发、齐刘海、发尾内扣的波波头
  - outfit：白色/米白无袖或细肩带露背长裙、裙摆至脚踝
- 冲突裁决已保存为上述固定造型。

## 已实现的产品流程

1. 在素材仓库创建人物、场景或风格资产草案。
2. 选择当前 Story 的参考图并用视觉模型提取固定事实。
3. 参考图存在真实设计差异时逐字段裁决。
4. 人物卡显示连续的下一步：
   - `下一步：确认人物固定造型`
   - 自动选择已整理固定造型作为推荐值
   - `确认推荐造型，继续生成三视图`
   - 保存后原位置出现 `生成人物三视图`
5. 生成前报价并二次确认。
6. 标准视图通过后才能锁定不可变版本。
7. 选中镜头后手动关联人物、场景、风格；一次绑定供图片和视频生成共用。
8. 已绑定资产进入生成快照与一致性门禁。

## 本轮修过的入口问题

此前人物参考图存在冲突时，底部的三视图按钮被“重新分析参考图”替换，用户无法判断下一步。已修为连续流程，并允许服务端接受分析后的字符串固定事实作为显式冲突裁决。

相关代码：

- `client/src/features/creationEditor/visualAssets/VisualAssetLibrary.tsx`
- `client/src/features/creationEditor/visualAssets/VisualAssetLibrary.test.tsx`
- `server/services/visualAssetPersistence.ts`
- `server/services/visualAssetPersistence.test.ts`

## 第一次真实付费生成

- 报价：预计最高 `¥1.49`
- 生成模型链路：`gpt-image-1.5`，302 GPT Image edit
- operation token：`visual-board-bb72ce1a-ffa3-48be-aea0-40bbd31e9ce8`
- operation status：`succeeded`
- 约 55 秒完成，供应商任务没有停滞，也不需要刷新或重提。
- 标准板 imageId：`1691`
- 切片 imageId：
  - front：`1692`
  - profile：`1693`
  - back：`1694`
  - identity-detail：`1695`

本地图片：

- 标准板：`.webdev/images/1787310812037-xp81t8.png`
- front 切片：`.webdev/images/1787310813017-3ufc7a.png`
- profile 切片：`.webdev/images/1787310813087-p4e0h0.png`
- back 切片：`.webdev/images/1787310813160-xbo0fv.png`
- identity-detail：`.webdev/images/1787310813204-le8o8k.png`

## P0 失败：结果不是三视图，却被判定通过

实际标准板只有一个三分之四侧身、回头看镜头的半身/大半身人物，没有三个全身视角。机械切片后的结果：

- front：几乎全是空背景。
- profile：人物局部肖像。
- back：几乎全是空背景。
- 四个 `VisualAssetView.status` 却全部写成 `pass`。

当前版本仍是 `review`，但因为四张视图被错误标成 `pass`，UI 可能允许“锁定此版本”。**不要锁定。**

## 已确认的根因链

### 根因 1：生成底图职责错误

`server/services/visualAssetCreation.ts` 的 `generationOptions()` 把第一张人物参考照片作为 `referenceImageUrl`，并要求 `gpt-image` 做图像编辑。模型强烈保留了第一张参考图的单人构图，虽然 prompt 要求三栏，仍只重绘出一张单人肖像。

需要把“布局模板”和“身份参考”拆开：

- 图 1 应是程序生成的正方形三栏布局模板（每栏完整人形占位），只控制构图。
- 图 2–4 才是人物身份、发型、服装参考，只控制固定造型。
- prompt 必须明确每张输入图的职责。
- 不要再次使用某一张单人参考图作为必须保留构图的主底图。

### 根因 2：`splitCanonicalBoard()` 不做内容质检

`server/services/visualAssetCreation.ts` 的 `splitCanonicalBoard()` 只验证：

- 图片可读取；
- 尺寸至少 768；
- 宽高比接近正方形；
- 然后按三等分/四宫格裁切。

它没有验证每一栏是否真的有人物、是否全身、是否分别是正面/严格侧面/背面。后续保存视图时直接写 `status: "pass"`，所以空白切片也通过。

## 2026-08-21 本轮修复（P0-A 实现但已证伪 / P0-B 成立 / P0-C 完成）

### P0-A 已完成：生成底图职责拆开

`server/services/visualAssetCreation.ts`

- 新增 `canonicalBoardLayoutTemplate(kind)`：用 `sharp` 把一段 SVG 渲染成 1024×1024 的中性栏位人形占位模板，按 kind 缓存，人物是横向三栏、场景与风格是 2×2 四格。模板不含任何文字、标签或分隔说明，避免被模型画进成品。
- `generationOptions()` 的 `referenceImageUrl` 改成这张布局模板，真实人物参考图只作为身份 / 发型 / 服装的 context 图传入。
- prompt 逐图声明职责：图 1 只决定构图和栏位，后续图片只决定固定造型，不得保留其构图。
- 版本号记录在 `CANONICAL_BOARD_LAYOUT_TEMPLATE_VERSION`，改模板时要一起改，方便区分历史产物。

### P0-B 已完成：标准板结构质检，fail-closed

新增 `server/services/visualAssetBoardStructure.ts` + `visualAssetBoardStructure.test.ts`。

- `inspectCanonicalBoardStructure()` 把整张标准板交给视觉模型，逐项检查：`subject_count` 恰好三个人物、`full_body` 是否全部从头到脚、`view_order` 从左到右是否正面 / 严格 90° 侧面 / 背面、`same_person` 是否同一脸与发型与服装与比例、`clean_board` 是否没有多余人物 / 文字 / 水印 / 跨栏。
- 只有**全部检查项 pass、置信度足够高、且模型给出了具体证据描述**才返回 `pass`。
- 以下情况一律返回 `unknown`，绝不猜 `pass`：调用失败或超时、响应不是 JSON、缺少任一必查项、置信度过低、没有写理由、出现无法识别的判定词。
- 结构不合格返回 `fail` 并带 `reason`，付费结果仍然展示给用户检查，但不允许锁定。
- `splitCanonicalBoard()` 之后写视图状态时直接使用这个判定：`pass` / `fail` / `unknown`，非 `pass` 一律写入 `failureReason`。

### P0-C 已完成：错误通过的数据已改判，付费证据保留

- 新增 `recordVisualAssetViewReview()`（`visualAssetPersistence.ts`）与 tRPC 入口 `visualAssets.reviewViews`：人工对已生成视图改判，走同一套 revision CAS 与 operation token 重放保护。非 `pass` 的判定必须写明原因，否则拒绝落库；锁定版本不允许直接改判，需要新建版本。
- 已对 Story 1186 / `va_kXGdymUxHEsK` / `vav_j2q_zmCuGVCp` 执行改判，revision 2363 → 2364，四张视图全部为 `fail`：
  - front：`不是三视图：正面栏几乎全是空背景，没有人物`
  - profile：`不是三视图：该栏是三分之四侧身局部肖像，不是严格 90° 侧面全身`
  - back：`不是三视图：背面栏几乎全是空背景，没有人物`
  - identity-detail：`标准板只有一个三分之四侧身人物，无法作为身份细节视图`
- imageId 1691–1695 全部保留，没有删除任何付费证据；`boardImageId` 仍是 1691。
- 页面已实测：`http://localhost:3000/editing` → 素材仓库 → 资产，人物卡显示「标准板不合格：不是三视图：正面栏几乎全是空背景，没有人物」与「锁定前还需：标准视图尚未全部通过」，`锁定此版本` 按钮 `disabled = true`。

### 注意：本地数据只能通过运行中的服务改

`server/db.ts` 的 `persistMemoryStateToDisk()` 是把整份内存态序列化后原子覆盖 `.webdev/local-persist.json`，**从不回读磁盘**。所以另起一个脚本进程去写这个文件，会在 dev server 下一次落盘时被静默清掉（本轮实测磁盘 revision 2360、服务内存 2362）。要改真实数据只有一条路：打到运行中的 3000 端口。

Story 1186 的 owner 是 user 48，openId 正好等于 `.env` 里的 `DEV_FIXED_GUEST_OPEN_ID`，本地 `authDisabled()` 为真，所以不带 cookie 的 curl 就会解析成 user 48：

```bash
curl -s -G "http://localhost:3000/api/trpc/visualAssets.read" \
  --data-urlencode 'input={"json":{"storyId":1186}}' | jq .
```

写入同理，`POST /api/trpc/visualAssets.<procedure>`，body 为 `{"json":{...}}`（superjson）。

## 第二次真实付费重试（2026-08-21，¥1.49，已花掉）

- operation token：`visual-board-retry-20260821-01`
- 报价：`¥1.49`，1 个候选，`inputHash 120192cf…`
- 耗时：约 75 秒（生成 + 结构质检）
- 标准板 imageId：`1697`，切片 `1698` / `1699` / `1700` / `1701`
- 本地文件：`.webdev/images/1787319972542-3q3nqo.png`（标准板）

### 好消息：结构质检在真实模型上是有效的

`qwen3-vl-plus` 判定 `fail`，理由「画面仅含一个正面半身头像，无侧面与背面视图，未呈现三栏全身三视图结构。」四张视图全部写 `fail` 并带这条原因，版本仍是 `review`，锁定入口保持关闭。**没有再出现假通过。**这是 P0-B 的真实验收。

### 坏消息：P0-A 的布局模板方案被证伪

人工看真实像素的结论比模型判定更严重：产出是一张**扁平灰色、没有任何身份特征**的正面半身头像——没有黑色齐耳短发，没有白色长裙，不是那个人。

根因：`gpt-image` 的 edit 模式下，**底图同时支配构图和画风**。喂进去的三人形占位模板是灰色剪影（可用 `canonicalBoardLayoutTemplate("character")` 导出查看），模型就把「灰色扁平剪影」当成了目标画风，同时放弃了三栏结构、放大了单个人形的头部；三张真实人物参考图虽然确实作为 `referenceContextImageUrls` 送出去了（接线已确认无误），但完全没起作用。

**这比第一次还差**：第一次至少人物是对的，只是构图不对；这次连身份都没了。

结论：**中性占位图不能当 edit 底图。**交接文档里 P0-A 那条「用程序生成的布局模板当图 1」的处方，对这个供应商是错的。代码目前仍是这个方案，下一位 Agent 需要改掉。

### 建议的下一步方向（都没试过，需要用户授权才能付费验证）

1. **单视角分次生成 + 服务端合板**（推荐）：每次只让模型画一个人的一个视角——这是它擅长的——用真实人物照当底图保身份，分别要正面全身、严格 90° 侧面全身、背面全身，然后用 `sharp` 在服务端确定性地拼成三栏板。这样构图由代码保证，结构质检只需要查身份一致性。代价是三次调用，约 `¥4.5`。
2. **改走文生图**：固定事实里的 face / hair / outfit 描述已经非常详细，不用 edit 模式，直接文生图描述「三栏全身转身表」。成本不变，但身份保真度会下降。
3. 保留 edit 模式但把底图换成**真实人物照**（回到第一次的做法），只靠 prompt 争取三栏——第一次已经证明模型会死守单人构图，成功率低，不建议单独用。

不管选哪条，第三次付费前都要先拿到用户明确授权。

## 当前生成策略：分视角生成 + 服务端合板（2026-08-21 重做，未经真实付费验收）

### 为什么换

两次真实付费都证明同一件事：`gpt-image` 的 **edit 模式下底图同时支配构图和画风**，指望模型自己排出多格标准板不可靠。

- 第一次底图 = 真实人物照 → 死守那张照片的单人构图。
- 第二次底图 = 灰色三人形占位模板 → 把灰色剪影当成目标画风，连身份都丢了。

所以不再要求模型排版。**构图交给代码，模型只做它擅长的事：画一个主体的一个视角。**

### 现在的流程

1. `generatedVisualAssetViewRoles(kind)` 给出需要付费生成的视角：人物 `front / profile / back`（3 次），场景 `establishing / reverse / side / top`（4 次），风格四个样例（4 次）。
2. 每个视角一次独立调用。底图 = **第一张真实参考图**（保身份），其余参考图作为 context，prompt 由 `viewPrompt()` 逐视角生成，明确写「本次只画这一个视角」「禁止自行拼成多格、三视图、对比图或分镜」。
3. `composeCanonicalBoard()` 用 `sharp` 把结果确定性合成：人物横向一行，场景/风格 2×2，每格 512px、`fit: contain` + 白底，**绝不裁掉全身人物的头或脚**。
4. 人物的 `identity-detail` 不单独付费，由 `deriveIdentityDetail()` 从正面视图上缘裁 52% 得到。
5. 合成后的标准板仍然过 `inspectCanonicalBoardStructure()`，继续 fail-closed。构图已由代码保证，这一关现在主要验证内容：三个视角是不是真的正面 / 严格侧面 / 背面、是不是同一个人、是不是都全身。

### 计费与重试

- 报价 `candidateCount` = 需要生成的视角数，`estimatedCny` = 单次价 × 视角数。人物约 **¥4.47**（3 × ¥1.49）。页面确认文案已同步改成「分 N 次生成…再由服务端合成」。
- 每个视角一张独立操作回执，token 为 `${mainToken}:view:${role}`。**中途失败重试只补买失败的那个视角**，已成功的视角凭回执 `resultId` 直接复用图片行，不会把整组重新买一遍。已有测试覆盖。
- 视角提交状态不明且没有供应商任务号时，照旧拒绝自动重复购买。

### 还没验证的事

单视角能否稳定画出**严格 90° 侧面**和**纯背面全身**、三个视角之间**身份是否一致**，目前只有 mock 测试覆盖。真实付费后必须人工看像素，不能只看 `pass`。

## 真根因：一直跑在 flux-kontext-pro 上（2026-08-21 第四次付费后定位）

**交接文档此前写的「生成模型链路：gpt-image-1.5，302 GPT Image edit」是错的。** 四次真实付费全部跑在 `flux-kontext-pro`。

`server/services/imageGen.ts` 的 `generateImage()` 在入口就有这一段：

```ts
// FLUX Kontext：有参考图时优先走 Kontext 保角色/场景一致性
if (options.provider !== "midjourney" && options.referenceImageUrl && ENV.api302Key) {
  return generate302FluxKontext(...);   // model: "flux-kontext-pro"
}
```

`generationOptions()` 设了 `provider: "gpt-image"`，但只要带 `referenceImageUrl` 就在这里被截走，`provider` 根本没被看。

Kontext 是**保留式的指令编辑模型**：它的设计目标就是维持输入图的取景、姿态和背景，只改被点名的地方。而人物三视图恰恰要同时改四件事——朝向、景别、姿态、背景。这解释了全部四次失败：

| 次 | 花费 | 底图 | 结果 |
|---|---|---|---|
| 1 | ¥1.49 | 真人照 | 死守单人构图 |
| 2 | ¥1.49 | 灰色三人形模板 | 把灰色剪影当画风，丢光身份 |
| 3 | ¥4.47 | 真人照 × 分视角 | **身份稳定**，但半身、绿墙背景、背面画成正脸 |
| 4 | ¥1.49 | 真人照 × 加硬 prompt | 同上，prompt 再硬也没用 |

第 3 次已经证明「分视角生成 + 服务端合板」的架构是对的（身份稳定、构图由代码保证）；卡住的一直是模型选错。

### 改法

1. 改调 `editImage()` 而不是 `generateImage()`。`editImage` 会走 `generate302GptImageEdit`（302 gpt-image 多图编辑端点），愿意按提示词重构画面。
2. 给 `ImageGenOptions` 加 `preferStructuralEdit`，并在 `editImage` 的路由条件里认它。**原先 `editImage` 只在「参考图多于一张」时才走 gpt-image 编辑端点**，单参考图的资产仍会掉回 Kontext——不能靠参考图数量碰运气。Story 1186 恰好有 3 张参考图才没暴露这个洞。
3. `renderOneView()` 里 `dependencies.edit(identityBase, gated, options)`，依赖键从 `generate` 改名为 `edit`。

### 顺带发现的防呆缺口

`dependenciesOf()` 是 `{...defaults, ...overrides}`，**未知键静默忽略**。本轮把依赖从 `generate` 改名成 `edit` 后，两个测试里残留的 `generate:` 覆盖直接失效，测试跑去调**真实付费 API**（各 24 秒）才被发现。已修，但这个模式还在，值得加个防呆。

## 单视角重生成（2026-08-21 新增）

prompt 调优时整组重买太贵，所以加了只重生成一个视角的入口：

- `visualAssets.quoteView`（`{storyId, assetId, versionId, role}`）→ 单视角报价，`candidateCount: 1`。报价签名绑定 role，拿「背面」的确认去买「正面」会被拒。
- `visualAssets.regenerateView`（多带 `role` / `operationToken` / `confirmation`）→ 只付费生成那一个视角，其余视角**直接读版本里已存的图片**，重新合板后再跑一次结构质检。
- 已验证：一次整组生成后再单独重生成背面，只发生 1 次付费调用，标准板换成新的一张。

## 修复验收通过（2026-08-21 第五次付费，¥1.49）

换成 gpt-image 结构化编辑后，单独重生成背面视角（token `visual-view-back-20260821-02`，imageId `1712`），**一次就对了**：

- 纯背面，看不到脸和任何五官；
- 头顶到鞋底完整入画，上下都有留白；
- 平整中性影棚背景，没有墙角和柱子；
- 直立站姿；
- 身份保住：黑色齐耳短发的后脑轮廓、米白细肩带露背长裙配背拉链、裙摆至脚踝，与固定事实一致。

**人工看过真实像素**，不是只看 `pass`。这证明前四次失败（累计 ¥8.94）的唯一原因就是跑在 `flux-kontext-pro` 上。

结构质检同时正确指出剩下两栏的问题：「左中人物半身被裁，中间非严格侧面，且有实体分隔线」——那正是仍未重生成的正面 `1703` 和侧面 `1704`（Kontext 时代产物）。判定 `fail`，锁定入口保持关闭。这一条同时说明质检本身是准的。

### 剩下要做的

正面和侧面各重生成一次（`visualAssets.regenerateView`，role 分别为 `front` 和 `profile`），约 ¥2.98。完成后人工确认三栏，再走锁定 → 镜头绑定 → 图片/视频共用快照验收。

## 下一位 Agent 的优先任务

### ~~P0-A：先补失败测试，再改生成底图~~（已实现，但方案已被第二次付费证伪，需重做——见上一节）

在 `server/services/visualAssetCreation.test.ts` 增加断言：

- 人物三视图生成传给 `gpt-image` 的主图是三栏布局模板，不是第一张人物照片。
- 三张真实人物参考仍作为 context images 传入。
- prompt 清楚声明图 1 只负责布局、后续图片只负责身份/服装。

建议用 `sharp` 在服务端生成 1024×1024 的中性三栏人形占位模板，避免文字、标签和分隔说明被模型画进成品。

### ~~P0-B：加入真实的标准板结构质检，必须 fail closed~~（已完成并通过真实模型验收）

在切片标 `pass` 之前，使用视觉模型检查整张标准板：

- 是否恰好三个人物；
- 是否全部从头到脚完整；
- 是否从左到右为正面、严格 90° 侧面、背面；
- 是否同一脸、发型、服装、比例；
- 是否没有额外人物、文字、水印或跨栏。

视觉模型超时、解析失败或证据不足必须写 `unknown`，不能猜 `pass`。结构不合格写 `fail` 并带 `failureReason`，仍可把付费结果展示给用户检查，但不得锁定。

可复用：

- `server/services/visionChannel.ts`
- `server/services/visualAssetConsistencyGate.ts` 的 fail-closed 解析模式
- `VisualAssetViewStatus = pending | pass | fail | unknown`

### ~~P0-C：处理本次错误通过的数据~~（已完成，见上一节）

不要删除 imageId 1691–1695，它们是付费失败证据。通过正式 mutation 把四张视图改成 `fail` 或建立一个修正版本；不要直接手改 `.webdev/local-persist.json`。锁定入口必须立即被禁止，并在页面显示“不是三视图：左右栏缺少人物”。

### ~~P0-D：第二次付费重试~~（已执行，结果见上方「第二次真实付费重试」）

P0-A/B/C 与自动测试都已完成，前置条件已满足。仍然必须先在页面看到新的费用确认，再向用户请求第二次 `¥1.49` 左右的明确授权。不要自动重试，不要复用新的随机 operation token 偷偷再次购买。

注意：结构质检会在付费生成之后额外跑一次视觉模型，单次生成的墙上时间会比上次的约 55 秒更长（质检超时上限与分析链一致）。这是有意的——宁可多等，也不要再把不合格结果写成 `pass`。

重试完成后必须人工检查真实像素，不能只看数据库里的 `pass`。

### P1：成功后继续完整链路

1. 人工确认合格的正面/侧面/背面。
2. 锁定人物版本。
3. 选一个真实镜头，关联人物版本。
4. 验证图片要求页显示绑定版本。
5. 分别走到图片和视频生成付费确认前，检查两者使用同一 asset/version snapshot。
6. 经用户另行确认后做真实小规模一致性生成验收。

## 核心文件

| 文件 | 作用 |
|---|---|
| `shared/visualAssets.ts` | 资产、版本、冲突、视图、绑定、操作回执类型与锁定条件 |
| `server/services/visualAssetCreation.ts` | 参考分析、报价、布局模板、标准板 prompt、付费生成、切片 |
| `server/services/visualAssetBoardStructure.ts` | 标准板结构质检（fail-closed），切片标 `pass` 前的唯一关口 |
| `server/services/visualAssetPersistence.ts` | Story CAS 持久化、冲突裁决、视图人工改判、锁定、回执 |
| `server/routers/visualAssets.ts` | tRPC 入口 |
| `server/services/visualAssetAssociations.ts` | AI 镜头绑定建议与确认 |
| `server/services/visualAssetGenerationContext.ts` | 图片/视频共用的不可变生成快照 |
| `server/services/visualAssetConsistencyGate.ts` | 已绑定资产的候选一致性 fail-closed 门禁 |
| `client/src/features/creationEditor/visualAssets/VisualAssetLibrary.tsx` | 资产卡、三视图流程、锁定入口 |
| `client/src/features/creationEditor/visualAssets/ShotAssetBindingPanel.tsx` | 当前镜头与批量绑定 UI |
| `client/src/features/creationEditor/views/MaterialWarehousePanel.tsx` | 素材仓库资产分类入口 |
| `client/src/features/creationEditor/views/PromptTablePanel.tsx` | 当前镜头图片/视频共用资产状态 |
| `docs/features/feature-ledger.json` | `story-visual-assets` 功能卡与真实验收历史 |

## 当前测试证据

最近一次完整定向结果（2026-08-21 本轮）：

- 11 个测试文件通过。
- 47 项测试通过。
- `pnpm check` 通过。
- `pnpm feature:validate` 通过，27 张功能卡合法。

新增覆盖：

- `visualAssetBoardStructure.test.ts`：单人物画面判 `fail`；缺项 / 非 JSON / 调用失败 / 低置信度 / 无理由 / 无法识别的判定词一律 `unknown`；场景与风格走 2×2 版本的检查表。
- `visualAssetCreation.test.ts`：主图必须是布局模板而不是第一张人物照；三张真实参考仍作为 context 图；结构质检判 `fail` 时视图不得写 `pass`；判 `unknown` 时视图写 `unknown`。
- `visualAssetPersistence.test.ts`：错误通过的视图可被改判为 `fail` 且付费图片不被删除，改判后锁定被拒；非 `pass` 判定必须写原因，未知角色被拒。

`visualAssetCreation.test.ts` 每个用例都要跑 sharp（参考板合成、模板渲染、标准板切片），已在文件内设 `vi.setConfig({ testTimeout: 30_000 })`；默认 5 秒超时在机器有负载时会假失败。


命令：

```bash
pnpm exec vitest run \
  shared/visualAssets.test.ts \
  server/services/visualAssetPersistence.test.ts \
  server/services/visualAssetCreation.test.ts \
  server/services/visualAssetBoardStructure.test.ts \
  server/routers.visualAssets.test.ts \
  server/services/visualAssetAssociations.test.ts \
  server/services/visualAssetGenerationContext.test.ts \
  server/services/visualAssetConsistencyGate.test.ts \
  server/services/storySync.visual-assets.test.ts \
  client/src/features/creationEditor/visualAssets/VisualAssetLibrary.test.tsx \
  client/src/features/creationEditor/visualAssets/ShotAssetBindingPanel.test.tsx

pnpm check
pnpm feature:validate
```

注意：这些测试证明的是代码路径与 mock 行为——“单人物画面不得被当成三视图通过”现在有测试覆盖了，但**测试用的是 mock 视觉模型**。真实模型是否真能识别出空白栏，只有第二次付费重试后人工看真实像素才能确认。不要因为测试全绿就宣称问题已解决。

## 数据只读检查命令

```bash
jq '.stories[] | select(.id == 1186) |
  {revision:.body._revision, visualAssets:.body.visualAssets}' \
  .webdev/local-persist.json

jq '[.generatedImages[] |
  select(.id >= 1691 and .id <= 1695) |
  {id, shotNo, imageUrl, imageKey, prompt}]' \
  .webdev/local-persist.json
```

不要用 `storyboard-render-fast-check` 检查这类资产图片：该脚本要求普通故事板 cue，而标准板使用特殊 `shotNo = "VISUAL-ASSET"`，会报告“没有镜头”。直接只读检查 Story 的 `body.visualAssets` 与 `generatedImages`。

## 功能账本约束

继续修改前先读 `docs/features/feature-ledger.json` 的 `story-visual-assets` 卡。完成后：

- 把本次真实失败写入 history/knownGaps；
- 更新权威代码和测试证据；
- 运行 `pnpm feature:validate`。

不能因为页面存在或 mock 测试通过就把功能标成 `working`。真实三视图、锁定、镜头绑定以及图片/视频共用绑定完成前，保持 `observing`。

