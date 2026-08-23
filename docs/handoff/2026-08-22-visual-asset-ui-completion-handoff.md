---
date: 2026-08-22
topic: visual-asset-ui-completion
status: 服务端 18 个能力，UI 只接了 13 个；人物资产流程目前无法在界面上走完
branch: codex/story-visual-assets
story_id: 1186
---

# 交接：把视觉资产流程补成用户真能点完的

## 一句话

标准板功能今天已经用真金白银验通了（人物资产 v2 已锁定），**但整条流程是我用 curl 打接口走完的，不是在界面上点完的**。有 5 个服务端能力没有任何 UI 入口，其中一个会让用户彻底卡死。这份工作就是补齐它们。

**服务端不用改。** 所有接口都已实现、测过、在真实付费场景里跑通。

---

## 一、最要紧的洞：质检判 unknown 时，用户永远锁不上

结构质检是 fail-closed 的：视觉模型超时、返回格式漂移、置信度不足，一律写 `unknown`，不猜 `pass`。这个设计是对的，今天救过一次错误通过。

但是——

- 视图 `status = "unknown"` → `isVisualAssetVersionLockable()` 返回 false → **锁定按钮永久置灰**
- 唯一能改判的接口 `visualAssets.reviewViews` **没有 UI 入口**

今天真实发生过两次：

| 情况 | 质检返回 |
|---|---|
| 光脚版三视图 | `unknown`，模型把检查项描述原样吐回、没给可解析的 verdict |
| 加了头部特写的 v2 | `unknown`，置信度 0.75，门槛是 0.85 |

两次的图**人工看都是完全正确的**，但用户在界面上无路可走。我是用 curl 调 `reviewViews` 改判成 `pass` 才锁上的。

**这是 P0。** 一个用户花了 ¥5.96 出了一块对的板子，然后被系统告知不能用，且没有任何按钮可以申诉。

### 要做的

在资产卡上，当存在 `status !== "pass"` 的视图时，除了现在已有的失败原因横幅，再给一个人工复核入口：

- 让用户逐张看四个视图的大图（现在只有 aspect-square 的小缩略图，看不清）
- 每张可以标「通过 / 不通过」，不通过必须写原因（服务端强制，非 pass 判定没有原因会被拒）
- 提交走 `visualAssets.reviewViews`

文案上要说清楚这是**人工复核**，不是绕过质检：质检说不确定，人看过了负责。

---

## 二、另外四个缺口

`git` 里可以自己复现这份清单：

```bash
grep -rh "trpc\.visualAssets\." client/src | grep -oE "visualAssets\.[a-zA-Z]+" | sort -u
grep -n "^  [a-zA-Z]*: protectedProcedure" server/routers/visualAssets.ts
```

| 接口 | 严重度 | 说明 |
|---|---|---|
| `reviewViews` | **P0** | 见上。不补则 unknown 状态无解 |
| `amendFixedFacts` | **P1** | 改固定造型（「让她光脚」「裙子加袖子」）。今天用户提的需求就是这个，我用 curl 做的 |
| `quoteView` + `regenerateView` | **P1** | 只重生成一个视角，¥1.49。不补的话用户想修一栏就得整套重出 ¥5.96（人物）／¥5.96（场景四格） |
| `confirmBinding` | P2 | 单镜头绑定。复数版 `confirmBindings` 已接，单数没接，可能本来就不需要 |

### `amendFixedFacts` 的 UI 要点

固定事实是**契约**——所有已绑定镜头的出图都按它走。所以这个入口不能做成随手改的输入框：

- 必须显示**改前 → 改后**的对照（用户真正在审的是那句话，不是图）
- 必须说明后果：改完所有标准视图会自动作废、锁定入口关闭、需要重新生成（人物 ¥5.96／场景 ¥5.96）
- 锁定版本不能直接改，要先 `forkVersion`（「在此基础上修改」按钮已存在）

字段按 kind 分支，别把人物那套硬套到场景：

- 人物 `face` / `hair` / `outfit` / `accessories`
- 场景 `geometry` / `materials` / `fixedProps`
- 风格 `medium` / `brushwork` / `formLanguage` / `colorLanguage` / `forbidden`

⚠️ **`amendFixedFacts` 对数组字段是整份替换**（`[value]`），不是追加。UI 上要让用户明白这是覆盖。这跟 `resolveConflicts` 的语义正好相反——那个是「剔除落选、保留其余、追加裁决」。

### `regenerateView` 的 UI 要点

- `instruction` 参数会追加进该视角的 prompt，且**进报价签名**：改了意见必须重新报价，旧的 `confirmation` 会被拒
- 报价签名也**绑定 role**：拿「背面」的确认去买「正面」会返回 `confirmation_required`
- ⚠️ **`operationToken` 必须存住并在重试时复用**。失败重试用同一个 token 会复用已付费的图、只补买失败的那个；换新 token = 重新全款购买。今天实测：三视图第一轮 back 报 `terminated`，同 token 重试只买了 back，总额正好等于报价

---

## 三、今天走通的真实流程（用户要能点完这一串）

以 Story 1186 的人物资产为例，我实际执行的顺序：

1. 素材仓库 → 资产 → 建草稿，选参考图 ✅ 有 UI
2. 分析参考图，提取固定事实 ✅ 有 UI
3. 逐字段裁决冲突 ✅ 有 UI
4. 报价 → 确认费用 → 生成标准板 ✅ 有 UI
5. **看真实像素判断合不合格** ⚠️ 只有小缩略图，看不清
6. **质检判 unknown 时人工改判** ❌ 无 UI（P0）
7. 锁定版本 ✅ 有 UI
8. **想改造型（光脚）** ❌ 无 UI（P1）
9. **只重出一个视角** ❌ 无 UI（P1）
10. 选镜头绑定资产 ✅ 有 UI

第 5 步也值得一起做：现在四张视图是 `aspect-square object-cover` 的小格子，人物全身图在里面基本看不清脸。用户要「看真实像素」得去别处找图。点开看大图是很小的改动，但对「人工复核」这件事是必需的。

---

## 四、可以直接复用的东西

| 位置 | 用途 |
|---|---|
| `client/src/features/creationEditor/visualAssets/VisualAssetLibrary.tsx` | 资产卡本体。已有：失败原因横幅、锁定阻塞说明、`在此基础上修改`（fork）、删除入口、费用 `window.confirm` |
| `client/src/features/storyAgent/components/EditingTransitionCandidateCard.tsx` | 带价格的提案卡范例 |
| `client/src/features/storyAgent/views/ChatImageRemixTray.tsx` | 「选中的东西 → 带价格确认卡 → 结果」的托盘形状 |
| `client/src/features/storyAgent/views/storyboardImageRenderPlan.ts` | 多图参考的职责清单写法（每条「只用来 X」+「严禁 Y」成对） |

现在的费用确认用的是 `window.confirm`，功能上够用但很糙。如果要统一，上面那两个卡片组件是更好的形状。

---

## 五、会真花钱 / 白干的坑

**`:3000` 是共享进程，`tsx watch`。** 改 `drinking-time-local/server/` 下任何文件都会重启，**打断正在飞的付费出图请求**（表现是 take `terminated`）。今天被坑两次，其中一次付了钱结果没落库。你只做前端基本不会碰到。

**主 checkout 上永远不要跑 `pnpm dev`，只用 `pnpm preview:3000`。** `predev` 会对整个进程组发 SIGTERM，把别人的服务连锅端掉。

**本地数据只能通过跑着的服务改。** `persistMemoryStateToDisk()` 整份内存态覆盖写盘、从不回读，另起脚本写 `.webdev/local-persist.json` 会被静默清掉。

**Story 1186 的 owner 是 user 48**，openId 等于 `.env` 的 `DEV_FIXED_GUEST_OPEN_ID`，本地 `authDisabled()` 为真，所以不带 cookie 的 curl 就是 user 48：

```bash
curl -s -G "http://localhost:3000/api/trpc/visualAssets.read" \
  --data-urlencode 'input={"json":{"storyId":1186}}' | jq .
```

写入同理，`POST /api/trpc/visualAssets.<procedure>`，body `{"json":{...}}`（superjson）。

---

## 六、当前真实数据

- Story `SheSelf V03` id `1186`，owner user `48`

**人物资产** `va_kXGdymUxHEsK`

| 版本 | id | 状态 | 标准板 |
|---|---|---|---|
| v1 | `vav_j2q_zmCuGVCp` | `superseded` | `1727` |
| v2 | `vav_MROVflJ6EbBB` | **`locked`** | `1730` |

v2 是四栏：正面／严格 90° 侧面／背面全身（均赤脚）+ 正面头部特写。**用户已确认满意，不要动它。** 要测改动请用 `forkVersion` 派生 v3。

**场景资产** `va_5g0Pa4QodyK3`（画廊展厅）：固定事实刚按「圆形高台 + 密集杂陈」重写过，四张旧视图已作废，等重新生成。这条线还没验收完，UI 工作不依赖它。

---

## 七、验证

```bash
pnpm check
pnpm feature:validate     # 28 张卡

pnpm exec vitest run \
  shared/visualAssets.test.ts \
  server/services/visualAssetPersistence.test.ts \
  server/services/visualAssetCreation.test.ts \
  server/services/visualAssetBoardStructure.test.ts \
  server/routers.visualAssets.test.ts \
  server/services/visualAssetGenerationContext.test.ts \
  server/services/visualAssetConsistencyGate.test.ts \
  server/services/visualAssetAssociations.test.ts \
  server/services/storySync.visual-assets.test.ts \
  client/src/features/creationEditor/visualAssets/VisualAssetLibrary.test.tsx
```

基线：**10 文件 61 项通过**。

⚠️ `VisualAssetLibrary.test.tsx` 里的 trpc mock 是手写的对象，**新接一个 mutation 就要往 mock 里加一行**，否则报 `Cannot read properties of undefined (reading 'useMutation')`。我今天接 fork/delete 时踩过。

⚠️ `dependenciesOf()` 对未知依赖键静默忽略并回落到真实实现。测试里依赖键名写错会直接调**真实付费 API**（实测两个用例各跑了 24 秒才被发现）。

---

## 八、别把这件事做成「给每个接口加个按钮」

这套东西的价值在于**契约**：固定事实锁死之后，所有绑定镜头的出图都按它走。UI 要一直把这件事讲清楚：

- 改固定事实 = 改契约 = 所有已绑镜头受影响 → 必须显示前后对照和后果
- 只修一栏 = 不动契约 → 便宜、影响面小
- 人工改判 = 人对质检的不确定负责 → 要有明确的责任表述，不是「跳过检查」

今天用户提「让她光脚」时，如果系统只改了正面那一栏，就会得到正面光脚、侧面背面穿鞋的板子，而且 `fixedFacts` 没变，**以后每个镜头出图还是会给她穿上鞋**。这就是把两条路混淆的代价。
