# 微信网页登录修复（2026-10-26）

## 原因与修改

用户在 https://www.drinkingtime.top/login 看到两个微信入口。LoginPage 的旧 LoginMethodTabs 只高亮“目前仅支持邮箱登录”，不执行登录；AuthEntryPanel 又渲染实际的 WechatCodeLogin。删除旧占位标签与过期提示，两种主题都只通过 AuthEntryPanel 提供登录。

生产 create 接口带合法 Origin 返回 404 disabled。服务器 WECHAT_SCAN_LOGIN_ENABLED 未设置；drinkingTimeBridge 的 WEB_LOGIN_CONFIRM_ENABLED 也未设置。先通过云控制台补后者 true，再备份服务器 .env、补前者 true 并更新 PM2 环境。原有桥接 URL、密钥、章节开关均保留。没有数据库迁移、账号合并或故事导入。

## 验证与发布

- 回归测试先复现两种主题的重复占位入口，删除后 LoginPage、AuthEntryPanel、WechatCodeLogin 共 16 项通过；服务端 webLogin 的 11 项测试也通过（共 27 项）。
- 正式 Chrome 登录页生成六位码，真实微信开发工具会话在“我的 → 登录电脑”输入并确认，微信显示“已确认，电脑网页会自动登录”；浏览器自动进入编辑页、显示 15.00 算力。
- 没有提交出生资料，没有导入浏览器未归属旧草稿，没有编辑故事；测试后退出本次 Chrome 登录。原 IAB 登录保留。
- 发布前从实际线上提交 5cc9f0cf 独立归档构建，94 个前端文件与生产逐一 hash 一致，再仅替换 LoginPage.tsx 重建。主仓 HEAD b633d191 包含不同代码，未直接部署主仓或其未提交内容。
- 增量发布 index.html、assets/index-CSH72CsU.css、assets/index-gh5DctaJ.js。全部上传摘要核对后原子替换 HTML，保留旧哈希资源。无后端源码替换。
- 应用回滚：/opt/Drinking-Time/dist.bak-wechat-login-20261026-index.html；清单：dist.release-wechat-login-20261026.json。配置备份 .env.bak-wechat-login-20261026（仅服务器保留）。

- 发布后 Chrome 刷新正式 /login，实际 DOM 仅一个“使用微信登录”，旧导航和过期提示均消失。截图保存在任务 outputs/wechat-login-20261026/login-fixed.png。功能账本验证通过（67 卡）。

## 范围

已验证电脑 Chrome + 微信开发工具中的真实账号确认。手机浏览器当前仍提示在电脑使用微信登录，并非微信内网页 OAuth；不声称真机扫码登录已验证。本轮不修改邮箱、Google、已有配对码能力或账号归属规则。
