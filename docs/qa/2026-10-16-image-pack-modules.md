# 成品图片模块编辑验收

日期：2026-10-16。主仓 `http://localhost:3000/editing` → 文章图片制作 → 成品预览 → 模块编辑。

## 行为

- 原自动排版和手机入口保留；电脑通过一个按钮打开模块画布。
- 正文按非空段落独立成块，标题、封面图和每张配图独立成块，底纹固定。
- 中间拖动移动，四角等比缩放并固定对角；图片四边裁切，向外可恢复原图范围。
- 双击文字或选择后点击编辑文字，完整文本可修改，字号随模块缩放。长段落保持整块，必要时缩小；块之间允许自由重叠。
- 撤销/重做最近 30 步；取消指针、Escape 不提交进行中的拖动。
- 本机草稿保存操作完成后的模块及尚在输入的文字。完成编辑才替换成品输出，原正文及素材不变。
- 来源内容和排版选图设置改变后使用独立本机记录；打开中的旧来源编辑不能套回新来源。
- Live canvas、缩略图和 1800×2400 PNG 使用同一个绘制器；裁切与文字坐标保持一致。

## 自动化

相关 7 文件共 66 项通过（新增窄图裁切边界后，对模型与绘制器再次运行 18 项）：

```sh
pnpm exec vitest run client/src/features/publishingAlbum/imagePackModules.test.ts client/src/features/publishingAlbum/imagePackModuleRenderer.test.ts client/src/features/publishingAlbum/PublishingImagePack.test.tsx client/src/features/publishingAlbum/imagePackComposition.test.ts client/src/features/publishingAlbum/imagePackRendering.test.ts client/src/features/publishingDraft/PublishingDraftWorkspace.test.tsx client/src/features/mobileWorkspace/MobileImageStudio.test.tsx
pnpm check
pnpm build
pnpm feature:validate
```

类型检查、生产构建及 61 张功能卡校验通过；构建保留现有大体积 chunk 提示。

覆盖完整与重复段落、Unicode、长段落整块分页、插图锚点、四角固定对角、位置边界、四边可逆裁切、窄图裁切不越界、文字编辑不改其他块、恢复校验及来源隔离、预览与导出的裁切/字形坐标/缩放一致、缺字/控制字符拒绝、取消和位图资源释放。

## 主仓浏览器

1. 打开模块编辑，当前作品生成封面和两页正文，每段文字可单独选择。
2. 真实鼠标拖中心，从 `left:20.2886%; top:9.16667%` 移到 `26.017%;12.7469%`。
3. 拖左边裁切，宽度从 `59.4228%` 缩为 `52.7397%`，高度保持 `59.1667%`。
4. 拖右下角，宽高变为 `48.03%;53.883%`，等比缩放；三个操作均通过撤销还原。
5. 双击正文第一段，临时追加“（编辑验证）”，完成文字编辑后重开确认保留，随后撤销。
6. 完成编辑成功，实际下载 PNG；浏览器 naturalWidth/Height 及 `sips` 均确认 1800×2400。
7. 图片向右移动 1 个画布单位，标题输入“未命名故事（恢复验证）”尚未确认时刷新。重新打开编辑器，位置与输入内容均恢复。
8. 取消临时标题输入、图片向左还原 1 单位，再次完成；未向原正文、素材或后端提交验收文字。

未调用 AI，未部署。手机保持原界面；新模块编辑的手机触控和其他真机浏览器未验收。已下载的验收 PNG 在本机 Downloads 中。
