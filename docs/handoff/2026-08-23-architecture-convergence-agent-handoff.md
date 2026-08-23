---
date: 2026-08-23
topic: architecture-convergence
status: ready-for-agent-handoff
branch_observed: codex/story-visual-assets
scope: requirements, planning, incremental refactor, verification, dead-code convergence
---

# 交接：渐进式架构收敛，让功能重新容易修改

## 一句话任务

在不重写框架、数据库和现有产品能力的前提下，逐步收敛写入入口、状态所有权、前后端投影和开发集成流程，降低新增/修改功能的联动范围；每次只迁移一个已经被证据证明的责任，并同步删除被替代的旧入口和无用代码。

这不是“大文件拆分项目”，也不是一次性重构。目标是让下一项真实功能更容易完成、更少返工，并且可以用测试和改动触达面证明改善。

## 1. 用户意图与已确认方向

用户的核心感受：

- 最近新增或修改一个功能越来越难，经常需要同时改前端 Context、页面、router、service、数据库 helper、共享类型和功能账本。
- 最近生成了太多没有必要的代码；确定无用、不可达且 40 天内没有实际依赖证据的代码应删除，不保留“也许以后有用”的生产归档。
- 用户希望由 Agent 主导把架构整理好，但不希望停掉正在完成的剪辑、视觉资产和图生图能力。

已经确认的策略：

1. 新建当前架构收敛方案，不续写 2026-05-09 的旧前端架构需求；旧文档涉及已经删除的 `/analysis` 和过时数据流，只作历史材料。
2. 先让三个在建方向形成稳定检查点，再统一调整：
   - 剪辑栏与镜头操作细节；
   - 人物／场景／美术仓库；
   - 图生图对话框流程。
3. 不做大爆炸重写。先加只阻止新增债务的架构护栏，再选一条真实工作流做纵向收敛。
4. 不更换 React、tRPC、Drizzle 或当前本地持久化方案；不引入微服务、全局事件溯源或新客户端状态库。

## 2. 接手前必须先读

按顺序阅读：

1. `AGENTS.md`
2. `docs/features/README.md`
3. `docs/features/feature-ledger.json`
4. `docs/qa/refactor-coupling-baseline-2026-08-14.md`
5. `docs/handoff/2026-08-22-simple-multitrack-editor-architecture-reset.md`
6. `docs/handoff/2026-08-22-visual-asset-ui-completion-handoff.md`
7. `docs/handoff/2026-08-22-visual-asset-chat-edit-handoff.md`
8. `docs/solutions/2026-06-13-多worktree环境数据分裂收敛.md`
9. `docs/solutions/2026-06-13-故事为唯一单位-镜头按storyId.md`

谨慎使用这些旧文档：

- `docs/brainstorms/frontend-architecture-refactor-requirements.md` 是 2026-05-09 的历史方案，不能直接恢复执行。
- `docs/brainstorms/architecture-map.md` 最后更新于 2026-06-10，路由、页面和数据流已有明显漂移。
- `docs/story-workspace-data-contract.md` 仍允许跨 Story 复用 Take，与当前 `story-ownership` 功能卡冲突。冲突时以功能账本和当前权威代码为准。

## 3. 2026-08-23 接手时的真实状态

### 环境

`pnpm env:status` 显示：

- 只有主仓库端口 3000 在运行，当前环境健康。
- 总计 12 个 worktree；其余 worktree 没有服务和业务数据，但数量仍会增加集成成本。
- 当前主分支名为 `codex/story-visual-assets`，不是 `main`。

只能在主仓库运行 dev server。任何 worktree 都禁止启动 dev/preview server，也禁止写自己的 `.webdev/` 业务数据。

### 当前未提交工作——不要覆盖、stash、reset 或顺手修改

观察到的已修改文件：

- `server/_core/env.ts`
- `server/routers/storyAgent.ts`
- `server/services/imageGen.ts`
- `server/services/visualAssetCreation.ts`
- `server/services/visualAssetCreation.test.ts`
- `server/services/visualAssetGenerationContext.ts`
- `server/services/visualAssetGenerationContext.test.ts`
- `server/services/visualAssetPersistence.ts`
- `server/services/visualAssetPersistence.test.ts`

观察到的未跟踪文件：

- `docs/handoff/2026-08-22-simple-multitrack-editor-architecture-reset.md`
- `docs/handoff/2026-08-22-visual-asset-ui-completion-handoff.md`
- `scripts/check-oss-public-refs.ts`
- `server/services/publicReferenceHost.ts`
- `server/services/publicReferenceHost.test.ts`

这批修改正在解决视觉资产参考图公网托管、资产一致性检查和持久化可靠性。架构任务在原任务形成明确 commit 或用户确认接管前，不得编辑这些文件。

### 刚完成的剪辑模型收敛

最近提交已经合入：

- 单一多轨视觉剪辑模型；
- 唯一移动命令 `moveVisualClip`；
- 图片插入命令 `insertVisualImageClip`；
- 删除命令 `removeVisualClip`；
- 服务端 Story 级命令服务与路由入口。

当前权威实现主要位于：

- `shared/visualClipModel.ts`
- `server/services/visualClipEditing.ts`
- `server/routers/creationAgent.ts`
- `client/src/features/creationEditor/CreationEditorContext.tsx`
- `client/src/features/creationEditor/views/EditingNleWorkspace.tsx`

不要再次设计另一套 timeline kernel。第一批架构工作应审计是否仍有旁路 writer，并把这套已落地命令当作候选模式进行验证和加固。

## 4. 为什么越来越难改：当前证据

| 问题 | 当前证据 | 造成的成本 |
| --- | --- | --- |
| 数据访问边界过宽 | `server/db.ts` 约 6,563 行、109 个导出；约 49 个生产 TypeScript 文件直接导入 db | 任一数据变化容易穿过多个领域，难以判断真正 writer |
| 前端状态中心过大 | `StoryboardReviewBoard.tsx` 约 5,612 行；`StoryAgentContext.tsx` 约 4,528 行；`CreationEditorContext.tsx` 约 4,329 行 | 查询、命令、临时 UI 状态和持久化混在一起，局部功能被迫理解整个页面 |
| 编辑界面仍有热点 | `StoryboardEditRow.tsx` 约 3,992 行；`EditingNleWorkspace.tsx` 约 4,425 行 | UI 表面、领域规则、拖拽和保存链路容易互相重复 |
| 同一事实曾有多个表征 | timeline item、image clip、legacy overlay、story shot、Take、React 局部状态曾共同决定位置和采用状态 | 写入成功但读取投影丢字段，或两个 UI 对同一能力判断不同 |
| 集成吞吐高且检查点少 | 最近 30 天约 178 个非 merge commit，165,055 行新增、39,477 行删除，平均每提交触达约 11 个文件 | 并行任务容易在共享热点重复实现、重启和返工 |
| 运行时反馈不足 | `.code-health/weekly.md` 的 runtime coverage 为 0；此前单测全绿但主仓 3000 拖拽仍未持久化 | 测试证明 helper，不一定证明用户路径 |

注意：`docs/qa/refactor-coupling-baseline-2026-08-14.md` 已证明，多项表面重复其实是不同语义。不能因为两个地方都有 `status === "failed"` 或相似 DTO 就强行合并。只有“同一业务事实、同一语义、多个独立 writer/解释器”才是收敛对象。

## 5. 已有功能与不可破坏约束

修改前必须重新查功能账本。当前最相关状态：

| 功能卡 | 状态 | 必须保留 |
| --- | --- | --- |
| `story-ownership` | working | Story 是唯一工作单位；服务端同时校验认证用户与 storyId |
| `stable-shot-identity` | working | 修改、删除、绑定必须使用稳定镜头身份，不能用数组位置或显示编号猜测 |
| `image-asset-history` | working | 候选、历史和正式采用是不同状态；生成成功不能自动转正 |
| `single-dev-environment` | working | 只有主仓库端口 3000 和主仓业务数据 |
| `extracted-frame-overlay-video` | working | 普通图片／视频剪辑、绝对帧、视觉层、预览／剪辑／导出统一赢家规则 |
| `storyboard-position-anchors` | observing | 30fps 整数帧、锚点、磁吸、空档、撤销和可见赢家不能被破坏 |
| `story-visual-assets` | observing | Story 隔离、不可变版本、固定事实、质检门禁、真实付费回执 |
| `chat-multi-image-remix` | observing | 最多四张统一 imageId 引用、统一图片网关、费用确认后提交、结果不自动采用 |

付费和生成相关代码必须继续满足：

- quote 不扣费，confirm 后才能 submit；
- provider task ID、operation token、submission certainty 和错误语义不能在 DTO 重建时丢失；
- 已受理但状态未知的任务不得自动重提；
- 生成、质检、采用是三个正交状态；
- 真实付费验证必须获得用户明确批准。

## 6. 目标架构原则

1. **一个事实一个权威 writer。** UI 只发送领域命令或局部 patch，不把完整客户端投影覆盖写回服务端。
2. **一个语义一个 resolver。** 预览、编辑、导出需要同一判断时，调用共享纯函数；不同业务问题即使字段相似也保持分离。
3. **Context 是兼容门面，不是永久业务内核。** 先保持公共 API，再把 query、view model、command 和临时交互状态分开。
4. **router 只做认证、输入校验和调用编排。** 领域转换、CAS、幂等和事务规则进入窄 service/persistence 边界。
5. **数据库访问按领域收口。** 先禁止新增 direct-db seam，再从已被两个以上调用方验证的领域原语开始迁移；不要一次物理拆掉 `server/db.ts`。
6. **读取投影需要版本和漂移测试。** 持久化字段、服务端 DTO 和客户端 view model 的必保字段要显式声明。
7. **迁移一个责任就删除一个旧入口。** 不允许“新服务 + 旧 writer 永久并存”。兼容层必须有删除条件、负责人和期限。
8. **真实用户路径是最终证据。** 单元测试、类型检查和构建之外，必须在主仓 3000 做保存、刷新和恢复验证。

## 7. 推荐实施顺序

### Phase 0：先形成需求与基线，不改产品代码

1. 使用 `ce-brainstorm` 新建 `docs/brainstorms/2026-08-23-architecture-convergence-requirements.md`。
2. 需求文档至少定义：目标改动成本、范围外事项、债务基线、首个试点、删除标准和验收指标。
3. 用户确认需求后使用 `ce-plan` 写新的分阶段实施计划。
4. 不直接恢复 5 月或 8 月 14 日旧计划；可引用其中仍成立的证据。

### Phase 1：建立只阻止新增债务的架构棘轮

先 baseline 现有债务，新增静态守卫：

- 禁止新的生产文件直接导入 `server/db.ts`；例外需记录 owner、原因和到期条件。
- 禁止新 provider 旁路统一图片／视频网关。
- 禁止新增能覆盖整份 Story/timeline 的客户端 writer。
- 禁止新增第二套视觉赢家、稳定镜头定位或付费状态解释器。
- 对上述热点文件设置“不再增长”基线；仅靠搬行到无意义 helper 不算改善。

守卫不得一开始让全库因历史债务失败；先冻结基线，然后要求新改动不恶化。

### Phase 2：以已落地的视觉剪辑命令作为首个纵向试点

不要重建 kernel。审计并证明：

- 所有图片／视频移动都走 `moveVisualClip`；
- 所有抽帧图片落位都走 `insertVisualImageClip`；
- 所有普通视觉剪辑删除都走 `removeVisualClip`；
- 不再存在 overlay、整份 timeline 覆盖或 UI 局部状态能够旁路修改相同坐标；
- 一次命令只递增一次 revision，重复 operation 不产生第二次变化；
- 主仓 3000 完成“操作 → 保存 → 刷新 → 位置不回弹”。

若试点证明这套模式有效，把“scope + expected revision + operation identity + typed result”提炼成约定，不要先做全局万能基类。

### Phase 3：从 `CreationEditorContext` 开始拆责任

保持现有消费者 API，按职责逐步移出：

1. 服务端 query 与缓存刷新；
2. 视觉剪辑 command client；
3. 视觉资产 query／command；
4. 纯 view model 与派生状态；
5. 只属于页面交互的 ephemeral state。

每迁移一项：先写行为测试，再切调用方，再删除旧实现。不要一次拆完三个 Context，也不要引入新的全局 store。

### Phase 4：按领域收口持久化

优先选择已经有明确事务／CAS 边界的领域：

- visual clip editing；
- visual assets；
- paid generation receipt；
- image adoption/history。

让 router 和 service 依赖领域 persistence，而不是继续直接组装 `server/db.ts` 的十几个函数。只有迁移完成并删除 direct import 后，才考虑物理移动 `server/db.ts` 中对应实现。

### Phase 5：建立投影合同与漂移测试

为最容易丢字段的链路建立明确合同：

- timeline persistence → server DTO → client visual clip；
- provider result/error → paid receipt → UI confirmation/recovery；
- visual asset version → generation context → generated image lineage；
- hidden layer／visual priority → preview → export。

测试关注“字段必须保留、语义必须一致”，不要把完整内部对象快照成脆弱测试。

### Phase 6：删除旧入口和无用代码

用户要求清理 40 天内没有用上的代码，但仓库目前没有 runtime coverage，不能把“40 天没改”误写成“40 天没用”。删除必须同时有以下证据：

1. 静态不可达（例如 `knip`、导入图和路由入口均无引用）；
2. 不在 working/observing 功能卡的权威代码或验证链路中；
3. 不依赖动态导入、脚本入口、测试夹具或 provider 回调；
4. 最近 40 天的提交、会话和功能账本没有仍在执行的用途；
5. 删除后定向测试、`pnpm check` 和真实入口验证通过。

若代码属于已登记能力，即使当前不可达，也必须先按功能账本规则向用户说明影响并获得批准。删除后不建生产 `archive/`；Git 历史就是恢复渠道。

## 8. 明确不做

- 不做 React／tRPC／Drizzle／数据库替换。
- 不做微服务拆分或全局事件溯源迁移。
- 不建立新的“万能 Repository／Facade／Operation Framework”。
- 不按行数机械拆文件，不为了指标制造转发层。
- 不把所有 `status`、DTO 或相似 helper 强行合并。
- 不同时改变用户行为、存储格式和页面设计。
- 不在 worktree 运行服务，不复制或合并 `.webdev` 数据。
- 不自动执行真实付费任务，不删除用户素材、Story、Take 或本地数据。
- 不覆盖当前视觉资产未提交工作，也不回滚刚合入的多轨命令。

## 9. 成功标准

### 架构指标

- direct `server/db.ts` 生产导入数不高于接手基线，首个持久化切片完成后应实际下降。
- `server/db.ts` 导出数不再增长；领域切片完成后删除相应导出。
- `CreationEditorContext.tsx`、`StoryAgentContext.tsx`、`StoryboardReviewBoard.tsx` 不再新增跨领域责任。
- 同一持久事实不存在两个生产 writer；静态守卫能阻止旁路回归。
- 代表性功能改动的文件触达数、DTO 重建点和重复状态解释点相对基线下降，并记录前后对比。
- 新增生产代码与删除旧代码成对解释；不能只增加架构层。

### 行为指标

- Story 归属、稳定镜头、视觉层、候选／采用、付费回执和 CAS 行为保持不变。
- 视觉剪辑移动／插入／删除在刷新后仍保持，预览与导出一致。
- 固定验收 Story 覆盖：读取 → 编辑 → 保存 → 生成报价 → receipt/recovery → 刷新。
- 供应商测试默认使用确定性 fake；真实付费只在用户批准后执行。

### 工程验证

每个实施单元至少运行：

```bash
pnpm env:status
pnpm check
pnpm feature:validate
```

另外运行受影响领域的定向测试、边界守卫测试和主仓 3000 的真实页面验证。全量测试若存在与本单元无关的既有失败，必须列出失败文件和证据，不能静默忽略或为了变绿修改无关代码。

## 10. 停止并向用户确认的情况

出现以下任一情况，不要继续修改：

- 当前未提交视觉资产工作仍在变化，且准备触碰同一文件；
- 发现另一会话正在做跨分支合并或架构收敛；
- 计划会覆盖、削弱、替换或删除 working/observing 功能卡；
- 需要迁移／删除用户数据、媒体或付费记录；
- 需要真实调用收费供应商；
- 需要把 worktree 业务数据并回主仓；
- 必须引入新框架、数据库或全局状态库才能继续；
- 测试通过但主仓 3000 的真实路径仍失败。

## 11. 新 Agent 的第一轮动作

第一轮只做以下事情：

1. 执行 `pnpm env:status` 和 `git status --short --branch`。
2. 确认当前视觉资产任务是否已经提交，确认没有其他收敛负责人。
3. 阅读本交接列出的功能卡、专项交接和耦合基线。
4. 重新测量热点、direct-db 导入和现有架构守卫，不把本文数字当永久事实。
5. 向用户汇报：现有功能状态、保护边界、当前脏文件、建议的第一个实施切片。
6. 先完成新的架构收敛需求文档并请用户确认；未经确认不改产品代码。

## 12. 期望交付物

最终不是一份“架构建议”，而是一组可验证的小交付：

1. 当前架构收敛需求文档；
2. 分阶段实施计划；
3. 架构债务 baseline 与防新增守卫；
4. 一个完整的纵向收敛试点；
5. 被试点替代的旧 writer／adapter／状态代码删除；
6. 功能账本 history、测试证据和主仓 3000 验收记录；
7. 下一切片建议，以及仍未触碰的债务清单。

完成的判断不是“文件变小了”，而是：下一项真实功能只需要经过一条清晰命令链路，改动范围更小，保存和恢复可证明，并且旧路径已经消失。
