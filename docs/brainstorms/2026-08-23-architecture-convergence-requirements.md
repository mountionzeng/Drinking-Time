---
date: 2026-08-23
topic: architecture-convergence
status: 用户已确认（2026-08-23）；进入 ce-plan 前无产品代码改动
source_handoff: docs/handoff/2026-08-23-architecture-convergence-agent-handoff.md
measured_at: 2026-08-23 主仓 codex/story-visual-assets（复测于 HEAD 6aed6d2；首测 283b9f1 期间另一会话合入了 8d19b94/f0ce930/1f89f5b 三次死代码清理，下表为复测值）
---

# 渐进式架构收敛 · 需求对齐

## Summary

让「改一个功能」重新变成一条清晰链路：一个持久事实只有一个权威写入口，其余界面只读同一投影。本轮不重写框架、不动数据库选型、不停掉在建的剪辑／视觉资产／图生图能力；只做两件事——**先立只阻止新增债务的护栏，再选一条已经有硬证据的写入口冲突做纵向收敛，并删掉被它替代的旧路径**。

判定成功的标准不是「文件变小」，而是：下一次真实改动触达的文件更少、保存刷新可证明、旧路径已经不存在。

---

## Problem Frame

用户的真实感受是「最近改一个功能要同时动前端 Context、页面、router、service、db helper、共享类型和功能账本」，以及「生成了太多没必要的代码」。

2026-08-23 复测确认这不是错觉，但也**不是**「文件太大」这一个原因。真正让改动昂贵的是同一事实存在两个写入者：

- `docs/features/feature-ledger.json` 的 `extracted-frame-overlay-video` 第 9 条不变量已经写死：「只有一个多轨编辑模型和一个写入口……不得再上传整份 items 或由客户端持有 expectedVersion」。
- 但生产代码里 `server/routers/creationAgent.ts:1534` 的 `updateStoryTimeline` 仍然接收客户端上传的完整 `items[]`（含 `timelineStartFrame`、`visualLayer`、`stackOrder`）和 `expectedVersion`。
- 客户端 `CreationEditorContext.tsx:1831` 的 `saveTimelineItems` 会用 `buildTimelineLayout(items)` **把每一项的 `timelineStartFrame` 重算一遍**再整份写回；这个函数在同一文件里有 11 个真实调用点。
- 同一时间，新落地的 `moveVisualClip` / `insertVisualImageClip` / `removeVisualClip`（`server/services/visualClipEditing.ts`）也在写同一批坐标。

也就是说：**账本已经宣布收敛完成的那条约束，代码里还没有真正兑现**。2026-08-22 交接里「测试全绿但用户拖动不生效／刷新回弹」的现象，与这个双写模型是同一个根因族。

第二类成本来自边界过宽：`server/db.ts` 6,563 行、109 个导出，53 个文件直接导入（49 个生产文件 + 4 个脚本），任何数据形状变化都可能穿过多个领域。

---

## 债务基线（2026-08-23 实测，作为后续对比的唯一口径）

| 指标 | 当前值 | 测量方式 |
| --- | --- | --- |
| `server/db.ts` 行数 / 导出数 | 6,563 / 109 | `wc -l`；`grep -cE "^export "` |
| 直接 import `../db` 的文件 | 53（生产 49 + 脚本 4） | `grep -rE 'from "\.\./db"'`，排除 `*.test.*` |
| 前端热点行数 | StoryboardReviewBoard 5,612；StoryAgentContext 4,528；EditingNleWorkspace 4,425；CreationEditorContext 4,329；StoryboardEditRow 3,992；PublishingDraftWorkspace 3,305 | `wc -l` |
| 服务端热点行数 | routers/storyAgent 3,122；routers/publishingDraft 2,542；routers/creationAgent 2,277；services/imageGen 2,143 | `wc -l` |
| 整份 timeline 写入口 | 客户端 1 条（`saveTimelineItems`，11 个调用点）；服务端 4 处（`timelineEditAgent` ×4、`videoTimeline` ×1、`chatCutXml` ×2、`editingTransitionWorkflow` 的 overlay 原子写 ×1） | `grep updateStoryTimeline\|applyStoryTimelineOverlayAtomic` |
| knip 静态未用 | 未用导出 198、未用导出类型 200、重复导出 5、**未用文件 0** | `pnpm monitor` |
| 静态健康快照（2026-08-21） | 源文件 393、函数 8,132、高风险函数 763、疑似未用局部函数 1,140、**runtime coverage 0** | `.code-health/weekly.md` |
| 近 30 天集成吞吐 | 178 个非 merge 提交、1,973 次文件触达、+157,101 / −39,479 行（约 11 文件/提交） | `git log --since="30 days ago"` |
| 现有静态守卫 | `client/src/architecture-boundaries.test.ts`，10 条 | 文件内 `it(...)` 计数 |
| 当前门禁状态 | `pnpm check` 通过；`pnpm feature:validate` 通过（29 张卡） | 本轮实跑 |

三类代表性改动的触达文件数沿用 `docs/qa/refactor-coupling-baseline-2026-08-14.md`：A 故事文本 6 / B 生成状态 12 / C 资产类型 10。该文档 2026-08-15 的复核结论同样生效：**七条「重复」里只有一条成立**，B 类失败态、D1 scope 判定、C 类转正调用点都**不得**合并。

### 基线复测中发现、与交接文档不一致的四件事

1. **`server/archive/` 不是归档，是生产代码。** `server/archive/storyAgent.ts`、`visionAgent.ts` 等被 `routers/_storyShared.ts`、`routers/storyAgent.ts`、`routers/creationAgent.ts`、`services/artAgent.ts`、`services/creationAgent.ts` 和 `scripts/analyze-art-references.ts` 直接导入。目录名是假的，会让后来者误判可删。
2. **`client/src/features/analysis/` 也不是废墟。** `/analysis` 路由确实只剩重定向到 `/editing`，但该目录 15 个生产文件、5,548 行仍被 `EditingStudioPage`、`CreationPage`、`TopBar`、`WelcomePreviewPage` 和 `storyAgent/spine` 引用（含 `useProjectData` 的 `activeStoryId`）。这是命名漂移，不是死代码。
3. **knip 的 398 条「未用导出／类型」不能当删除清单。** 其中大量是 `client/src/components/ui/*` 的 shadcn 原语（card/select/dialog 各 4–5 条），属于第三方模板的完整 API，删了只会在下次用到时再抄回来。
4. **仓库没有 runtime coverage**，所以「40 天没用」无法度量，只能度量「40 天没改」。删除门槛必须靠静态不可达 + 账本 + 调用图，见下文 R20–R24。

---

## Actors

- **用户（岱岱）**：唯一决策人。批准范围、批准删除、在主仓 3000 做真实验收。
- **架构收敛 Agent（本任务）**：只做护栏与纵向收敛，不接管在建功能。
- **在建功能会话**：视觉资产参考图公网托管（未提交，9 改 3 增）、剪辑栏与镜头操作、图生图对话框。三者的文件是本任务的禁区。
- **静态守卫（`architecture-boundaries.test.ts`）**：把结论变成会失败的测试，替代注释和口头约定。

---

## Requirements

**R0 — 前置保护**

- R0.1 不得编辑、stash、reset 或覆盖当前未提交的视觉资产工作（`server/_core/env.ts`、`server/routers/storyAgent.ts`、`server/services/imageGen.ts`、`visualAssetCreation*`、`visualAssetGenerationContext*`、`visualAssetPersistence*`、`publicReferenceHost*`、`scripts/check-oss-public-refs.ts`）。这批文件最后改动时间为 2026-08-22 20:17，早于本轮但仍未提交。
- R0.2 `server/routers/storyAgent.ts` 同时是本任务的观察对象和上述禁区文件。本轮**只读不写**；需要改它时先请用户裁决。
- R0.3 不在任何 worktree 启动 dev/preview server，不写 worktree 的 `.webdev`；真实验收只在主仓 3000。
- R0.4 `:3000` 是 `tsx watch` 共享进程，改 `server/**` 会重启并打断在飞的付费出图。动服务端文件前先确认没有正在进行的生成。

**R1–R6 — 架构棘轮（只阻止新增债务）**

- R1. 新增静态守卫必须先冻结当前基线（如「直接 import `../db` 的生产文件 ≤ 49」），不得因历史债务让全库立刻变红。
- R2. 禁止新增生产文件直接 import `server/db.ts`；例外必须在守卫的豁免表里写明 owner、原因、到期条件，且豁免表只减不增。
- R3. 禁止新增能覆盖整份 Story／timeline 的客户端 writer；禁止新的 tRPC procedure 接收客户端计算出的位置数组。
- R4. 禁止新增第二套视觉赢家比较器、稳定镜头定位器或付费状态解释器；这三类语义分别只能有一个权威实现。
- R5. 禁止新 provider 旁路统一图片／视频网关。
- R6. 对基线表里列出的热点文件设「不再增长」上限；把行搬到无语义的 helper 不算改善，守卫按文件总行数计。

**R7–R13 — 首个纵向试点：关闭整份 timeline 写入口**

- R7. 试点范围固定为「clip 的绝对位置（`timelineStartFrame`）与所属视觉层（`visualLayer`）」这一个事实，不扩到 transform、文字层、时长、锚点或付费状态。
- R8. `saveTimelineItems` 的 11 个调用点必须逐个分类：真正改位置的迁移到 `moveVisualClip`／`insertVisualImageClip`／`removeVisualClip`；不改位置的（如 `updateTimelineImageTransform`）迁移到窄命令，不得继续借道整份写入。
- R9. 迁移完成后，`creationAgent.updateStoryTimeline` 的 input 必须不再接受由客户端计算的 `timelineStartFrame`；客户端不再持有 `expectedVersion`。做不到时必须停下来向用户说明，而不是留「以后再说」的双写。
- R10. 服务端四处整份写入（`timelineEditAgent`、`videoTimeline`、`chatCutXml`、`editingTransitionWorkflow`）本轮**只盘点并登记**，不在试点内迁移；但必须证明它们不会与 `moveVisualClip` 竞争同一 clip 的坐标。
- R11. 一次用户操作只递增一次 timeline version；重复 operation id 不产生第二次位移。
- R12. 试点必须先有领域行为测试再切调用方，最后删除旧实现；不允许新旧并存跨越本轮。
- R13. 试点完成的判据是主仓 3000 的真实链路：拖动 → 保存 → 刷新 → 位置不回弹；单测全绿不构成验收。

**R14–R19 — Context 责任拆分（试点证明有效后才做）**

- R14. `CreationEditorContext` 对现有消费者的公共 API 保持不变，只在内部按「服务端 query／命令 client／视图模型／页面临时状态」分层。
- R15. 每次只迁移一项责任，且当次必须删除被替代的旧实现。
- R16. 不引入新的全局状态库、通用 Repository、Facade 或 Operation 基类。
- R17. 不同时拆三个 Context；`StoryAgentContext` 与 `StoryboardReviewBoard` 本轮只冻结增长，不动结构。
- R18. 按领域收口持久化时，优先已有明确事务／CAS 边界的领域（visual clip editing、visual assets、paid receipt、image adoption）；只有迁移完成并删除 direct import 后，才考虑物理移动 `server/db.ts` 中的实现。
- R19. 为最易丢字段的链路声明投影合同并加漂移测试（timeline 持久化 → 服务端 DTO → 客户端 clip；provider 结果／错误 → 付费回执 → UI 恢复）。测试只断言必保字段与语义，不做整对象快照。

**R20–R24 — 删除标准（五条必须同时成立）**

- R20. 静态不可达：`knip` 未引用，且导入图、路由入口、动态 import、脚本入口、测试夹具、provider 回调均无引用。
- R21. 不在任何 `working` / `observing` 功能卡的 `owners` 或 `evidence` 链路中。
- R22. 近 40 天的提交、会话记录和功能账本没有仍在执行的用途；**「40 天没改」不等于「40 天没用」**，仓库无 runtime coverage，此条只能作辅助证据，不能单独成立。
- R23. 删除后定向测试、`pnpm check`、`pnpm feature:validate` 与真实入口验证全部通过。
- R24. 属于已登记能力的代码即使当前不可达，也必须先按账本规则向用户说明影响并获批。删除后不建生产 `archive/`，Git 历史即恢复渠道。
- R24.1 `client/src/components/ui/**` 的第三方 UI 原语不适用 R20–R23，整体豁免，不做逐条删除。

**R25–R26 — 命名真相（低风险、高收益，本轮登记）**

- R25. `server/archive/` 目录名与事实不符，必须要么改名为反映真实职责的名字，要么在目录内加显式说明。改名属于纯重命名，不改行为，但会触达 6 个导入方——需用户批准后单独一次提交。
- R26. `client/src/features/analysis/` 同理：`/analysis` 已只剩重定向，目录却仍在服务 `/editing` 与 `/welcome`。本轮只登记，不动。

---

## Acceptance Examples

1. **新增一个直接 import `../db` 的生产文件** → 守卫测试失败，报错指出应走哪个领域 persistence，或要求登记豁免（owner + 原因 + 到期）。
2. **新增一个接收 `items: [{ timelineStartFrame }]` 的 tRPC procedure** → 守卫测试失败。
3. **在主仓 3000 把一张图片向右拖 20 帧再换到上一层** → 只发出一次命令，只有该 clip 的 track/start 变化，timeline version +1，刷新后仍在新位置。
4. **移动底层视频** → 上层所有 clip 的 id 与绝对帧前后完全一致（前后快照对比留证）。
5. **同一 operation id 重试** → 不产生第二次位移，不产生副本。
6. **试点结束后 grep `saveTimelineItems`** → 生产代码中不再存在整份 items 写回路径。
7. **删除一个候选死代码** → 五条证据（R20–R24）逐条附在提交说明里，缺一条则不删。

---

## Success Criteria

**架构指标（对照上文基线表）**

- 直接 import `server/db.ts` 的生产文件数 ≤ 49，且首个持久化切片完成后实际下降。
- `server/db.ts` 导出数 ≤ 109 且不再增长。
- 同一持久事实不存在两个生产 writer；`extracted-frame-overlay-video` 第 9 条不变量在代码里真正成立。
- 六个热点文件行数不超过基线值。
- 代表性改动的触达文件数按 `refactor-coupling-baseline-2026-08-14.md` 同一口径复测并记录前后对比；没下降就如实写没下降。
- 新增生产代码与删除旧代码成对解释，不允许只加架构层。

**行为指标**

- Story 归属、稳定镜头身份、视觉层、候选／采用、付费回执与 CAS 行为全部不变。
- 视觉剪辑的移动／插入／删除刷新后保持，预览与导出一致。
- 固定验收 Story（1186 或用户指定）走通：读取 → 编辑 → 保存 → 刷新。付费链路本轮不触发真实扣费。

**工程验证**

每个实施单元至少运行 `pnpm env:status`、`pnpm check`、`pnpm feature:validate`，加受影响领域的定向测试与守卫测试，再加主仓 3000 的真实页面验证。全量测试若存在与本单元无关的既有失败，必须列出失败文件与证据，不得静默忽略，也不得为了变绿改无关代码。

---

## Scope Boundaries

**范围内**：架构棘轮守卫；timeline 位置写入口的纵向收敛；被它替代的旧 writer 删除；投影合同与漂移测试；债务基线与复测；死代码删除标准的建立与首批执行。

**范围外**：

- 不替换 React / tRPC / Drizzle / 本地持久化。
- 不做微服务拆分或事件溯源。
- 不建通用 Repository / Facade / Operation 框架。
- 不按行数机械拆文件，不为指标造转发层。
- 不合并 B 类失败态、D1 scope 判定、C 类转正调用点（2026-08-15 复核已证明合并有害）。
- 不同时改变用户行为、存储格式和页面设计。
- 不动在建的视觉资产 UI 补齐、图生图对话框、剪辑栏交互细节这三条功能线。
- 不做 `server/db.ts` 的物理拆分。
- 不迁移、不合并、不删除用户数据、媒体、Story、Take 或 `.webdev`。
- 不执行真实付费生成。

---

## Key Decisions

1. **首个试点选「timeline 位置写入口」而不是别的**：因为它是唯一同时具备（a）账本已声明的不变量、（b）代码里可复现的双写证据、（c）单一文件内 11 个调用点的有限爆炸半径、（d）用户可亲手验收的表现 的候选。
2. **先冻结基线再收敛**：守卫上线时不修历史债务，只让新改动不恶化。
3. **删除以静态证据为准，不以时间为准**：仓库无 runtime coverage，「40 天」只能是辅助信号。
4. **命名问题登记但不顺手改**：`server/archive/` 改名会触达 6 个导入方，属于独立提交，需单独批准。
5. **重复判断以 2026-08-15 复核为准**：不复活已被推翻的五条「重复」。

---

## Dependencies / Assumptions

- 视觉资产那批未提交工作已于 2026-08-23 由本会话代为提交（`8e85541`），工作区已清空。
- **本会话不是唯一在动这块代码的人**：另一会话（worktree `claude/multitrack-editor-reset`）在 2026-08-23 17:43 与 17:47 向主仓合入了 `8d19b94` / `f0ce930` / `1f89f5b` 三次「多轨剪辑重构死代码清理」，触达 `server/services/visualClipEditing.ts`、`shared/visualClipModel.ts`、`server/routers/creationAgent.ts` 与三个前端编辑文件——正是本试点的相邻区域。开工前必须重新确认它是否仍在运行，并与用户确认由谁负责这一片。
- 依赖 `client/src/architecture-boundaries.test.ts` 作为守卫落点，不新建平行的守卫机制。
- 依赖 `docs/qa/refactor-coupling-baseline-2026-08-14.md` 的口径做前后对比。

---

## 用户裁决（2026-08-23，已确认）

1. **试点确认** → 同意。第一刀就是关闭整份 timeline 写入口，位置只走 `moveVisualClip` 家族。
2. **R9 的硬度** → 选 A（严格）。`undoTimeline` 的整份回滚与 `manageTimelineVisualLayer` 的整层重编号也必须表达成服务端领域命令（如「撤销到版本 N」「把第 N 层移到第 M 层」），由服务端自己读取并计算位置；不保留受限的整份写入口。
3. **`server/archive/` 改名** → 先记着，排到收敛之后再做。本轮只登记（R25 保持，执行时机后移）。
4. **视觉资产未提交工作** → 已由本会话代为提交（`8e85541`），并补齐三份未落库交接文档（`6aed6d2`）。工作区现已干净。
5. **第一批删除目标** → 先拆墙。不单独清 knip 未用导出；等试点完成后，连同被替代的旧 writer 一起删，删除理由由试点本身提供。

## 仍待确认

- 用户表示对「当前两个编辑表面／两条写入路径」都不满意，倾向于**合并起来一起修**，但也认为这个工程可能过大，要求本会话自行判断范围。合并对象的具体所指需在进入 ce-plan 前确认（见会话记录）。
- 与 `claude/multitrack-editor-reset` 会话的分工归属（见 Dependencies / Assumptions）。
