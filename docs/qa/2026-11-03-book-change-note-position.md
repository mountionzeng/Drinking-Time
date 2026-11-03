# 2026-11-03 书稿修改说明位置调整

用户要求把「修改说明（选填）」移到「版本」后面；验证于11月4日凌晨完成。

- ChapterWorkspace顶部章节栏紧接版本按钮显示原修改说明折叠项，默认收起；展开填写后仍由ChapterWriting原草稿changeNote与自动保存链管理。
- 正文底部不再重复显示；没有顶部插槽的独立/旧入口保留原位置。标题、正文、恢复、版本CAS与原有间距保持，不新增按钮。
- 既有ChapterWorkspace与ChapterWriting共21项测试及`pnpm check`通过；简单位置调整未新增镜像实现测试。
- 主仓3000真实页面验证同一行的「版本 → 修改说明（选填）」、展开输入框及收起均正常，底部无重复入口。仅操作折叠项，没有刷新、填写真实说明、改稿或付费调用。
- 截图：`/tmp/book-change-note-position-20261103.png`。

`pnpm feature:validate`80卡及`git diff --check`通过。本地完成，未提交/部署。story-chapters保持partial，既有跨端与断网验收缺口不变。
