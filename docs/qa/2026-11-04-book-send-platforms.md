# 书稿发送平台入口恢复

日期：2026-11-04。状态：主仓 3000 本地验证完成，未提交、未部署。

## 需求与已有能力

用户要求点击现有“发送”后，先选择小程序、朋友圈或其他平台，并按各平台格式准备内容。沿用现有按钮位置，不增加常驻工具栏按钮。

已有 `shared/publishingDraft.ts` 的六平台注册表、X 加权字数规则与 `publishingCoverExport.ts` 图片导出，以及 `ChapterWorkspace` 的章节投递流程。本轮将这些能力接回书稿“发送”菜单；没有切换当前写作平台或调用 AI 改稿。

## 本轮行为

- 第一层：小程序、朋友圈、其他平台、分享文章链接；收件箱/发回仍受原投递能力控制。其他平台在同一菜单内展开，可返回。
- 平台导出先保存当前草稿；保存失败不导出旧稿。按账号、故事和章节隔离导出快照，切换后关闭预览并取消过期结果。
- 社交文案移除标题、加粗标记，保留可读文字、标题和全文；不附带媒体 URL。数学公式保留 LaTeX 源码，社交平台纯文本不保证公式排版。X 按已有加权 280 字限制分条编号，超过 8 条提示调整或使用全文链接，不静默截断。
- 所有文章插图按顺序准备，包括重复引用和各自裁切。按平台比例等比放置、留纸色边，保留原有裁切范围；一次最多 9 张，任一图片失败不提供缺图分享。
- 弹窗支持本次分享文案编辑、复制、单张或整组图片下载，以及浏览器支持时的系统分享。编辑分享副本不修改原稿；发布到第三方平台仍由用户操作。
- 原有图文文章链接分享保留。小程序选择只打开准备面板，由用户明确点“生成故事链接”才开始创建，仍沿用原图片上传和权限规则。

| 平台 | 配图规格 |
| --- | --- |
| 朋友圈 | 1080 × 1080，1:1 |
| 小红书 | 1080 × 1440，3:4 |
| Instagram | 1080 × 1350，4:5 |
| X | 1600 × 900，16:9 |
| LinkedIn | 1200 × 627，1.91:1 |
| 抖音 / TikTok | 1080 × 1920，9:16 |

## 自动化验证

- 36 项专项通过：`BookSendMenu.test.tsx`、`bookPlatformExport.test.ts`、`ChapterWorkspace.test.tsx`、`publishingCoverExport.test.ts`、`prepareBookShare.test.ts`、`bookShareArticle.test.ts`、`SharedBookContent.test.tsx`、`publishingDraftFlow.test.ts`。
- 覆盖菜单平台与关闭态小程序、渲染不发送、当前草稿保存与失败阻断、无媒体 URL 文案、X 字数/全文保留、六平台规格、重复图片/裁切/独立文件名、图片失败和取消。
- `pnpm verify:draft-safety`：76 项通过。
- `pnpm check`、`git diff --check`：通过。

## 主仓浏览器验证

在独立后台标签页使用现有文章 launch video（36 模块、6 图）；没有操作用户正在使用的视频标签页。

- 第一层四项与其他平台五项及比例显示正确。
- 朋友圈：文案无裸露 `**`；6 张预览图片全部加载完成，实际尺寸均为 1080 × 1080。
- 小红书：6 张预览图片全部加载完成，实际尺寸均为 1080 × 1440。
- 复制文案、下载配图和系统分享按钮可用；本轮未点击这些动作，未向外部发送或发布内容，未购买生成。
- 截图：`/private/tmp/book-send-platform-menu-20261104.png`、`/private/tmp/book-send-moments-20261104.png`、`/private/tmp/book-send-xiaohongshu-20261104.png`。

## 保留缺口

- 本机 `chapterDelivery.status` 未启用，菜单显示禁用的“小程序 · 暂未启用”。没有修改开关、生产配置或云函数；跨端收发、数据库并发和对象过期清理继续沿用 chapter-delivery 账本缺口，不认定完整交付。
- 第三方平台真实发布、手机系统分享和相册保存未验收；六平台自动化规格验证不等于全部平台真机验收。
- 本轮平台导出是文字加对应比例静态配图；不生成视频，不替代保留图文顺序、标题/加粗/公式的文章链接阅读页。

## 环境与账本收尾

- `pnpm feature:validate`：81 张功能卡通过；更新 publishing-workspace、mobile-artwork-production-sharing 与 chapter-delivery，后者仍为 partial。
- `pnpm env:status`：只有主仓端口 3000 服务，环境健康。
- `pnpm env:check` 的 tsx 启动受沙箱 IPC 权限限制；用 `node --import tsx scripts/env-status.ts --check` 执行同一脚本通过环境门禁。
- 本轮范围已从会话看板释放；其他会话未提交改动保留，未做跨分支合并、push 或部署。
