# 手机图文模块编辑验收

日期：2026-10-16。入口：主仓 `http://localhost:3000/m` → 文字稿 → 制作图文 → 排版。

## 操作设计

- 保留手机「预览 / 配图 / 排版」入口；排版复用电脑的模块文档、绘制器、本机草稿和撤销栈。
- 横向缩略图轻点切页。先轻点选择模块，再拖动移动；未选中模块允许纵向滚动，选中模块和四角手柄接收拖动。手柄触点为 44px。
- 选中后底部固定操作条提供改字和「模块操作」。文字操作包含正常、加粗浅色字、半透明底色、移到已有页或新页、删除；改字使用大字号输入面板。
- 图片操作主动开启裁切模式，显示四边短线；完成裁切后恢复四角缩放，避免移动时误裁。
- 「页面操作」提供前后插空白页、删除和整理；保留至少一页、最多九页，编号和移动目标连续更新。
- 「＋ 图片」底部面板提供已有素材、本机上传及原生成入口；费用确认和生成候选流程保持。
- 进入预览前提交尚未完成的文字、用当前完整模块稿渲染 PNG，失败留在排版中显示错误；预览保留下载、系统分享和确认后创建匿名链接。切回排版保留会话与撤销。

## 自动化

以下 7 个文件共 87 项测试通过，覆盖模块几何、文本与样式、裁切、增删页、跨页与撤销文档、PNG一致性、手机菜单及边界、既有手机制作与上传入口。

```sh
pnpm exec vitest run \
  client/src/features/publishingAlbum/imagePackModules.test.ts \
  client/src/features/publishingAlbum/imagePackModuleRenderer.test.ts \
  client/src/features/publishingAlbum/PublishingImagePack.test.tsx \
  client/src/features/publishingAlbum/MobileModuleTools.test.tsx \
  client/src/features/mobileWorkspace/MobileImageStudio.test.tsx \
  client/src/features/publishingAlbum/useLocalPackImages.test.ts \
  client/src/features/mobileWorkspace/MobileStoryWorkspace.test.tsx
```

`pnpm check`、`pnpm build`、`pnpm feature:validate`（61 张功能卡）及 `git diff --check` 通过；构建保留既有大包体提示。

## 主仓浏览器

内置浏览器 390 × 844 视口，独立临时 `/m` 页签。使用本机已有素材；无新购图片或对外分享。

1. 打开排版，横向缩略图及画布可用，无横向页面溢出；选中文字、正常/加粗提亮、半透明底色均可操作。
2. 将临时封面模块文字改为「手机排版验证」，完成后进入预览，标题与样式正确；下载的 PNG 为 1800 × 2400。切回排版仍保留选择、样式和撤销记录。
3. 把文字移到新一页，3 页变为 4 页，选中模块跟随新页。新页前插空白页后为 5 页，删除空白页后回到 4 页，页码连续。六次撤销恢复原 3 页、标题和样式。
4. 向第 3 页加入现有图片，拖动中心移动，右下角等比放大；进入裁切模式后拖动左边短线，原图不拉伸。四次撤销恢复原 3 页。
5. 恢复后再次进入预览，以原内容覆盖测试成品快照。重新加载仍为原 3 页；底部操作条在画布延伸到视口外时保持可见。
6. 为验证临时填写的封面设置「未命名故事」最终恢复为原空字符串。桌面原有 7 页草稿未操作。测试页签关闭、视口恢复。

截图：

- `/Users/yuandai/.codex/visualizations/2026/10/15/01a1402b-f1cb-72b2-a8d7-9746e3c11c30/mobile-module-actions.png`
- `/Users/yuandai/.codex/visualizations/2026/10/15/01a1402b-f1cb-72b2-a8d7-9746e3c11c30/mobile-module-crop.png`

## 验证边界

- 本轮拖动通过手机宽度浏览器的指针输入验证；真实 iOS/Android 触摸、软键盘、文件选择器、相册保存和系统分享目标面板尚待真机验证。
- 菜单测试为渲染与边界断言，完整 DOM 事件链由上述浏览器操作覆盖；未新增自动化 DOM 手势测试。
- 本机草稿与上传图片不跨设备同步；原手绘逐页画册不属于本次模块编辑迁移。未部署正式站。
