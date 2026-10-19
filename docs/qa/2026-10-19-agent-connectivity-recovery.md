# 2026-10-19 正式站 Agent 连接恢复

用户授权立即修复并上线。本次是生产配置修复，应用继续运行 `e448b6ff141953b9b988f0689eddb7a840627640`，没有发布新代码或执行数据库迁移。

## 已确认原因

- 正式站未配置 `OPENAI_NEXT_API_KEY`，因此已有的 Next 首选路由没有候选，聊天落到 302。
- `BUILT_IN_FORGE_API_URL` / `DROP_ZONE_API_URL` 指向 `https://api.302.ai/v1`。生产日志连续出现 Claude 网络失败、未知提交停止重放，以及截图中的“没接住”兜底；服务器无凭据请求也连接失败。
- 已配置的国内地址 `api.302ai.cn` 可连通，但用相同凭据及原模型 `claude-opus-4-7` 实际请求返回 HTTP 500：`Permission denied, this model has been disabled.` 模型目录中存在该名字不代表可用。
- 国内地址探测曾出现一次 ENOTFOUND，后续三轮解析成功；不声称外部 DNS 永久稳定。

## 修复与上线

复用项目已有的 Next 配置和凭据，只在正式站补齐 `OPENAI_NEXT_API_KEY`、`OPENAI_NEXT_BASE_URL`、`OPENAI_NEXT_TEXT_MODEL`，恢复设计中的 `gpt-5.6-terra` 首选通道。密钥不进入仓库或报告。其余环境项逐项比较一致，保留原应用、账号权限、数据库、正文、聊天和计费规则。

- 发布互斥锁已取得；其他项目会话无进行中的合并/部署。
- 配置备份：生产 `/root/drinking-time-agent-20261019/before.env`，权限 0600；同目录 metadata.json 记录变更键、前后摘要与应用版本。
- 生效调用：`t-wl070h21caau1a8`，Success / exit 0，PM2 正式应用重启后 ready。
- 回滚只需在部署锁内核对 metadata 与当前配置后恢复 before.env 并重启原 PM2 应用；不回滚数据库。原配置已知无法聊天，除非新配置发生更严重问题，不应回到故障配置。

## 验证

- 切换前真实模型返回“连接正常”（HTTP 200，17.9 秒）；切换后从正式 `.env` 读取配置进行虚构聊天，HTTP 200，2.7 秒返回自然回答。
- 正式站 `/readyz` 返回 MySQL + authentication required，`/healthz` 返回 ok。
- 浏览器新建独立虚构验收故事，真实发送后获得自然回复、记忆卡片及正常故事标题，等待队列正常清空；算力从 5.00 更新为 4.67。既有用户故事未用于测试。
- 同一独立故事输入虚构正文后，左侧显示“正在聊右侧这篇文字”；真实发送修改建议问题，收到自然建议，队列清空，未生成或采用版本。截图：`/tmp/agent-fix-20261019/browser-recovered.jpg`。
- 功能账本校验通过（64 张功能卡）。
- 定向回归 5 文件 84 项通过：agentChannel、textComputeProvider、inferenceBilling、desktopChatQueue、writingCompanion。
- 本次没有代码/依赖/schema 变更，不重复生产构建和数据库集成测试。

## 保留边界

旧失败队列仍需用户复制、核对并移出失败项后继续或重新发送；没有自动重放未知结果，也没有修改历史算力预占。302 旧备用端点和被禁用的模型仍是失效备用通道，本次恢复依靠已验证的 Next 首选。未声称手机真机或所有供应商任务已验收。
