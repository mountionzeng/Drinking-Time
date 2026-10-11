# 手机底部导航两套主题

按用户确认，取消当前页图标消失的交互；故事、聊聊、我三个入口始终显示，当前页提供 `aria-current="page"`、主题色及墨点标识，重复点击当前页不重新导航。

拾光沿用已有插画材质，重新组合为手工装订书、小忆、带人物标记的纸卡；保留纸纹底色，不沿用小程序的横枝/鸟窝导航构图。纳音使用打开的书、既有五行饮品、个人轮廓及浅色选中底。两套均有键盘焦点与按压反馈，减少动态偏好下禁用位移。

新增资产直接复制自本机 `shiguang-jiayi-hackathon/miniprogram/assets/illustrations/` 的 `capture-memoir-book.png` 和 `capture-note-paper.png`，原图未经修改；其余复用当前项目已有小忆与纸纹。素材副本位于 `client/public/shiguang/`。

导航与聊天浮层共享高度变量，包含底部 safe-area；避免原先固定64px偏移造成新导航遮住输入与发送按钮。

验证：

- `pnpm exec vitest run client/src/features/mobileWorkspace/MobileWorkspace.test.tsx client/src/features/mobileWorkspace/liaoliaoForms.test.ts`：24项通过；更新原有测试覆盖三页均保留三个可用入口与唯一当前页。
- 本地主仓3000浏览器：纳音“我”页高亮、切到拾光、依次打开故事和聊聊，三个按钮始终显示，图像均正常加载。
- 390×844：导航顶部755px，发送按钮底部746.4px，无遮挡。320px视口三项点击区域各约97×78px，无横向溢出。
- `pnpm check` 被并行文字来源工作中的两项错误阻挡：`server/repositories/textSourceLineage.ts` 的 `extensions` 类型与 `server/routers.textSourceLineage.test.ts` 的联合类型 `textDraftId` 访问。未修改这些文件，不能宣称全项目类型通过。
- 截图：`2026-10-11-mobile-nav-shiguang.jpg`、`2026-10-11-mobile-nav-nayin.jpg`。

未部署，未改业务数据，真实手机 safe-area 和系统字号仍待真机验收。
