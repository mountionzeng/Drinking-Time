# promptRevision —— 提示词候选/修订 UI（暂时无引用，**请勿按死代码删除**）

这四个组件原本挂在 `PromptTablePanel` / `PromptTable` 下面，而那条链的根
（`pages/AnalysisPage.tsx`）在 `/analysis` 改成重定向之后就没人引用了——
也就是说**这套候选 UI 已经写好，但用户进不去那个页面，从来没跑起来过**。

删除死链时把它们移到这里保留，因为它们是"每句话/每次修改都产生候选修订"
那条产品主线的现成材料：

| 组件 | 已经做好的事 |
|---|---|
| `PromptRevisionStatus` | candidate / confirmed / rejected 三态展示，rev 号、权重百分比、故事提示词版本号 |
| `PromptRevisionDialog` | 修订历史 + 影响预览（对应 `promptLineage.previewCandidate` 的 current vs proposed） |
| `PromptCellEditor` | 单个维度格子的就地编辑（改值 + 改权重） |
| `PromptDatabaseView` | 按 scope / modality 分组的提示词数据库视图 |

服务端配套端点都是现成的：`promptLineage.createCandidate` / `previewCandidate` /
`confirmCandidate` / `rejectCandidate`，`story_conversation_messages.candidateRevisionId`
也已经能把一条消息关联到一条候选修订。

## 下一步

把它们接进 `StoryboardReviewBoard`（故事板），让每行镜头显示"N 条待确认建议"。
接上之后请删掉本文件。

## 给 knip 的说明

`knip` 会把本目录下没有测试覆盖的文件报成 unused files——**这是预期的**，
不要据此删除。`PromptRevisionStatus` 和 `PromptDatabaseView` 有自己的测试所以不会被报。
