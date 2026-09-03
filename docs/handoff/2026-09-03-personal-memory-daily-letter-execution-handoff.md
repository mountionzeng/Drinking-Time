---
date: 2026-09-03
topic: personal-memory-daily-letter-execution
status: reviewed-worktree-ready-for-agent-handoff
branch_observed: codex/personal-memory-daily-letter
worktree_observed: .worktrees/codex/personal-memory-daily-letter
base_commit_observed: b23b474
authoritative_plan: docs/plans/2026-09-02-003-feat-personal-memory-daily-letter-plan.md
---

# 交接：执行个人记忆、每日来信与头像足迹互通

## 一句话任务

继承现有 `codex/personal-memory-daily-letter` worktree，不要另建 worktree，也不要重新讨论产品定位。先把本交接记录的复审问题合并回权威计划，再按计划分阶段实现：把用户已提交的原话和明确采用的文章／图片沉淀为可追溯经历，形成可纠正、可归档、可恢复和可忘记的派生理解，让每日来信安全地结合这些理解、用户八字与当天黄历，并在桌面头像和手机 Web 中提供同一份私密足迹。

当前只完成需求、计划、复审和 worktree 初始化，**没有开始实现功能代码、schema 或迁移**。worktree 中只有计划文档的一处未提交环境基线修正，以及本交接文档与功能账本登记。

---

## 一、用户已经确认且不得翻案的产品规则

1. 普通聊天、每日回信、明确采用的文章和明确采用的图片互通，成为账号级私密个人经历。
2. 用户亲自敲下并成功提交的文字，以及用户明确采用的作品，属于长期经历；未提交草稿、失败请求、生成候选、被动浏览和沉默不进入长期记忆。
3. 八字是用户可修改的长期资料；黄历是按目标中国日期随时获取的实时资料。二者不混进个人经历，也不重算过去来信。
4. 系统可以学习和更新的是带证据的派生理解。新旧表达冲突时保留变化轨迹，用户明确纠正优先于模型推断。
5. 归档可恢复；忘记会清除派生理解并阻止旧证据重新生成同一理解，但不删除底层聊天、Story、文章或图片。
6. 用户已经确认：忘记只影响未来召回，**不改写用户已经读过的历史来信**。不要把审查意见擅自扩张成重写旧信。
7. 同一天的新聊天默认只影响未来来信；用户显式点击“再读一遍”才产生同日新版本，旧版本保持只读。
8. 每日来信只能选择少量、仍有效、允许主动提及且与当天相关的理解；禁止把全部聊天或全部记忆直接交给模型。
9. 头像弹层只放最近摘要和“查看全部”，完整时间线进入独立页面；桌面 Web 与手机 Web 使用同一服务端口径。
10. 微信原生小程序目前只是 mock 测试壳，本阶段不读取、不展示真实个人记忆，也不算跨端验收证据。

---

## 二、当前 worktree 快照

交接撰写时观察到：

- 主仓：`/Users/yuandai/Documents/New project/drinking-time-local`
- worktree：`/Users/yuandai/Documents/New project/drinking-time-local/.worktrees/codex/personal-memory-daily-letter`
- 分支：`codex/personal-memory-daily-letter`
- 基线提交：`b23b474`（PR #8 合并后的最新 `main`）
- 分支跟踪：`origin/main`
- `.env`、`.env.server` 和 `node_modules` 已准备好。
- worktree 中没有 `.webdev` 业务数据文件，没有启动 dev／preview server。
- 主仓交接时干净，也没有 3000 端口开发服务。

worktree 中预期存在的未提交修改：

- Modified: `docs/plans/2026-09-02-003-feat-personal-memory-daily-letter-plan.md`
  - 只把已过期的“等待账号迁移热区释放”改为当前事实：账号／算力基础与 `0016_account_gift_credit` 已进入 `main`；真实 MySQL 切换仍是部署门槛。
- Added: `docs/handoff/2026-09-03-personal-memory-daily-letter-execution-handoff.md`
- Modified: `docs/features/feature-ledger.json`
  - 只补本交接证据、账号／算力依赖和 handoff 历史；状态仍为 `planned`。

这些快照不是永久事实。接手 Agent 必须重新检查，不能只相信本节。

---

## 三、接手后必须按顺序阅读

1. `AGENTS.md`：环境、数据和功能账本铁律。
2. 主仓最新的 `docs/handoff/SESSION-BOARD.md`：查看实时文件所有权；worktree 内副本可能落后。
3. `docs/features/feature-ledger.json` 中：
   - `personal-memory-daily-letter`
   - `account-compute-gift-payments`
   - `mobile-cross-device-chat-document`
   - `story-ownership`
   - `project-ownership`
   - `publishing-versions`
   - `image-asset-history`
4. `docs/brainstorms/2026-09-02-personal-memory-daily-letter-requirements.md`：产品行为和边界权威。
5. `docs/plans/2026-09-02-003-feat-personal-memory-daily-letter-plan.md`：实施单元、文件和测试权威。
6. `docs/environment-guide.md`：本地三份数据文件、备份和事故史。
7. `docs/aliyun-deploy-runbook.md` 与 `docs/qa/account-migration-cutover-rollback-plan.md`：真实 MySQL 与账号迁移门槛。

开工第一批只读检查：

```bash
# 必须在主仓运行，确认只有主仓拥有业务数据和 3000 服务
pnpm env:status

# 必须在本 worktree 运行
git status --short --branch
git log -3 --oneline --decorate
git diff -- docs/plans/2026-09-02-003-feat-personal-memory-daily-letter-plan.md
pnpm feature:validate
```

若 `origin/main` 已前进，先比较变更是否触达本交接列出的文件；不要在没有确认的情况下自行 rebase、merge 或覆盖当前未提交文档。

---

## 四、开工前的唯一协调动作

在修改代码前，必须由主仓当前协调者在**主仓实时** `docs/handoff/SESSION-BOARD.md` 登记：

> 个人记忆与每日来信执行｜`codex/personal-memory-daily-letter` / `.worktrees/codex/personal-memory-daily-letter`｜阶段性占用 `server/db.ts`、`drizzle/**`、`server/services/storyConversation.ts`、每日来信服务、发布／图片采用入口与 `client/src/features/personalMemory/**`；具体阶段按交接文件所有权表收窄｜执行中｜2026-09-03

不要只修改 worktree 里的会话板副本，那不会成为其他会话看到的实时协调点。发现其他活跃会话占用同一文件时停止，不要绕过，也不要顺手修改对方代码。

---

## 五、复审后必须先处理的四个承重问题

### 1. 私密图片不能继续使用公开静态地址

当前功能账本已经记录：`/api/images/:file` 与 `/local-images` 静态挂载不鉴权。足迹 API 即使检查了 `userId`，只要把该地址返回给浏览器，其他人仍可能绕过足迹 API 直接访问图片。

实施要求：

- 足迹缩略图和原图只通过逐请求校验账号与 Story／图片归属的受保护媒体端点，或短时签名 URL 交付。
- 足迹 API 不返回现有公开静态路径、磁盘文件名或可猜测标识。
- 测试未登录、另一账号、已删除来源和过期签名直接请求媒体均失败。
- 这项安全边界没有完成前，不得上线图片足迹。

### 2. 本地聊天与个人记忆不能假装跨文件原子

MySQL 普通聊天可以在数据库事务内同时写消息、经历与 outbox；本地普通聊天目前写入 `.webdev/prompt-lineage-local.json`，而计划把个人记忆放入 `server/db.ts` 的 `.webdev/local-persist.json`。两份文件没有共同事务。

推荐裁决：

- MySQL 继续使用消息、经历与 outbox 同事务。
- 本地模式采用“来源所属聚合内写 outbox + 幂等投影”而不是伪造跨文件事务：聊天 outbox 与聊天消息写进 prompt-lineage 聚合；文章、图片和每日留言 outbox 与各自来源写进 local-persist 聚合；后台 projector 幂等投影到统一个人足迹。
- 每条 outbox 使用稳定动作 ID，投影重复执行不增加事件、任务或证据边。
- 增加 source 落盘后 projector 崩溃、投影完成前重启、重复投影和损坏恢复测试。

若接手 Agent 认为必须采用其他方案，应先更新权威计划并说明如何证明崩溃耐久；不能保留“两个 JSON 同事务”的错误声明。

### 3. 所有新增模型调用必须服从算力与费用合同

账号／算力能力已经进入 `observing`。记忆提炼、回填提炼和同日重读都会产生模型费用，不能只复用 inference orchestrator 而绕过费用账本。

推荐裁决：

- Phase 1–2 的捕获、shadow 提炼和历史回填由平台预算承担，不扣用户余额。
- 即使平台承担，也要用稳定 operation ID 记录报价、provider attempt、实际成本、失败和未知结果，避免重试失控。
- 如果未来要扣用户余额，必须另行获得产品确认，并先提供价格告知、余额不足行为和逐笔明细。
- 同日重读若使用用户余额，必须复用现有预占、结算、失败释放和 reconciliation 合同；重复 action ID 不得重复扣费。
- 用户级并发、频率和回填预算是上线硬门槛。

### 4. 来信版本切换后禁止回滚到旧 writer

U1 会让不可变来信版本成为唯一正文权威。上线后若恢复仍能直接改 `emotion_daily_letters` 正文的旧代码，会立即重新制造双写和历史漂移。

实施要求：

- 迁移和统一 writer 先以向前兼容方式落地，再切换读路径。
- 回滚构建只能关闭提炼／召回，必须继续保留 U1 writer 和新 schema 兼容层。
- 禁止部署任何可独立写日期级正文的 pre-U1 版本。
- 增加回滚构建写入、版本重建、旧客户端写入和失败恢复测试。

---

## 六、权威计划需要同步补齐的复审结果

在写功能代码前，先对权威计划做一次小范围修订，不要重写整份文档：

1. U1／U2 写明本地 source-local outbox 与幂等投影边界。
2. U3 把 `server/services/storyBodyPersistence.ts` 纳入文件与测试，使文章 CAS、采用事件和 outbox 真正共享事务；同时裁决 `director_advice` 是否属于用户明确图片采用。
3. U5／U6 加入账号／算力账本、平台预算、稳定 operation ID、限流与未知结果对账。
4. U6 补齐独立“再读一遍”的进行中、失败、重复提交、成功切换与同日版本浏览状态；保存每日留言不得自动重读。
5. U7／U8 加入受保护媒体交付；明确微信 mock 壳不接真实足迹。
6. U8 把手机 Web 进入足迹纳入未保存正文保护，并在返回时恢复 Story、页签、滚动和焦点。
7. 在 U7 提前纳入既有每日来信的只读索引，或把“完整足迹”推迟到 U6 后；推荐前者，使 Phase 2 可看完整历史但仍不启用记忆召回。
8. Phase 1 捕获只限明确内部测试账号；向真实用户捕获前必须提供记忆状态、暂停后续捕获和清除已采集记录的入口。
9. U9 增加真实环境门槛：账号与手机跨端能力完成真实 MySQL、真实公网和两台独立设备验收；微信 mock 不算证据。
10. U9 增加从当前漂移测试库的脱敏克隆演练升级到 `0016` 之后新迁移的门禁；空库重演不能代替真实升级演练。
11. 明确个人记忆专用模型供应商 allowlist、禁止未经批准的跨供应商重放，以及供应商留存／训练／地域条件。
12. 在部署前明确在线 scrub、备份世代、删除账本和供应商副本的保留时限与销毁证据。
13. 为本地文件、MySQL 敏感 payload、迁移备份和删除账本确定静态数据保护方案。

不要采纳与已确认产品规则冲突的建议：用户“忘记”不改写已经读过的历史来信。历史信仍应标明它是当时生成的版本；只有用户明确删除底层来源时，才按计划执行隐私 payload scrub 和安全展示覆盖。

---

## 七、推荐执行顺序

### Phase 0 — 收口计划与门禁

- 重跑环境、会话板和功能账本检查。
- 完成第六节的计划小修并运行 `pnpm feature:validate`、`git diff --check`。
- 在会话板登记第一阶段实际文件所有权。
- 只要模型供应商、备份保留或静态数据保护仍未获得可执行规则，允许开发本地数据合同，但禁止开放真实用户捕获、runner 和记忆召回。

### Phase 1 — U1 数据合同与兼容 writer

- 先写 schema／repository／migration／本地投影的测试，再实现。
- U1 同步完成每日来信统一 writer；不要留下旧 writer 漂移窗口。
- 只建立能力，不启动 runner，不回填，不向真实用户捕获。

### Phase 2 — U2–U5 捕获、采用、回填和 shadow 提炼

- 按来源逐个接入，先普通聊天与每日留言，再文章和图片采用。
- 每接一个来源都证明：账号隔离、来源归属、幂等、删除传播和本地崩溃恢复。
- 提炼先小样本 shadow，平台承担费用；质量、成本和敏感提及门槛通过后再扩大。

### Phase 3 — U7、U6、U8 私密足迹与版本化来信

- 先提供可解释、可控制的理解和既有来信只读足迹。
- 再接精选记忆生成与显式同日重读。
- 最后把头像摘要、完整页面和手机 Web 入口接入同一 API。
- 图片足迹必须等受保护媒体交付完成。

### Phase 4 — U9 上线门禁

- 完成全量安全、迁移、费用、备份、双账号、双设备和可访问性验证。
- 只有主仓 3000 可以做页面验收；先合并代码，再在主仓验证。
- 真实环境仍为 No-Go 时，不部署、不迁移、不启用真实用户捕获。

---

## 八、阶段性文件所有权

同一个 Agent 可以连续执行全部阶段，但每一阶段只登记实际要动的文件，避免长期占住全仓库。

### 数据与事务阶段

- `shared/personalMemory.ts`
- `drizzle/schema.ts`
- `drizzle/migrations/<next>_personal_memory_daily_letter_versions.sql`
- `drizzle/meta/_journal.json` 与生成 snapshot
- `server/db.ts`
- `server/services/storyConversation.ts`
- `server/services/storyBodyPersistence.ts`
- `server/services/emotionDailyLetters.ts`
- 对应 unit／MySQL integration tests

### 捕获、提炼与来信阶段

- `server/services/personalMemory/**`
- `server/routers/personalMemory.ts`
- `server/routers/publishingDraft.ts`
- `server/services/publishingPersistence.ts`
- `server/services/directorAdvice.ts`（只有明确裁决该动作属于采用时）
- `server/routers/storyAgent.ts`
- `server/routers/creationAgent.ts`
- `server/services/emotionProfileDailyRefresh.ts`
- `server/services/emotionDailyReference302.ts`
- `server/_core/inferenceOrchestrator.ts` 的调用边界
- 现有算力账本服务及对应测试

### 客户端阶段

- `client/src/features/personalMemory/**`
- `client/src/pages/PersonalMemoryPage.tsx`
- `client/src/app/shell/TopBar.tsx`
- `client/src/app/router/AppRouter.tsx`
- `client/src/features/mobileWorkspace/MobileWorkspace.tsx`
- 对应组件、view model、路由和移动工作区测试

### 本阶段默认不触碰

- `miniprogram/**`
- PR #8 新增的 current-frame editing session 文件
- `.webdev/**`
- 生产／测试数据库、OSS 或模型供应商真实数据

任何真实数据库写入、迁移执行、外部模型调用或部署都需要重新确认授权和环境身份。

---

## 九、验证与完成标准

每个实施单元按权威计划运行目标测试；整体验收至少包括：

- `pnpm check`
- `pnpm test`
- `pnpm feature:validate`
- `git diff --check`
- disposable MySQL 从完整 journal 重演
- 从当前真实环境结构的脱敏克隆执行升级与失败恢复演练
- MySQL 与本地模式的幂等、崩溃恢复、删除传播和隐私 epoch 并发测试
- 双账号同 ID／同来源隔离测试
- 未登录、跨账号和过期签名直接访问私密图片均失败
- 余额不足、重复任务、未知结果、重启恢复和 provider 回退不重复扣费
- 归档、恢复、纠正和忘记在桌面／手机 Web 刷新后保持一致
- 同日重读失败保留旧版，成功只追加新版本

完成代码和自动化后：

1. 更新 `personal-memory-daily-letter` 功能卡的状态、入口、owners、证据和 remaining gaps。
2. 在没有其他合并会话时把 worktree 分支合回最新 `main`。
3. 只在主仓固定 3000 端口做真实页面验收；worktree 永远不开服务。
4. 合并和验收完成后，更新主仓会话板、删除本 worktree 和分支，不留尾巴。

---

## 十、明确禁止

- 不要在 worktree 运行 `pnpm dev` 或任何 preview server。
- 不要向 worktree `.webdev/` 写业务数据，也不要复制主仓业务数据进去。
- 不要使用 `git reset --hard`、`git clean` 或 `git checkout -- <path>` 清理现有文档修改。
- 不要把未提交草稿、键盘输入、生成候选、失败请求或被动浏览写入记忆。
- 不要让模型直接删除来源、激活理解或绕过确定性状态机。
- 不要让管理员入口读取普通用户的私密记忆。
- 不要为了历史完整而从当前 `isCurrent`、`activeVersionId` 或最近 Story 猜测过去采用行为。
- 不要把微信 mock 壳当成真实跨端实现。
- 不要在未告知时扣用户算力，也不要无计费／限流地运行回填或重试。
- 不要用公开静态图片地址展示私密足迹。
- 不要回滚到仍能直接写日期级来信正文的旧代码。
- 不要改写用户已经读过的历史来信来响应“忘记”。

---

## 十一、给接手 Agent 的启动提示词

可以把下面整段作为新 Agent 的第一条消息：

> 继承现有 worktree `/Users/yuandai/Documents/New project/drinking-time-local/.worktrees/codex/personal-memory-daily-letter` 和分支 `codex/personal-memory-daily-letter`，不要创建新 worktree。完整阅读 `AGENTS.md`、主仓最新 `docs/handoff/SESSION-BOARD.md`、`docs/handoff/2026-09-03-personal-memory-daily-letter-execution-handoff.md`、需求文档和 003 实施计划。先重跑环境、Git 和功能账本只读检查，保留当前未提交文档。代码修改前请协调主仓实时会话板并登记第一阶段文件所有权。先完成交接文档第六节的计划小修，然后执行 Phase 1/U1；不得在 worktree 启动服务或写 `.webdev`。遇到模型供应商、备份保留、静态加密或真实数据库／外部服务动作时停下来报告，不得自行扩大授权。实现和测试过程中持续遵守用户已确认的不变量，尤其是：忘记不删除来源、不改写历史来信；私密图片不得返回公开静态地址；新增模型调用不得绕过算力和费用合同。

