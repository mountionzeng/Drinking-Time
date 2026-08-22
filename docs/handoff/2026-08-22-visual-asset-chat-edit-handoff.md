---
date: 2026-08-22
topic: visual-asset-chat-edit
status: 服务端已全部就绪；只需做前端「选中标准视图 → 在聊天框说怎么改 → 提案卡确认」
branch: codex/story-visual-assets
story_id: 1186
---

# 交接：选中标准视图，在聊天框改它

## 目标（用户原话）

> 我是希望我直接选中这个照片，在聊天框会显示我选中的是哪个照片，然后我就直接跟聊天框说我想怎么改它

## 一句话范围

**服务端一行都不用改。** 四类修改动作的 tRPC 接口都已实现、测过、并在真实付费场景里跑通过。这份工作全在前端：让标准视图可选中、让聊天框显示选中了哪一张、让 agent 产出一张带价格的提案卡。

---

## 一、先读这个：标准板不是一张生成图

人物标准板（当前是 `#1730`）是**服务端用 sharp 把四张独立单视角图横向拼出来的**，不是模型产出的单图。

```
#1730 = [front 1724] [profile 1725] [back 1726] [identity-detail 1729]
```

所以：

- **对整板做图生图是死路。** 任何一栏重生成，合板都会重拼，你在合成图上改的东西全丢，来源关系也断了。
- **选中粒度必须是「某一栏」**，不是整板。v1 建议直接点四张缩略图，`role` 无歧义。
- 以后想在整板上框选：板子是定宽等分的，`x` 除以栏数就能反推 `role`，`SelectionRegion` 的 `rect` 已经支持。属于后续增强。

---

## 二、两种「改」必须分开路由（最重要的一条）

版本自身已经把这件事结构化了：

| | 字段 | 含义 |
|---|---|---|
| 锁死 | `fixedFacts` = face / hair / outfit / accessories | 契约，**所有已绑定镜头的出图都按它走** |
| 允许变 | `allowedVariations` = 景别、机位、姿态、表情、视线、光照、背景 | 每个镜头可以不一样 |

对应两条路：

### ① 这一栏没画对

例：「侧面不够正」「背景有柱子」「手的姿势别扭」「双手自然垂在身侧」

→ 只重生成那一栏，`fixedFacts` 不动。**¥1.49**

### ② 这个人应该长得不一样

例：「让她光脚」「裙子改成有袖的」「加条项链」「换个发型」

→ 改 `fixedFacts`，**所有视图作废、整套重出**。人物 4 栏 = **¥5.96**

### 为什么不能自动判

②误走①，会得到「正面光脚、侧面背面穿鞋」的板子；更要命的是 `fixedFacts` 没变，**以后每一个镜头出图还是会给她穿上鞋**——正好是这套资产存在的意义所要防的事。

所以：**agent 只提案，路由由用户拍板。** 提案卡上永远留一个反悔口子。

> 真实案例：用户说「我希望女主是个光脚」。鞋子属于 `outfit`，是②。当时按②做了，三栏一起重出。如果当时只改了一栏，资产就废了。

### ③ 提案卡真正要给用户审的是那句话，不是图

走②时，卡上应该显示 **`fixedFacts` 的前后 diff**：

```
outfit  …裙摆垂至脚踝
      → …裙摆垂至脚踝；赤脚，不穿鞋不穿袜，双脚裸露可见
```

因为那句话才是契约。图只是它的结果。这条比交互本身更重要。

---

## 三、服务端已就绪的接口（直接调，别改）

全在 `server/routers/visualAssets.ts`，都是 `protectedProcedure`。

### 改单栏（①）

```ts
visualAssets.quoteView({ storyId, assetId, versionId, role, instruction? })
// → { estimatedCny: 1.49, candidateCount: 1, inputHash, quoteId, expiresAt, ... }

visualAssets.regenerateView({
  storyId, assetId, versionId, role,
  operationToken,          // 前端生成，见下方「重试规则」
  confirmation,            // 上一步的整个 quote 对象原样传回
  instruction?,            // 用户那句话，会追加进 prompt
})
```

`instruction` 会以「本次额外要求（不得违反上面的固定事实）：…」追加到 prompt 末尾，压过通用措辞但压不过固定事实。

**`instruction` 也进报价签名**：不带意见的确认不能拿去买带意见的图。改了意见就要重新报价。

**报价签名绑定 `role`**：拿「背面」的确认去买「正面」会被拒（返回 `confirmation_required`）。

### 改固定造型（②）

```ts
visualAssets.amendFixedFacts({
  storyId, expectedRevision, operationToken, assetId, versionId,
  amendments: [{ field: "outfit", value: "…新的完整描述…" }],
})
```

- `field` 必须是该 kind 已有的固定事实字段；`kind` 本身不可改；空值拒绝。
- **改完会自动把所有视图打回 `fail`**，`failureReason` 写「固定造型已修改（outfit），标准视图需要重新生成」，锁定入口随之关闭。
- 然后调 `quoteCanonicalBoard` + `generateCanonicalBoard` 整套重出。

### 锁定版本上做修改

锁定版本不可变。要改先派生：

```ts
visualAssets.forkVersion({ storyId, expectedRevision, operationToken, assetId, sourceVersionId })
```

- 继承 `fixedFacts` / `allowedVariations` / `conflicts` / `boardImageId`
- **只继承当初 `status === "pass"` 的视图**，不用重新买
- 源版本原样保留（锁定的仍锁定，已绑镜头不受影响）

> 这条能省很多钱：给 v2 加头部特写时，三张全身图从 v1 继承，只花了 ¥1.49 而不是 ¥5.96。

### 删除

```ts
visualAssets.deleteVersion({ storyId, expectedRevision, operationToken, assetId, versionId })
visualAssets.deleteAsset({ storyId, expectedRevision, operationToken, assetId })
```

- **只删记录，绝不删图片**——生成图是真金白银买的，也是排查证据，一律留在素材仓库。确认文案必须说明这一点。
- 任一版本仍被镜头绑定时**拒绝删除**并列出是哪些镜头。
- 删资产会一并清掉指向它的绑定建议。

### 人工改判视图

```ts
visualAssets.reviewViews({ ..., reviews: [{ role, status, failureReason? }] })
```

结构质检 fail-closed，超时/解析失败/置信度不足一律 `unknown`。人工看过真实像素后用这个改判成 `pass`。非 `pass` 的判定必须写原因。

---

## 四、前端已有的机制（八成现成）

| 文件 | 现状 |
|---|---|
| `shared/selectionContext.ts` | `SelectionContext` 类型，`sourceType` 联合里已有 `storyboard-image`，带 `imageId`、`storyId`、`stableShotId`，`selection` 支持 `rect` 框选 |
| `client/src/features/storyAgent/views/SelectionContextCard.tsx` | 已经负责在聊天框上方显示「你选中了什么」 |
| `client/src/features/creationEditor/mediaSelectionContext.ts` | `buildImageRegionSelection()` —— 为分镜图构造选中上下文的现成范例 |
| `client/src/features/storyAgent/components/EditingTransitionCandidateCard.tsx` | **带价格的提案卡范例**（「预计 ¥0.69…确认并生成 / 修改 / 取消」），照着抄 |
| `client/src/features/creationEditor/visualAssets/VisualAssetLibrary.tsx` | 资产卡，四张缩略图在这里渲染 |

代码里写明的原则：*Agent 的修改在用户明确确认前只是提案*（`storyAgent/types.ts:93`）。这次照办。

---

## 五、要加的东西

1. **`shared/selectionContext.ts`**：`sourceType` 加 `"visual-asset-view"`，带 `assetId` / `versionId` / `role`。
2. **`VisualAssetLibrary.tsx`**：四张缩略图可点选 → 写入选中上下文。⚠️ 这个文件我 2026-08-22 刚改过（加了「在此基础上修改」和删除入口），拉最新再动。
3. **`SelectionContextCard.tsx`**：认新类型，显示成「人物 · 标准视图 · 侧面」。
4. **agent 侧**：收到「选中某视图 + 一句话」→ 产出提案卡。这是唯一的真活。

提案卡建议长这样：

```
你选中：人物 · 标准视图 · 正面
你说：  让她光脚

判定：这是固定造型修改
  outfit  …裙摆垂至脚踝
        → …裙摆垂至脚踝；赤脚，不穿鞋不穿袜
影响：四栏全部重出（三栏全身都看得见脚）
费用：¥5.96

[确认]  [只修这一栏 ¥1.49]  [取消]
```

### 版本状态要分情况

- `review` → 直接改
- `locked` / `superseded` → 提案自动变成「基于此版本新建 v3 再改」（先 `forkVersion`）。已绑镜头继续指向老版本，不受影响。

---

## 六、操作坑（会真的花掉钱，务必先读）

### `:3000` 是共享进程，而且是 `tsx watch`

**改 `drinking-time-local/server/` 下任何文件都会触发重启，正在飞的付费出图请求会被打断。** 表现是 take `terminated`、拿不到供应商任务号。

2026-08-22 实测被坑两次，其中一次**付了钱但结果没落库**。

### 永远不要在主 checkout 跑 `pnpm dev`

`predev`（`scripts/dev-preflight.ts`）会枚举占用端口的进程并**对整个进程组发 SIGTERM**——把别人正在跑的 `pnpm preview:3000` 连锅端掉，不是重启，是直接退出。

```bash
pnpm preview:3000    # ← 只用这个。它没挂 predev，就是为了躲这个 pkill 才单独做的
```

### 好消息：重试不会重复扣费

标准视图按视角分别记操作回执，token 形如 `${主token}:view:${role}`。中途失败后**用同一个 operationToken 重试**会凭回执复用已付费的图，只补买失败的那一个。

⚠️ **前端务必把 operationToken 存住并在重试时复用**，换新 token = 重新全款购买。

实测：三视图第一轮 front/profile 成功、back 报 `terminated`，同 token 重试只买了 back，总额正好等于报价。

### 本地数据只能通过跑着的服务改

`server/db.ts` 的 `persistMemoryStateToDisk()` 把整份内存态原子覆盖 `.webdev/local-persist.json`，**从不回读**。另起脚本写这个文件会被下次落盘静默清掉。

Story 1186 的 owner 是 user 48，openId 等于 `.env` 里的 `DEV_FIXED_GUEST_OPEN_ID`，本地 `authDisabled()` 为真，所以不带 cookie 的 curl 就解析成 user 48：

```bash
curl -s -G "http://localhost:3000/api/trpc/visualAssets.read" \
  --data-urlencode 'input={"json":{"storyId":1186}}' | jq .
```

写入同理，`POST /api/trpc/visualAssets.<procedure>`，body 为 `{"json":{...}}`（superjson）。

---

## 七、当前真实数据

- Story：`SheSelf V03`，id `1186`，owner user `48`
- 人物资产：`va_kXGdymUxHEsK`

| 版本 | id | 状态 | 标准板 | 视图 |
|---|---|---|---|---|
| v1 | `vav_j2q_zmCuGVCp` | `superseded` | `1727` | front 1724 / profile 1725 / back 1726 / identity-detail 1728（旧的裁切图） |
| v2 | `vav_MROVflJ6EbBB` | `locked` | `1730` | front 1724 / profile 1725 / back 1726 / **identity-detail 1729（真生成的头部特写）** |

v2 是当前有效版本：四栏 = 正面 / 严格 90° 侧面 / 背面全身（均赤脚）+ 正面头部特写。

**测试改动时请用 v2 派生 v3，不要动 v1 和 v2。**

### 一条重要的设计结论

人物的身份锚点（`REPRESENTATIVE_ROLE.character`）已从 `front` 改为 `identity-detail`。原因：全身图一格 512px，脸只剩几十像素，递给出图模型等于没给脸。**头部特写必须真生成，不能从全身图裁**——裁出来是把糊脸放大。

---

## 八、验证

```bash
pnpm check
pnpm feature:validate

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
  server/services/imageGen.test.ts \
  client/src/features/creationEditor/visualAssets/VisualAssetLibrary.test.tsx \
  client/src/features/creationEditor/visualAssets/ShotAssetBindingPanel.test.tsx
```

基线（2026-08-22）：**12 个文件、126 项测试通过**，`pnpm check` 干净，功能账本 27 张卡合法。

⚠️ `visualAssetCreation.test.ts` 每个用例都跑 sharp，已在文件内设 `vi.setConfig({ testTimeout: 30_000 })`；默认 5 秒超时在机器有负载时会假失败。

⚠️ **依赖注入没有防呆**：`dependenciesOf()` 对未知键静默忽略并回落到真实实现。测试里把依赖键名写错（例如该写 `edit` 写成 `generate`）会直接调**真实付费 API**——本轮实测两个用例各跑了 24 秒才被发现。改依赖名时全文搜一遍。

---

## 九、已知缺口（别踩重）

1. **结构质检对返回格式漂移不够健壮**：光脚那版模型把检查项描述原样吐回、没给可解析的 verdict，门禁按 fail-closed 判 `unknown`（行为正确，但要人工改判才能锁定）。置信度门槛是 0.85。
2. **图片只有本地单份，`imageKey` 不可信**：`storeImageBytes` 的远程备份是 `void` 的发射后不管，函数在备份 promise 落定前就无条件返回确定性算出的 `imageKey`（该函数顶部注释写的「成功记 imageKey」与实现不符）。`/api/images` 的兜底只在本地文件丢失时按 key 回源，所以 302 备份 503 期间产出的图一旦本地丢失就彻底没了。**没有补传队列或补传脚本。**
3. 场景与风格资产的分视角生成还没跑过真实付费。
