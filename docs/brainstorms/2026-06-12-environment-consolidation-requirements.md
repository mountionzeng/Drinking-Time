---
date: 2026-06-12
topic: environment-consolidation
---

# 开发环境收敛与环境仪表盘

## Summary

把开发环境从"5 个 worktree、3 个并行 dev server、多份互不相通的数据"收敛为"主仓库单一活跃环境、一份数据"，立下防再次发散的规则（同时约束人和 AI），并提供一条按需生成的环境状态命令取代会过期的静态文档。

---

## Problem Frame

项目由 vibe coding 长成，日常修改高度依赖 AI 会话。多轮 AI 协作留下了 5 个 worktree（主仓库、`~/Documents/dt-refactor`、`.claude/worktrees/` 下 2 个、`.worktrees/` 下 1 个），且同一时刻有 3 个 dev server 在 3000 / 3010 / 4321 端口并行运行。

数据层的根因已对源码验证：`server/db.ts` 中本地持久化路径默认是 `path.join(process.cwd(), ".webdev", "local-persist.json")`——**数据文件跟着启动目录走**。每个 worktree 启动的服务器读写自己目录下的那份数据，于是"每个端口的数据都对不上"。2026-06-01 已发生过一次数据被测试覆盖的事故（`server/db.ts` 注释有记录），环境混乱已造成实际损失。

用户无法回答"现在有几个环境在跑、哪个是真的、数据在哪"，导致不敢改、乱改、改完反复——这是技术债的直接来源。

---

## Actors

- A1. 用户：项目所有者，非全职工程师，通过 AI 会话修改代码；所有 worktree 去留由其拍板。
- A2. AI 编码会话（Claude/Codex 等）：实际执行代码修改的主体，会自行创建 worktree 和启动服务；是环境发散的主要来源，需被规则文件约束。

---

## Key Flows

- F1. 环境收敛（一次性）
  - **Trigger:** 本需求落地的第一步
  - **Actors:** A1, A2
  - **Steps:** 逐个盘点 5 个 worktree（分支、未合并提交、未提交改动）→ 向用户呈现每个的状态 → 用户逐个拍板（合并 / 删除 / 暂留）→ 处置 → 停掉多余 dev server，只留主仓库一个
  - **Outcome:** 只剩主仓库一个活跃环境、一份 `.webdev/local-persist.json`；暂留的 worktree 有明确记录的理由
  - **Covered by:** R1, R2, R3

- F2. 日后 AI 修改代码（常态）
  - **Trigger:** 用户让 AI 改功能
  - **Actors:** A1, A2
  - **Steps:** AI 在 worktree 中改代码 → 不在 worktree 内启动 dev server → 改完合并回主仓库 → 删除 worktree → 用户只在主仓库验证效果
  - **Outcome:** 用户始终只面对一个端口、一份数据；worktree 用完即走
  - **Covered by:** R4, R5

---

## Requirements

**环境收敛**
- R1. 逐个盘点现存全部 worktree（分支、未合并提交、未提交改动），结果呈现给用户；每个 worktree 的去留由用户决定后再处置，不自动删除任何内容。
- R2. 收敛完成后，主仓库是唯一运行 dev server 的环境；其余环境的 dev server 全部停掉。
- R3. 主仓库 dev server 固定使用单一约定端口（默认 3000），不再多端口并行。

**防再发散规则**
- R4. 环境规则写入项目的 AI 规则文件（CLAUDE.md / AGENTS.md），约束所有后续 AI 会话：worktree 只用于修改代码；禁止在 worktree 内启动 dev server 或写入业务数据；改完尽快合并，合并后删除 worktree。
- R5. 一页式环境说明文档放在 `docs/` 下，面向用户本人：解释数据存放机制（数据文件跟启动目录走）、约定端口、以及"数据对不上时先查什么"。

**环境仪表盘**
- R6. 提供一条命令（形如 `pnpm env:status`），实时输出：现有 worktree 及各自分支、当前监听的端口及对应进程、每个环境的数据文件路径与最后修改时间。
- R7. 仪表盘输出按需生成，不落盘为静态文档——"应对变化的逻辑"是每次重新生成，而非维护快照。
- R8. 当检测到多个 dev server 同时在监听时，输出中给出醒目警告。

---

## Acceptance Examples

- AE1. **Covers R8.** 已有两个 dev server 分别监听 3000 和 3010，运行 `pnpm env:status`，输出顶部出现醒目警告，指出存在多个并行环境及各自的数据文件路径。
- AE2. **Covers R4.** 后续某个 AI 会话在 worktree 中工作并被要求"跑起来看看效果"，该会话依据规则文件拒绝在 worktree 内启动 dev server，并引导回主仓库验证。
- AE3. **Covers R1.** 盘点发现某 worktree 有未合并提交，向用户呈现分支名与提交摘要，等待用户拍板，期间不做任何删除。

---

## Success Criteria

- 用户在任何时刻 10 秒内（跑一条命令）能回答："现在有几个环境在跑、哪个端口是真的、数据在哪一份文件里"。
- 收敛后只存在一份活跃的 `.webdev/local-persist.json`，"端口之间数据对不上"不再发生。
- 规则文件落地后，后续 AI 会话不再产生"留在原地的 worktree"和"并行 dev server"。
- 交接给规划/实现时，不需要再发明任何产品行为：盘点范围、规则内容、仪表盘输出项均已定义。

---

## Scope Boundaries

- 函数级全量代码文档（1026 个文件的函数清单）——明确排除；将来如需代码理解辅助，做"模块级架构地图"，作为独立的后续工作。
- 多 worktree 共享同一份数据文件（经 `LOCAL_PERSIST_PATH` 指向同一路径）——明确拒绝：不同分支 schema 可能不同，共写一份数据比现状更危险。
- 不修改 `server/db.ts` 的数据路径逻辑——本次治理环境，不改代码行为。
- 不评判 `dt-refactor`（`claude/split-godobjects`）等 worktree 中既有重构工作的内容本身，只决定去留。
- 不在桌面生成静态文档——桌面快照必然过期，过期文档比没有文档更危险。

---

## Key Decisions

- 按需生成取代静态文档：用户原始诉求是"文档 + 应对变化的逻辑"，结论是变化的逻辑就是不存快照、每次实时生成（R6/R7）。
- 单一活跃环境而非多环境管理工具：用户并无并行对比多版本的真实需求，混乱来自 AI 会话的副产物，做减法优于做管理工具。
- 规则写入 AI 规则文件是防技术债的核心：环境发散的主要制造者是 AI 会话，约束写给 AI 看才能治本（R4）。

---

## Dependencies / Assumptions

- 数据根因已对源码验证（`server/db.ts:136` 起，persist 路径基于 `process.cwd()`）。
- 端口现场（3000/3010/4321 有 node 进程）是 2026-06-12 的快照；执行收敛时需重新确认现场。
- `dt-refactor` 位于主仓库目录之外（`~/Documents/dt-refactor`），盘点时不可只扫描仓库内目录，需用 `git worktree list` 作为权威来源。

---

## Outstanding Questions

### Deferred to Planning

- [Affects R1][User decision] 每个 worktree 的具体去留（合并/删除/暂留）在盘点结果呈现后由用户逐个拍板，属执行过程的一部分。
- [Affects R6][Technical] 仪表盘脚本的实现形式（TS 脚本 / shell、命名、是否复用 `scripts/` 现有结构）由规划阶段决定。
- [Affects R4][Technical] 项目当前无 CLAUDE.md / AGENTS.md（仅 `.claude/launch.json` 与 settings），规则文件需新建；放哪个文件、与现有 `docs/` 约定如何衔接，规划时定。
