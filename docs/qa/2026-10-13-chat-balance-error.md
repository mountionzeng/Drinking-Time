# 正式站聊天余额错误修复

## 原因
2026-10-13正式服务器 a03d32d8 的 drinking-time-error.log 中，截图文案对应的调用失败均为 ComputeAccessError(FORBIDDEN): 算力余额不足。storyReply.ts 的故事与发布聊天 catch 将这一可操作错误改成“刚刚卡了一下”的网络兜底；手机 durable turn 再将兜底存成 failureMessage，掩盖真实原因。

## 修复
- 两个聊天分支保留 ComputeAccessError 原类型与文案，普通供应商错误仍用原来的安全兜底，避免泄露网关详情。
- 手机 failed turn 显示真实余额提示及“我 → 算力余额”处理路径；保留输入与原 clientTurnId，恢复余额后允许显式重试，不生成重复消息。
- 不修改余额、付款、模型配置、数据库结构或已有用户内容。旧失败记录不批量改写；再次重试时更新为明确原因。

## 验证
- 新回归在旧代码上失败（故事/发布两项），修复后113项相关测试通过。
- 覆盖余额拒绝保真、手机错误持久化、恢复准入后同一轮次重试成功；既有重试、幂等与并发测试保留。
- 本地类型检查通过。生产部署采用仅后端构建，保留未发布手机UI与另一会话的落地页工作，不执行数据库迁移。

## 正式发布
- main已推送并部署 `e819f031909b923aa6a55634f67e29033ca62e77`，只替换后端bundle。
- 生产构建与本地验证bundle SHA256完全相同：`7b9143a698fe95aec06073a4a46e7939b0ee2f8ed9413a7011c1904da6cc39ff`。
- 程序、完整MySQL备份和回滚脚本：`/root/drinking-time-chat-error-20261013/`，root私有。`bash rollback.sh`只恢复代码/程序，不回灌数据库。
- `/readyz`返回ready/mysql/authentication required；真实HTTPS `/m`、`/editing` 均200；前端HTML与.env哈希不变。
- 没有调用付费模型或改写用户失败轮次。真实账号若仍无可用余额，仍会被正确拒绝；需补充余额后重试。
