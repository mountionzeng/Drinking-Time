# 朋友分享回来提醒：发布与收尾验收 — 2026-10-20

## 原发布记录

- 功能提交 `18b16238` 已推送 main 并部署；此前生产应用为 `6b23c6d8223550ea7822bd39f21343236315bde5`。
- 范围：新增需登录的 `storyContextShare.shareBackInbox`；桌面故事菜单红点及最多 3 条回传列表；手机故事页“朋友分享回来的”卡片及未读标记；英语、法语文案。客户端不接收贡献者 userId、token、requestHash。
- 当时普通测试 654 文件／5,582 项通过，17 个 MySQL 文件／64 项跳过；未配置 `TEST_MYSQL_DATABASE_URL`，该次发布未跑独立 MySQL 集成测试。
- TypeScript、生产构建、32 条迁移基线（最新 0031）、功能账本校验、环境门禁通过。
- 相比 `6b23c6d8` 无数据库结构或迁移差异；未修改数据库、`.env`、nginx 或证书。
- 使用 dist 的 `public`、`index.js` 发布包，两端 sha256 一致；PM2 `drinking-time` 重启后 online。
- 当次备份：`/opt/Drinking-Time/dist.bak-20261020133750-18b16238-public`、`/opt/Drinking-Time/dist.bak-20261020133750-18b16238-index.js`。
- 当时 HTTPS `/`、`/editing`、`/readyz`、入口 `/assets/index-Byhx0tvS.js` 均返回 200；未登录的收件箱返回预期 401，错误日志仅有常规缺少会话 cookie 记录。
- 本地和服务器临时发布文件已清理。
- 同日后续应用发布及回滚点另见[共同探索发布记录](2026-10-20-exploration-release.md)。以上是提醒功能当次发布历史，不应据此判断服务器当前源码版本；本轮没有重新部署或执行服务器 `git pull`。

## 环境收尾

- 首先执行 `pnpm env:status`：只有主仓库 main，只有主仓端口 3000 的一个 dev server（检查时 PID 88024）。
- `git worktree list --porcelain` 仅有主仓；`drinking-time-layout-cocreation`、`drinking-time-share-back-inbox` 两个同级目录及对应本地分支均不存在，无需再次删除。
- `git merge-base --is-ancestor 18b16238 main` 通过。保留另一项工作的 `codex/situated-writing-exploration` 分支；本轮未做跨分支合并或删除。
- 开始时 HEAD 为 `a7a91fce`，与本地 origin/main 引用一致，但工作区已有处境探索相关改动，包括功能账本的其他卡片。此次只补本 QA 和 `shared-story-collaboration` 卡片，不覆盖那些改动。
- 未操作 stash，`mobile-release-20261013-before-merge` 保持原样；未启动额外 dev server，未改 `.env`、数据库迁移、nginx、证书。
- 收尾 `pnpm feature:validate` 通过（64 张功能卡），`git diff --check` 通过；再次 `pnpm env:status` 仍为主仓单服务。逐卡比较确认其他功能卡与本轮修改前完全一致。

## 正式站真实双账号验收

- 正式站 `https://www.drinkingtime.top`，复用两个 Chrome 配置的真实登录身份；通过登录接口在浏览器内比较身份摘要，确认 A、B 不同。未导出会话 cookie、身份原值或分享令牌。
- A 新建虚构测试故事 109，手写标题“共创提醒验收·雨后书店·20261020”和正文，保存后创建允许协助改写的文字分享。未导入历史本机草稿，未调用付费生成。
- B 从分享页点击“拿来一起改”，得到独立副本 110；编辑、保存正文，再点击“分享回给作者”，收到成功提示。
- A 登录收件箱返回 200，测试故事出现 `text` 通知；通知字段仅为 `id`、`storyId`、`storyTitle`、`kind`、`authorName`、`createdAt`，递归检查未发现 userId、contributorUserId、token、requestHash。
- 桌面实际出现红点和“1 个朋友分享回来的新版本”无障碍说明；展开故事菜单后红点消失，但文字提醒仍在。点击条目打开故事 109，原稿仍含“作者 A 的原稿”，没有被 B 的正文替换。
- 手机在 390×844 浏览器视口出现“朋友分享回来的”卡片及“新”标记，无横向溢出；打开对应故事后可在文字版本中看到“和朋友一起改的 · 待采用”。看过后刷新，卡片仍在、未读标记为 0。
- B 在手机图文制作中双击文字模块，改成独立的“朋友 B 的整页排版验收”内容，经“预览／导出”完成一页排版，再点击“把排版分享回给作者”。成功后 A 收件箱同时出现 `layout` 和 `text`。
- A 桌面菜单同时列出排版、文字两条提醒；手机卡片同时列出两条，新排版有红点，先前文字保持已读。
- A 打开排版候选并明确点击“忽略”，排版候选消失，收件箱仅剩文字；随后预览朋友文字并点击“保存新版本”，候选标记“已采用”，收件箱不再包含故事 109 的提醒。刷新手机故事页后卡片消失。
- 测试故事 109、110 保留供继续体验：A 的文字已采用，排版已忽略。仅处理本轮创建的虚构内容。

本机截图位于 `/tmp/share-back-reminder-20261020/`，未包含分享链接或登录令牌：

- `desktop-unread.png`、`desktop-menu-seen.png`：桌面红点和已读菜单。
- `mobile-unread.png`、`mobile-layout-and-text.png`：手机文字未读、新排版与已读文字并列。
- `desktop-layout-and-text.png`：桌面两类提醒并列。
- `author-original-preserved.png`、`friend-candidate.png`：原稿保留与待采用候选。
- `friend-layout.png`、`layout-candidate.png`：朋友排版回传和作者处理入口。
- `text-adopted.png`、`mobile-cleared.png`：采用文字后提醒清空。

## MySQL 测试记录核对

- 本轮进程和项目环境文件均未配置 `TEST_MYSQL_DATABASE_URL`，因此本轮未重跑 MySQL 集成测试。未将正在监听的本地 MySQL 当成测试库，也未借用正式库凭据。
- 已提交的[同日后续发布记录](2026-10-20-exploration-release.md)记载：包含本功能的后续版本已在隔离临时 MySQL 实例中跑完 17 文件／64 项，全部通过；测试账号仅可操作 `drinking_time_test_%`，结束后实例已停止。
- 据此补齐“已有后续集成证据”，保留“提醒功能原发布时未跑、本收尾轮未重跑”的事实，不把文档核对写成本轮新测试结果。

## 已知缺口（Known gaps）

- 原“正式站双账号提醒链路待验收”已由上述文字和单页文字模块排版的真实回传闭环补齐。手机验收使用浏览器视口，不等同于真机触控验收。
- 本轮实际同时出现 2 条提醒；最多 3 条的实现限制未做 4 条以上生产压力验收。
- 排版回传本轮通过手机预览出口完成；桌面模块编辑态回传按钮处于禁用状态，桌面回传出口、多页与含图片排版仍未完整验收。
- 已读状态仍仅存当前浏览器 localStorage（`dt:share-back-seen:${userId}`），不跨设备同步；该限制未修改。
- 收件箱仍只扫描作者最近更新的 40 篇故事；该限制未修改。
- 部分正式站读取或写入需要等待数秒至十余秒；本轮未重放未知提交，不将刷新后可见等同于实时推送。

## 按用户要求核对推送与线上部署

- 用户要求推送、部署一起完成，之后自行用两个账号体验。本轮未再次操作测试账号。
- 远端 main 已确认包含收尾提交 `70521c6d`。生产源码 HEAD 为 `edab6d44`，与本次提交仅相差功能账本及两份 QA 文档，应用源码、依赖、迁移完全相同；没有在服务器执行 `git pull`。
- 从 `70521c6d` 的干净 Git 归档构建成功，未带入本地处境探索改动或环境文件；未另开 dev server。
- 本机构建与服务器 dist 均为 95 个文件，逐文件 SHA-256 全部一致，无新增、缺失或不同文件。正式站已运行本次目标应用，因此发布核对为“目标版本已部署，无需重复替换”；本轮没有上传相同运行包或重启 PM2，不把核对记录写成一次新的包替换。
- 后端 `dist/index.js` SHA-256：`0a1105a52693da41305e8fbeac09ec484e03ef1e9c7ccb5d374f938c090c1199`；公网 HTML 和入口 `index-Byhx0tvS.js` 也与本机构建一致。
- PM2 `drinking-time` 为 online，入口 `/opt/Drinking-Time/dist/index.js`；readiness 为 `mysql`、`authentication: required`。公网 `/`、`/editing`、`/m`、`/healthz`、`/readyz` 均 200，收件箱未登录仍为预期 401。
- `feature:validate`（64 卡）、环境门禁再次通过。沿用同一应用源码已有的测试结果，不重复声明本轮执行过全套或 MySQL 测试；未修改数据库、环境变量、nginx、证书及既有回滚点。
