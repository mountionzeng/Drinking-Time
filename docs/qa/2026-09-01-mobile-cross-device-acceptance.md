# 手机跨端聊天与正文编辑验收记录

- 日期：2026-09-01
- 分支：`codex/mobile-cross-device-workspace`
- 入口：`/m`
- 当前结论：**代码可验收，生产发布 No-Go**
- 授权边界：本轮未部署、未申请/修改证书、未改生产 nginx、未连接或迁移生产 MySQL。

## 已验证的自动化范围

| 范围 | 证据 | 结果 |
|---|---|---|
| U0 迁移基线与一次性 MySQL harness | `pnpm migration:verify`、harness 单测 | 待最终验证命令回填 |
| U1 当前版本/平台 body-only CAS | publishing service/router tests | 待最终验证命令回填 |
| U7 Story 聊天 turn 幂等/恢复 | conversation service/router tests | 待最终验证命令回填 |
| U2 聊天本地恢复状态机 | mobile conversation store/hook tests | 待最终验证命令回填 |
| U3 正文恢复与冲突状态机 | mobile document store/hook tests | 待最终验证命令回填 |
| U4 仅“聊聊/正文”的手机 UI | 四个组件测试、320/360/390px 截图 | 待本地视觉验收回填 |
| U5 `/m` 路由、登录回跳、换账号清理 | router/auth/recovery tests | 待最终验证命令回填 |
| U6 生产配置、Cookie、Origin、CSP、部署 dry-run | U6 定向测试、shell `-n` | 待最终验证命令回填 |

自动化重点断言：

- 每个 Story 读写同时校验 `storyId + userId`，不使用 latest Story 写回退；
- 手机正文只改服务器返回的当前发布版本/平台 body，保留标题、标签、选择、其他平台和其他版本；
- target body 或 active scope 漂移失败关闭，手机本地正文与服务器正文都保留；
- 同一个 `clientTurnId + requestHash` 重试收敛，不重复模型调用或聊天消息；
- 未同步聊天/正文按账号、Story、版本/平台隔离，同账号续登恢复，换账号/退出清理；
- production 缺少真实认证、强密钥、HTTPS、utf8mb4 MySQL 或 CSP 白名单时拒绝启动；
- 生产 Cookie 为 `Secure`（可信 HTTPS）与 `SameSite=Lax`，unsafe `/api` 拒绝缺失/跨站 Origin；
- HTTPS 切换 dry-run 不写 nginx、证书、`.env`、PM2 或数据库。

## 本地视觉检查

| 视口 | 聊聊/正文 | 输入与保存可达 | 横向滚动 | 证据 |
|---|---|---|---|---|
| 320px | 待验证 | 待验证 | 待验证 | 待截图 |
| 360px | 待验证 | 待验证 | 待验证 | 待截图 |
| 390px | 待验证 | 待验证 | 待验证 | 待截图 |

本地浏览器检查只能证明布局和开发态交互，不证明真实手机键盘、Secure Cookie 或公网跨设备同步。

## 必须在获批环境完成的验收

| Origin 验收 | 真实环境步骤 | 当前状态 |
|---|---|---|
| AE1 账号与最近 Story | iOS/Android 用同一邮箱登录并返回 `/m`；另一个账号用已知 storyId 请求必须失败 | 待验证 |
| AE2 双向聊天 | 手机发一轮，电脑刷新只出现一次；电脑继续，手机刷新可见 | 待验证 |
| AE3 双向正文 | 手机保存后电脑刷新；电脑保存后手机刷新；核对全部 sibling 字段不变 | 待验证 |
| AE4 并发冲突 | 两设备从同一 bodyRevision 写不同正文，一个成功、一个冲突且两份文字可复制 | 待验证 |
| AE5 目标设备交互 | iOS Safari/Android Chrome：键盘、中文 IME、safe-area、横竖屏、长文、系统字号、断网/重连 | 待验证 |
| 持久性 | PM2 重启与 MySQL 备份/恢复后，已验收聊天和正文仍存在 | 待验证 |
| 迁移安全 | 生产 ledger/schema 与 U0 基线一致；expand/dual-read/enforce 和 rollback-safe point 有记录 | 待验证 |

## 发布判定

保持 **No-Go**，直到：

1. 获得远程部署、证书/nginx 和生产迁移的逐项批准；
2. 一次性 MySQL 两进程 race gate 真实执行通过；
3. 真实域名 `/healthz`、`/readyz`、HTTP 308、HSTS/CSP 和 Secure/Lax Cookie 通过；
4. AE1–AE5 与持久性均有真实设备/双设备证据；
5. 功能账本从 `observing` 提升前再次运行 `pnpm feature:validate`。
