# 微信注册 10 算力与零余额闸门

日期：2026-09-13

## 决策

用户选择微信账号始终独立。微信身份不合并到已有邮箱账号，电脑端通过五分钟一次性短码进入同一微信 userId。

## 行为

- 每个 App 作用域微信身份在成功登录时幂等获得 10 算力（按 ¥1 = 2 算力，对应 5,000,000 微元、可抵扣 ¥5 实际模型费用）。
- 稳定幂等键只保存微信 subject 的 SHA-256，不把 openid 原文写入账本。
- 旧微信账号会在下一次成功登录补领，重复登录不重复赠送。
- 微信小游戏可用余额为零时，聊天生成和重新解读来信返回 `insufficient_balance`。
- 余额为零仍可登录、签发电脑短码、浏览故事、读取和保存正文、编辑来信文字。

## 自动化证据

- `server/integration/wechatAccount.mysql.test.ts`：并发首次登录收敛到一个 userId、一笔赠送和 10 算力（¥5）余额；重复登录不重复赠送。需配置 `TEST_MYSQL_DATABASE_URL` 执行。
- `server/_core/minigameWorkspace.test.ts`：零余额拒绝 AI，同时正文读写继续成功。
- `minigame/src/workspaceClient.test.ts`：客户端显示“算力余额已用完，故事仍可查看和编辑”。
- `server/services/wechatAccount.test.ts`：微信 code 验证与失败关闭保持不变。

## 发布边界

网页版和所有供应商调用尚未全部接入预留、结算与失败释放。本轮只把微信小游戏明确暴露的 AI 入口加上零余额闸门，不能宣称全站计费已完成。
