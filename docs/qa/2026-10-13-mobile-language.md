# 手机界面语言与字体

## 范围

- 我 → 我的语言，位于我的日历之前；中文 / English / Français 原生名称始终可辨识。
- 显式 React 文案翻译，作用域为 `/m` 的语言 Provider（含 Portal 弹层）。共用组件在桌面未提供 Provider 时仍为中文；不改接口参数、回忆、作品正文或聊天内容。
- 选择立即更新并保存在当前浏览器；同源标签页通过 storage 事件同步。存储不可用时仍可在本次打开期间切换。退出手机页面恢复 document lang 和字体作用域。
- 手机通用标题、按钮、正文采用本地 Noto Serif SC（Mobile Reading）；Logo 保留 Honglei Zhuoshu。纳音五种主题与拾光共享排版规则，作品画布的自选字体不改。
- 字体从已有 OFL 资源按 Unicode 切分，保留原字体 30,928 个码点（含法语重音），界面字集约 262 KB，其余按需加载。脚本：`scripts/generate-mobile-reading-font.py`，需要 Python fontTools。

## 验证

- `pnpm check` 通过。
- `pnpm exec vitest run client/src/features/uiLanguage/UiLanguage.test.tsx client/src/features/mobileWorkspace client/src/features/publishingAlbum/PublishingImagePack.test.tsx client/src/pages/PersonalMemoryPage.test.tsx`：24 文件 154 项通过。
- `pnpm build` 通过（已有 bundle 大小提示）。
- 本地主仓 3000：390×844 下三语切换，英文刷新后保留；法语首页及回忆阶段导航已翻译，故事名和聊天原文保持中文；页面 scrollWidth=390，未横向溢出。
- 页面 computed font：普通标题、语言弹层标题、三个选项均为 Mobile Reading；字体字形检查覆盖中文、English、Français 及 éèêàâçîïôùûüœÉ。
- 没有提交付费生成或修改用户业务内容；未部署。

## 边界

- 偏好保存在浏览器，不是账号级跨设备设置。
- 服务器返回的自由文本诊断、生成内容以及历法专有名词保持来源文本；本轮未接入模型输出语言控制。电脑全工作区没有接入此语言入口。
- 真机 iOS / Android 和法语母语审校尚待验收。
