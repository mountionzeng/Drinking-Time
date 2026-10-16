# 成品预览左侧缩略图

日期：2026-10-16。入口：主仓 `http://localhost:3000/editing` → 文章图片制作 → 成品预览。

- 电脑成品缩略图左侧竖排，最多 70vh 独立滚动，右侧显示当前大图。
- 鼠标指针移入立即选择对应页；点击和键盘聚焦沿用相同页状态。预览离开后保留最后选择。
- 手机保留横排缩略图和点击放大；作品生成、排版数据及下载逻辑不变。
- `pnpm env:status`：只有主仓 3000 服务。
- `pnpm exec vitest run client/src/features/publishingAlbum/PublishingImagePack.test.tsx client/src/features/publishingAlbum/imagePackRendering.test.ts`：2 文件 15 项通过。
- `pnpm check`：通过。
- 内置浏览器实看三张成品的左右布局；点击第 3 张后选中态正确，大图 src 与下载当前图片 href 一致；返回封面可见。
- 浏览器工具未提供独立 hover 动作，真实鼠标仅悬停未单独自动化验证；手机真机未复验。
- 无 AI 调用、作品保存、下载提交或上线部署。
