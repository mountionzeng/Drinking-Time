# 发布画册中文字体仓库

这里保存静态画册文字层可选择的本地字体。五款已安装字体均来自 Google Fonts 固定提交 `3b1480ea4b6e15fed70a42f4cb29216476a044ed`，使用 SIL Open Font License 1.1。

- 每个目录必须同时保存字体、`OFL.txt` 和 `SOURCE.json`。
- `shared/publishingAlbumFonts.ts` 是文件名、大小、SHA-256 和产品标签的权威 manifest。
- 页面不得全局导入这些字体；只通过画册字体仓库按当前 `fontId` 加载。
- 原始字体总量不得超过 60 MiB。未安装候选只能留在 research pool，不能出现在选择器中。
- 更新任何二进制前，必须固定不可变来源并运行 `pnpm exec tsx scripts/verify-publishing-album-fonts.ts`。

推荐只提供首选和最多两个备选；用户明确选择始终优先，推荐刷新不得覆盖已保存的 `fontId`。
