# 会话看板 · 谁正在动什么

> **动代码之前先读这里，动之前先登记，收工之后立刻销号。**
> 这份文件是多个 AI 会话之间唯一的实时协调点。功能账本
> （`docs/features/feature-ledger.json`）记录「产品有什么能力」，这里记录
> 「此刻有谁的手在哪个文件上」。两者不重复。

建立于 2026-08-23，起因：架构收敛会话在测量基线的 20 分钟里，另一会话
（`claude/multitrack-editor-reset`）往主仓合入了三次死代码清理，触达的正是
收敛试点的隔壁文件。双方事前都不知道对方存在。

---

## 协议（四条）

1. **开工前**：在下面「当前在场」表里加一行，写清分支／worktree、正在动哪些文件、
   预计什么时候收工。同时看一眼别人占了什么。
2. **发现重叠**：不要自己绕开，也不要"顺手帮对方改"。停下来告诉用户，由用户裁决归属。
3. **收工后**：把自己那行删掉，并在「最近落地」里加一条（提交号 + 一句话 + 触达的热点文件）。
   worktree 和分支按 `AGENTS.md` 第 4 条立刻删除。
4. **热区文件**（见下表）动之前必须先登记，哪怕只改一行。

---

## 当前在场

| 会话 | 分支 / worktree | 正在动 | 状态 | 更新时间 |
| --- | --- | --- | --- | --- |
| 架构收敛 | `codex/story-visual-assets`（主仓，只读为主） | 需求文档已定稿，等用户拍板后进 ce-plan | 未动产品代码 | 2026-08-23 18:20 |
| 视觉资产标准板 | `affectionate-bartik-1d9c06` | 待办：放开 `visualAssetGenerationContext.ts:226` 的 provider 白名单（现只放行 midjourney），会同时动 `server/routers/storyAgent.ts` 的估价分支 | **未动手**，等用户给 OSS 凭据 + 裁决是否放开 gpt-image | 2026-08-23 18:35 |

（收工时删掉自己这行。）

---

## 最近落地

> **归属怎么判**：author 字段全是 `jane-githu`，区分不出会话。可靠判据只有两条——
> `git reflog` 里这条是 `commit:`（直接在主仓提交）还是 `merge <分支名>:`（从哪个 worktree 合入），
> 加上触达的文件属于哪条线。**不要用「时间重合 + 刚跟谁通过信」归因**：
> 2026-08-23 下午已经连错两次，第二次差点让人去改错的地方。

| 时间 | 提交 | 内容 | 归属（判据） | 触达热区 |
| --- | --- | --- | --- | --- |
| 08-23 17:43 | `8d19b94` | 删掉图生图链路里没被用上的代码 | **图生图对话框线**（reflog 为 `commit:`，直接在主仓提交；文件全属图生图链路） | `chatImageRefs.ts`、`useChatImageRemix.ts`、`useAssetSwapProposal.ts` |
| 08-23 17:47 | `f0ce930` / `1f89f5b` | 清掉多轨剪辑重构留下的死代码 | **clip-move 线**（`1f89f5b` 的第二父提交来自 `claude/multitrack-editor-reset`）。该线当日收工，worktree 与分支已按规矩删除 | `visualClipEditing.ts` −27、`visualClipModel.ts`、`creationAgent.ts` −14、`EditingNleWorkspace.tsx`、`StoryboardEditRow.tsx` |
| 08-23 18:07 | `8e85541` | 视觉资产：参考图改走自有 OSS、一致性闸门按小句判定、冲突裁决逐条配对 | **视觉资产标准板线**（08-22 完成未落库，由架构收敛会话代为提交；原作者已核对提交信息属实）。这批是真实付费验出来的，累计 ¥31.29 | `imageGen.ts`、`storyAgent.ts`、`visualAsset*` |
| 08-23 18:12 | `6aed6d2` / `41d1797` | 补齐三份未落库交接文档；新增架构收敛需求文档与用户裁决 | **架构收敛线** | 无（纯文档） |
| 08-23 18:25 | `414331b` | 新增本看板 | **架构收敛线** | 无（纯文档） |

---

## 热区文件（改动必须先登记）

同一事实目前仍有多个写入者，或多条线同时在改：

| 文件 | 为什么是热区 |
| --- | --- |
| `server/routers/creationAgent.ts` | `updateStoryTimeline` 仍接收整份 items；是架构收敛第一刀的目标 |
| `client/src/features/creationEditor/CreationEditorContext.tsx` | `saveTimelineItems` 22 处引用，整份 timeline 写回的唯一来源 |
| `server/services/visualClipEditing.ts` / `shared/visualClipModel.ts` | 新落地的 `moveVisualClip` 家族，与上面两处争同一个事实 |
| `client/src/features/creationEditor/views/EditingNleWorkspace.tsx` | 底部时间轴，第二个可编辑表面 |
| `client/src/features/creationEditor/views/StoryboardEditRow.tsx` | 上方 Storyboard 图层，第一个可编辑表面 |
| `server/routers/storyAgent.ts` | 视觉资产、图生图、剧本三条线共用 |
| `server/db.ts` | 109 个导出、53 个文件直接引用，任何改动扩散面最大 |

---

## 当前待决（用户已知，未拍板）

- 用户对**两个剪辑界面**（上方 Storyboard 图层 / 底部 Timeline）都不满意，倾向合并成一个。
  合并范围尚未确定，见 `docs/brainstorms/2026-08-23-architecture-convergence-requirements.md`。
- 架构收敛的第一刀已获批：关闭整份 timeline 写入口，位置只走 `moveVisualClip` 家族，
  批量操作（撤销、整层重排）也必须表达成服务端领域命令（用户选了严格方案）。
  **这会改动上表前三个热区文件**，其他会话请避让或先协调。
- `server/routers/storyAgent.ts` 上有两条线会碰面：架构收敛（timeline 写入口）与视觉资产标准板
  （provider 白名单 + 估价分支）。后者尚未动手，动手前会先更新本看板。
- 视觉资产标准板线在等用户两件事：OSS 凭据；是否放开 gpt-image
  （用户一小时前在两个方案里选了另一个，图生图线希望改判——**这是用户的决定，任何会话不得代为翻案**）。
