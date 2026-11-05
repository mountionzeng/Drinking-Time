# 2026-11-04 本地编辑器白屏

用户在主仓 `http://localhost:3000/editing` 看到整页白屏，无法操作。

## 根因与修复

`vite.config.ts` 在 `a7c3fde0` 改为按 command 返回配置的函数，用于保留开发插件并避免生产注入 inline runtime。`server/_core/vite.ts` 仍直接展开导入值，函数展开后没有 root、resolve、publicDir 或 plugins。Vite 因而从仓库根查找前端文件；健康检查及 HTML 返回200，但 `/src/main.tsx`、`/src/index.css`、`/stale-module-reload.js` 均404，React没有挂载。

现在先以 `command: serve, mode: development` 调用共享配置，再应用既有嵌入式服务选项。生产插件策略保持原有行为。只修复开发启动接线，没有修改用户稿件、生产服务或配置。

## 验证

- 新增 `server/_core/vite.test.ts`，使用真实的函数配置并拦截 createServer，断言 client 根目录、publicDir、路径别名、React及发布标识插件和嵌入式接线；修复前失败于 root 为 undefined，修复后通过。
- Vite接线、SPA回退、Manus生产插件策略、发布标识和旧页保护共19项通过；完整 TypeScript 检查通过。
- `pnpm feature:validate`（81卡）、`pnpm env:check`及差异空白检查通过。
- 修复后上述3个资源以及 `/app-release.json` 均200；主仓唯一3000服务自动重载，无第二个开发服务。
- 原白屏标签刷新后显示《launch video》、既有聊天、36个模块（含6个图片模块）与已保存状态。实际点击发送菜单出现“分享文章”，Esc收起；没有发送消息、改写正文或触发生成。浏览器没有错误日志。
- 截图：`/private/tmp/editor-white-recovered-20261104.png`。

本次未提交或部署；保留其他会话未提交修改。
