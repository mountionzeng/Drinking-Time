# 交接：发布封面出图链路

交接时间：2026-08-12
分支：`codex/unified-image-art-direction`
交接人提交：`600a14e` → `92f685c` → `11b9ae8`（只含下列文件，工作区其余改动未动）

---

## 一句话状态

封面链路的代码问题已修完并有测试覆盖，**但今天没有一轮出图是在健康网络下跑的** ——
本机代理把 `302.ai` 劫持成 fake-IP，所有"生成失败"都出自这里。
在代理修好之前，任何出图结果都没有诊断价值。

---

## 一、先跑这条命令，不要跳过

```bash
pnpm check:images
```

只读探测，不提交任务、不扣费。当前输出：

```
api.302.ai   解析 → 198.18.0.43   ← fake-IP 段
file.302.ai  解析 → 198.18.0.67   ← fake-IP 段
api.302.ai 空请求   HTTP 200 · 2550ms
```

`198.18.0.0/15` 是 RFC 2544 保留段，也是 Shadowrocket / Clash fake-IP 模式的取值区间。
真实服务器不可能在这里。隧道能通但不稳且慢，表现为两种失败：

- `SocketError: other side closed` —— 已建立的连接被掐（图生图上传数 MB 时高发）
- `ConnectTimeoutError ... 198.18.0.43` —— 连接建立不起来

**修法在用户机器上**（代理规则加 `DOMAIN-SUFFIX,302.ai,DIRECT`），不是代码。
看到上面两种错误不要去改代码。

---

## 二、今天修了什么，以及为什么值得知道

八个 bug，其中五个是**同一个形状**：失败和不确定性用"数据的缺失"表达，
于是任何一层只要重建对象、给默认值、或 catch 一下，
"出事了"就悄无声息变成"一切正常"。

| 修复 | 原本会发生什么 |
|---|---|
| 像素质检改为标注而非丢弃 | 4 张付费图全被判定含文字 → 全部丢弃 → 用户付了钱看到空白 |
| 质检崩溃显式记录 `qualityCheckUnavailable` | catch 静默吞掉 → "没检查"和"检查通过"数据完全相同 → 满屏伪汉字的图被当成干净的呈现 |
| 供应商错误保留 `error.cause` | undici 只报裸的 `terminated`，不含可恢复关键词 → 已付费任务永久卡死 |
| 改写失败文案时转发 `providerTaskId` / `submissionUncertain` | 可能已扣费的提交被显示成 `failed`（像是能安全重试）而不是 `unknown` |
| 开新一轮先接管未恢复的付费凭据 | 点"换 4 张"生成新 token → 跳过恢复分支 → 直接覆盖旧 taskId，钱白花 |
| 部分交付不再作废整轮 | 供应商返回 3 张而非 4 张 → 整轮判失败、全部丢弃 |
| 参考图提交前压缩 | 1.6–2.0MB 的 PNG × 3 张 base64 后逼近 8MB POST，在这个网络上必断 |
| 图生图 `--iw` 1.4 → 0.5 | 参考图权重压过提示词，"按意见修改这张"无法执行"去掉文字""换成女性" |

另外两处提示词层面的修正：

**1. 提示词内部自相矛盾**（`renderGate.ts`）

```
【内容主权】…不得反转故事事实。
【用户持续要求】…但不能篡改已经确认的故事事实。   ← 自带否决尾巴
```

用户连写三轮"人物变成女性"都不落实，因为模型把"人物性别"当成故事事实、
判定用户越界。现已明确划界：**故事事实 = 人物关系、事件、含义；
原文没写的性别/年龄/发型/衣着/配色属于美术空缺，用户指定优先。**

**2. 正向提示词里列举禁忌名词等于点菜**（`publishingDraft.ts` 编译器提示词）

原提示词写"不要描绘书页、报纸、招牌"，扩散模型没有"不"的概念，
结果生成了一个人坐在报纸堆里。现改为**纯肯定式描述**，
压制交给 Midjourney 的 `--no` 参数（已加入版式类负面词：
杂志封面、刊头、海报、报纸、条形码、边框、签名、印章）。

**3. 中文长提示词改为编译成短英文**

原本给 MJ 的是 2322 字中文，MJ 直接返回四张杂志封面（满屏刊头和条形码）。
现由中文简报编译成 120 词以内的英文场景。gpt-image 仍用中文原文。

**4. 探索轮改用 MJ v7 Draft Mode**：同源画风、约 10 倍速度、半价（¥0.68 → ¥0.34）。

---

## 三、还没做完的两件，都卡在外部

### 1. 极速备用通道标价错误

按钮显示 `¥1.49`，但它实际调用 `generateDraftImage` → `flux-schnell`。
那个价格来自 `estimateStoryboardMaskedEditCost()`，是按 **gpt-image-1.5 的 token 数**
（输入 10917 × 8 PTC + 输出 4160 × 32 PTC）算出来的，
对按张计费的 flux 模型完全不适用。

**没修的原因**：这个数字参与付费确认（`costConfirmation.estimatedCny` 与服务端估价比对），
必须是数字且两端一致。代码里没有 flux-schnell 的价格来源，
**不应该用另一个编造的数字替换一个错误的数字**。

需要用户从 302 控制台的用量明细里给出 `flux-schnell` 的实际单次扣费，
然后在 `shared/imageRenderCost.ts` 里给它单独的估价函数。
已记入功能账本 `publishing-workspace` 的 `knownGaps`。

### 2. 切换故事时的闪帧

切换故事的瞬间会闪一下上一个故事的内容，随后自愈。**不影响数据**
（全量扫描过两次，跨故事错挂 0）。

根因：`StoryAgentContext` 的 `publishing: PublishingDraftState` **不带 storyId**。
`activeStoryId` 通过 `useStorySpine` 立即更新，而 `publishing` 要等新故事加载完才替换，
中间几帧工作台拿着上一个故事的数据渲染。因为这个对象没有身份，
**消费方连判断"这份数据属于谁"都做不到**，写不出防护。

封面候选那条路不受影响（切换时主动清空 + 渲染时比对 storyId，双保险）。

**没修的原因**：要改 `client/src/features/storyAgent/StoryAgentContext.tsx`，
那是另一个 agent 正在动的文件。修法是给 `publishing` 加归属故事标识
（存成 `{ storyId, state }`），让消费方能判断。

---

## 四、环境雷区

1. **共享 checkout + `tsx watch`**：保存任何 `server/` 或 `shared/` 下的文件都会重启 :3000，
   **正在等待结果的付费出图请求当场断掉**。今天因此打断三笔任务。
   保存前先确认没有任务在跑：

   ```bash
   python3 -c "
   import json
   d=json.load(open('.webdev/local-persist.json'))
   busy=[s['id'] for s in d['stories']
         if (((s.get('body') or {}).get('publishing') or {}).get('coverGeneration') or {}).get('status')=='pending']
   print('正在出图:', busy or '无，可安全保存')"
   ```

2. **只有主 checkout 能跑 :3000**（AGENTS.md 第 1、2 条）。
   worktree 只用于改代码，禁止在里面起服务 —— 每个 worktree 的服务读写自己的 `.webdev/`，
   并行会把数据分裂成互不相通的副本。

3. **不要手改 `.webdev/local-persist.json`**：数据活在服务器进程内存里、整体重写落盘，
   旁路修改会被下一次写入覆盖（`server/db.ts` 里记着 2026-06-01 的数据事故）。
   要改数据走正式 router/service，或先停服务再改再启动。

4. **launchd `com.yuandai.drinking-time-local.preview` 已卸载**（权限崩溃循环 exit 126，
   日志涨到 181MB）。plist 仍在 `~/Library/LaunchAgents/`，**不要重新加载**。

5. **绝不 reset / revert / checkout / stash**：工作区有多方未提交改动，其中有花钱换来的成果。

---

## 五、怎么验证

```bash
pnpm check:images        # 先绿再花钱
pnpm vitest run server/services/imageGen.test.ts server/services/renderGate.test.ts \
  server/routers.publishingDraft.test.ts shared/publishingDraft.test.ts \
  client/src/features/publishingDraft/ --maxWorkers=1
pnpm exec tsc --noEmit
pnpm feature:validate
pnpm env:status
```

交接时状态：测试全绿、tsc 干净、账本 19 张卡有效、`git diff --check` 干净。

**真实页面验证**：故事 1178（4 轮候选）、故事 20（3 轮）、故事 1176（11 轮）都有数据。
正式封面全部为 `null` —— 候选从不自动成为封面，这是账本里的不变量。

---

## 六、下一步建议的顺序

1. 用户修代理 → `pnpm check:images` 变绿
2. 在故事 1176 点「**不满意，换 4 张 · ¥0.34**」（不要点"按意见修改这张"，
   当前参考图本身带着伪汉字和男性人物，会往下一轮继续灌）
3. 看两件事是否落实：**画面无文字** + **人物是女性**
   —— 这是今天提示词修复的第一次真实验证

如果通畅网络下仍然频繁出问题，说明是架构在诱导 bug，值得重构；
如果基本顺了，今天这些修复就够了。

### 关于重构的判断

值得动的是**供应商结果的表达方式**：

- 三态而非两态：成功 / 明确失败 / **结果未知（钱可能已花）**。
  现在 `unknown` 是靠正则从错误信息里猜的（`RECOVERABLE_COVER_GENERATION_ERROR`）
- 付费凭据是一等公民：拿到 taskId 必须落库并向上传递，任何丢弃都要显式写出来
- "没检查"和"检查通过"必须是两个值，不能都用空数组

改完之后，上表里那五个 bug 在类型层面就写不出来。
但**不建议在网络修好之前动**，也不建议在两个 agent 共用一棵树时动
（会横跨 `imageGen` / `publishingDraft` / `shared`，改动期间对方无法工作）。

---

## 七、约定

- 功能账本 `docs/features/feature-ledger.json`：**只往自己那张卡的 `history` 追加**，
  不要整体重写，改完跑 `pnpm feature:validate`
- 涉及封面链路的文件（`imageGen.ts`、`publishingDraft.ts`、`renderGate.ts`、
  `shared/publishingDraft.ts`、`shared/imageRenderCost.ts`、
  `client/src/features/publishingDraft/`）的改动历史见上述三个提交
- 诊断任何环境问题，第一步 `pnpm env:status`
