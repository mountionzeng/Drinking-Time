---
title: "feat: 开发环境收敛与环境仪表盘"
type: feat
status: active
date: 2026-06-12
origin: docs/brainstorms/2026-06-12-environment-consolidation-requirements.md
---

# feat: 开发环境收敛与环境仪表盘

## Summary

新建一个 TypeScript 仪表盘脚本（`pnpm env:status`）实时呈现 worktree/端口/数据现场，新建 AGENTS.md + CLAUDE.md 规则文件约束后续 AI 会话，写一页用户环境指南，并以用户逐个拍板的方式盘点收敛现存 5 个 worktree——全程不修改任何现有业务代码。

---

## Problem Frame

5 个 worktree、3 个并行 dev server、每个环境一份独立的 `.webdev/local-persist.json`，用户无法回答"哪个环境是真的、数据在哪"。根因与现场细节见源文档（Sources & References）。

---

## Requirements

继承源文档 R1–R8：

- R1. 逐个盘点全部 worktree，去留由用户拍板，不自动删除
- R2. 收敛后主仓库是唯一跑 dev server 的环境
- R3. 主仓库 dev server 固定使用单一约定端口（3000，现有 `pnpm dev` 已写死），不再多端口并行
- R4. 环境规则写入 AI 规则文件，约束后续 AI 会话：worktree 只用于修改代码；禁止在 worktree 内启动 dev server 或写入业务数据；改完尽快合并，合并后删除 worktree
- R5. 一页式环境说明文档放 `docs/`，面向用户本人：解释数据存放机制（数据文件跟启动目录走）、约定端口、以及"数据对不上时先查什么"
- R6. `pnpm env:status` 实时输出 worktree/端口/数据文件现场
- R7. 仪表盘输出按需生成，不落盘静态文档
- R8. 检测到多个 dev server 并行时输出醒目警告

**Origin actors:** A1（用户/项目所有者）、A2（AI 编码会话）
**Origin flows:** F1（一次性环境收敛）、F2（日后 AI 修改代码的常态流程）
**Origin acceptance examples:** AE1（covers R8）、AE2（covers R4）、AE3（covers R1）

---

## Scope Boundaries

- 不修改 `server/db.ts` 的数据路径逻辑及任何业务代码行为
- 不评判 `dt-refactor` 等 worktree 中既有重构工作的内容，只决定去留
- 不做多 worktree 共享数据文件（源文档明确拒绝）
- 不在桌面生成静态文档
- 函数级全量代码文档明确排除

### Deferred to Follow-Up Work

- 模块级架构地图：解决"文件多到不知道用处、改个东西都难"的代码理解问题——环境收敛完成后的下一个 brainstorm
- 死代码 / 归档清查：`server/archive/`、`dist/`、重复的 docs 草稿等是否可删——并入模块级地图工作或单独小任务
- 把 `predev` 的 pkill 模式覆盖 `scripts/preview-server.ts` 包装入口：属于行为修改，本计划只在文档中说明该盲点

---

## Context & Research

### Relevant Code and Patterns

- `package.json`：`dev` 脚本已 `PORT=3000`，`predev` 用 `pkill -f 'server/_core/index.ts'` 清旧进程——但 `scripts/preview-server.ts` 包装入口的命令行不含该模式，**绕过了 pkill**，这是多服务并行的成因之一
- `scripts/` 已有 `.ts`（tsx 运行）与 `.sh` 混合惯例；新脚本跟随 `.ts` 惯例
- `server/db.ts:136` 起：persist 路径基于 `process.cwd()`（数据分裂根因，已验证，不改）
- 测试框架 vitest（`vitest.config.ts`），`server/*.test.ts` 为现有测试命名惯例
- 仓库根**无** CLAUDE.md / AGENTS.md（已验证）；分支历史含 `claude/*` 与 `codex/*`，两种 AI 都在用
- worktree 现场（2026-06-12）：主仓库 + `~/Documents/dt-refactor` + `.claude/worktrees/` 下 2 个 + `.worktrees/` 下 1 个；监听端口 3000/3010/4321

### Institutional Learnings

- 无 `docs/solutions/` 目录，无可继承学习

### External References

- 未使用（纯本地工具与约定治理）

---

## Key Technical Decisions

- 仪表盘用 TypeScript（tsx 运行）而非 shell：跟随仓库脚本惯例，纯逻辑部分可用 vitest 测试（用户已确认）
- 规则文件 AGENTS.md 为正文 + CLAUDE.md 单行指向：Claude 与 Codex 两边都能读到同一份规矩（用户已确认）
- 用户指南文件名用 ASCII `docs/environment-guide.md`，内容中文：避免个别工具对非 ASCII 路径的兼容问题（用户已确认）
- 先做仪表盘再做盘点收敛：清理时手上有可视化工具，每处置一个 worktree 都能立刻验证现场（用户已确认）
- 端口信息获取用 `lsof -iTCP -sTCP:LISTEN`：macOS 原生可用，本项目是单机本地开发，不考虑跨平台

---

## Open Questions

### Resolved During Planning

- 脚本实现形式：TypeScript + tsx，命令 `pnpm env:status`
- 规则文件位置：新建根级 AGENTS.md + CLAUDE.md 指针（两者此前均不存在）

### Deferred to Implementation

- 每个 worktree 的具体去留：盘点结果呈现后由用户逐个拍板（U2 执行过程的一部分，无法预先决定）
- `dt-refactor` 中 `claude/split-godobjects` 分支与主干的偏离程度：盘点时用 git 实测，不预判

---

## Implementation Units

### U1. 环境仪表盘脚本 `pnpm env:status`

**Goal:** 一条命令实时输出：全部 worktree 及分支、监听中的 dev server 端口及进程、每个环境的 `.webdev/local-persist.json` 路径与最后修改时间；多服务并行时顶部醒目警告。

**Requirements:** R6, R7, R8（AE1）

**Dependencies:** None

**Files:**
- Create: `scripts/env-status.ts`
- Create: `scripts/env-status.test.ts`
- Modify: `package.json`（新增 `"env:status": "tsx scripts/env-status.ts"`）
- Modify: `vitest.config.ts`（`include` 数组新增 `"scripts/**/*.test.ts"`，否则新测试不会被 `pnpm test` 执行）

**Approach:**
- 数据来源三路：`git worktree list --porcelain`（权威 worktree 清单，覆盖仓库外的 `dt-refactor`）、`lsof -iTCP -sTCP:LISTEN`（监听端口与 pid）、对每个 worktree 目录 stat 其 `.webdev/local-persist.json`
- 端口归属判断：通过 pid 取进程的工作目录（如 `lsof -p <pid> -a -d cwd`），将监听进程映射回所属 worktree；映射不到的 node 进程单独列出，不强行归类
- 结构上把"采集"（shell 调用）与"解析/判断/格式化"（纯函数）分开，纯函数部分可单测
- 输出为中文、面向用户可读；不写任何文件（R7）

**Patterns to follow:**
- `scripts/import-local-persist-to-mysql.ts`（现有 TS 脚本的结构与运行方式）
- `server/*.test.ts` 的 vitest 测试惯例

**Test scenarios:**
- Happy path: 给定含 3 个 worktree 的 `--porcelain` 输出样本 → 解析出 3 条记录，路径与分支正确
- Happy path: 给定 lsof 输出样本（2 个 node 进程监听 3000/3010）→ 解析出端口与 pid 映射
- Covers AE1. Edge case: 检测到 ≥2 个属于本项目的 dev server → 格式化输出的首行为醒目警告，并列出各自数据文件路径
- Edge case: 仅 1 个 dev server 在跑 → 无警告
- Edge case: 某 worktree 无 `.webdev/local-persist.json` → 显示"无数据文件"而非报错
- Error path: lsof 不可用或返回非零 → 端口区块显示采集失败提示，worktree 区块仍正常输出（部分失败不致命）

**Verification:**
- 在当前真实现场跑 `pnpm env:status`，输出与 `git worktree list` 和 `lsof` 手工核对一致，且因 3 服务并行而出现警告

---

### U2. Worktree 盘点与环境收敛（用户在环）

**Goal:** 逐个盘点 5 个 worktree（分支、相对主干的未合并提交、未提交改动、数据文件状态），把每个的状态呈现给用户拍板（合并 / 删除 / 暂留），按决定处置；停掉多余 dev server，只留主仓库 3000 端口一个。

**Requirements:** R1, R2, R3（F1、AE3）

**Dependencies:** U1（用仪表盘验证每步处置后的现场）

**Files:**
- 无代码文件；操作对象是 git worktree、分支与运行中的进程

**Approach:**
- 盘点以 `git worktree list --porcelain` 为权威来源（覆盖 `~/Documents/dt-refactor`），逐个收集：分支名、`git log main..<branch>` 的未合并提交摘要、`git status` 未提交改动、`.webdev/` 数据文件大小与时间
- **每个 worktree 单独呈现、单独等用户决定，绝不批量处置、绝不自动删除**（AE3）
- 暂留的 worktree 在 U4 的指南文档里记一行"暂留理由"
- 处置完成后停掉多余 dev server，确认只剩主仓库 3000；跑一次 `pnpm env:status` 留档最终状态

**Execution note:** 操作性单元，破坏性动作（删 worktree、杀进程）前必须有用户对该项的明确确认。

**Test scenarios:**
- Test expectation: none——无代码改动；验收即 AE3 的人工流程（盘点呈现 → 用户拍板 → 处置）

**Verification:**
- `git worktree list` 只剩主仓库与用户明确选择暂留的条目
- `pnpm env:status` 显示仅一个 dev server（3000）、无警告
- 用户能指认唯一的活跃数据文件路径

---

### U3. AI 规则文件（AGENTS.md + CLAUDE.md）

**Goal:** 新建根级 `AGENTS.md` 承载环境规则，`CLAUDE.md` 单行指向它，使后续 Claude / Codex 会话都受同一份约束。

**Requirements:** R4（F2、AE2）

**Dependencies:** None（内容引用 U1 的命令名，文字层面协调即可）

**Files:**
- Create: `AGENTS.md`
- Create: `CLAUDE.md`（内容仅为指向 AGENTS.md 的引用）

**Approach:**
- 规则核心条目（与 AE2 对齐）：worktree 只用于改代码；禁止在 worktree 内启动 dev server 或写业务数据；要看运行效果回主仓库 3000 端口验证；改完尽快合并、合并后删除 worktree；数据文件跟启动目录走的事实说明 + 指向 `docs/environment-guide.md`
- 同时提示 AI：诊断环境问题先跑 `pnpm env:status`
- 保持一页以内——规则文件越长越不被遵守

**Test scenarios:**
- Test expectation: none——纯文档单元；AE2 的验收发生在未来 AI 会话的真实行为中

**Verification:**
- 两文件存在于仓库根；规则覆盖 AE2 场景（AI 被要求在 worktree 跑服务时应拒绝并引导回主仓库）

---

### U4. 用户环境指南 `docs/environment-guide.md`

**Goal:** 一页中文指南，让用户自己看懂：数据存放机制（跟启动目录走）、约定端口 3000、"数据对不上时先查什么"的排查顺序、暂留 worktree 的清单与理由。

**Requirements:** R5

**Dependencies:** U2（需写入收敛后的最终状态与暂留清单）

**Files:**
- Create: `docs/environment-guide.md`

**Approach:**
- 排查顺序固化为三步：跑 `pnpm env:status` → 看警告 → 对照指南判断哪份数据是真的
- 说明 `predev` pkill 的覆盖范围及 `scripts/preview-server.ts` 绕过它的盲点（只说明，不改行为）
- 说明 2026-06-01 数据事故与 `.webdev/backups/` 安全网的存在（数据疑似丢失时去哪找回）

**Test scenarios:**
- Test expectation: none——纯文档单元

**Verification:**
- 用户照指南三步能独立回答"现在数据在哪一份文件"（对应源文档成功标准"10 秒内回答"）

---

## System-Wide Impact

- **Interaction graph:** 不触碰业务代码；`package.json` 仅新增一条 script，不影响现有 `dev`/`build`/`test`
- **Error propagation:** `env-status` 采集失败时局部降级（见 U1 error path），不抛出未处理异常吓到用户
- **State lifecycle risks:** U2 删 worktree 是不可逆动作——以"逐个用户确认"为唯一闸门；数据文件本身不动
- **Unchanged invariants:** `pnpm dev` 行为、端口 3000、`server/db.ts` 数据路径逻辑、所有业务功能完全不变

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| 误删含未合并工作的 worktree | U2 逐个呈现未合并提交摘要，用户逐个拍板，绝不自动删除 |
| `dt-refactor`（split-godobjects 重构）与主干偏离大、难合并 | 盘点时实测偏离度；难合并就"暂留 + 记录理由"，不强行处理 |
| lsof 输出格式差异导致解析脆弱 | 解析逻辑为纯函数 + 单测固定样本；解析失败走局部降级 |
| 规则文件被未来 AI 会话忽略 | 规则保持一页内、放仓库根（两种 AI 的默认读取位置）；AE2 场景写得具体可执行 |

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-06-12-environment-consolidation-requirements.md](../brainstorms/2026-06-12-environment-consolidation-requirements.md)
- Related code: `server/db.ts`（persist 路径根因）、`package.json` scripts、`scripts/preview-server.ts`
