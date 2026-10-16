# 页面缩略图右键增删

## 操作

- 图像 → 排版 → 左侧页面缩略图右键，显示「在上方插入空白页」「在下方插入空白页」「删除这一页」。沿用模块菜单的样式、键盘快捷键及 Escape。
- 插入页使用当前作品的纸张背景，自动显示新页；其他页的文字、图片、坐标、样式和裁切不变。删除作用于整页及其模块，接着显示相邻页。
- 缩略图页码、模块跨页菜单目标和导出文件序号来自当前页面顺序，始终从 1 连续编号。
- 页面菜单打开时暂停鼠标悬停切页；正在编辑文字、处理文件或拖动时不允许操作页面。
- 最少保留一页，最多九页；越界操作在修改前拒绝。当前页数达到上下限时显示原因并禁用相应菜单项。
- 所有增删接入完整文档的撤销/重做和本机草稿；不写回原文，不删除原图片素材。

## 验证

`pnpm exec vitest run client/src/features/publishingAlbum/imagePackModules.test.ts client/src/features/publishingAlbum/imagePackModuleRenderer.test.ts client/src/features/publishingAlbum/PublishingImagePack.test.tsx`

61 项通过，新增覆盖首/中/尾插页、首/中/尾整页删除、旧文档保持不变以供撤销、草稿恢复、单页保护、九页上限及失效索引原子拒绝。PNG 用例验证删除原封面和前后插页后，文件名连续为图文-01/02/03，空白页只绘制纸张，正文内容完整保留。

主仓 3000 浏览器实测：

- 七页作品的第四页右键显示三个操作，菜单无遮挡、无需额外对话框。
- 上方插入后变为八页，原第四页成为第五页；Shift+F10 打开菜单并在下方插入后变为九页，原内容页顺延至第六页。
- 九页时两项插入操作均禁用，并显示「最多 9 页」。
- 删除临时第五页后原内容页恢复为第五页；撤销恢复九页，重做回八页。
- 最终撤销全部三项测试操作，恢复用户原七页、原第四页图文内容及原页面顺序。未编辑文字、刷新页面或新增后端记录。

截图：`/Users/yuandai/.codex/visualizations/2026/10/15/01a1402b-f1cb-72b2-a8d7-9746e3c11c30/page-thumbnail-context-menu.png`

收尾检查均通过：`pnpm check`、`pnpm build`、`pnpm feature:validate`（61 张卡）、`git diff --check`。构建仅有既有大包提示。
