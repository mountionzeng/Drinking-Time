# DK 小游戏迁移

用户明确选择小游戏运行时，AppID `wxd6aeb0bc3a031d39`。`src/game.ts` 是保留的 mock；`src/liveGame.ts` 是独立真实接口入口。Canvas/微信键盘复用手机版保存、恢复、纳音主题和后端权威，不是 web-view。

## 真实手机版工作区（测试站已部署，未完成真机验收）

`node minigame/scripts/build.mjs --live` 构建独立的 `src/liveGame.ts` 入口。
`node minigame/scripts/smoke-live.mjs` 检验构建产物（wx/网络替身，不是真机验收）。
默认不带参数仍构建原 mock，二者不混用。

live 提供原邮箱密码和验证码登录、故事切换/新建、正文编辑与 CAS 保存、聊天历史与 durable turn 恢复、余额、每日来信阅读/原话修改/幂等重读，以及出生资料保存。原五行图标从 Web 组件渲染，纳音仍按原两日规则切换。
老用户请先用原邮箱登录，再关联微信。未关联的微信独立登录会创建独立账号；若已占用则返回需要合并，不自动转移身份、故事或余额。
2026-09-09 AppSecret已由官方接口验证并安全配置到测试站，服务器 `WECHAT_MINIGAME_LOGIN_ENABLED=true`。已用 `--live --wechat` 构建含微信按钮的包，替身冒烟与38项专项通过，但真实wx.login登录仍待用户扫码验证，不能把凭据有效等同于完整登录成功。

尚未完成：邮箱注册、微信绑定新邮箱、链接码、两个已有账号合并；每日来信自动迎面、气息/相关故事布局和生日滚轮仍与新版手机版有差异。真机键盘、安全区、跨端内容尚待验证，不能宣称100%还原或正式发布。

2026-09-08 测试站已在 `33b5cc8` 基线上叠加11文件服务端增量，保留 Web 静态资源哈希。2026-09-09 用户明确批准后，含微信登录的工作区预览包上传成功（620.8KB），二维码已展示；仅预览，未提审或正式发布。真实微信登录与原故事关联仍待用户验证。

发布条件与现场只读检查见 `docs/qa/2026-09-08-minigame-live-auth.md`。

构建：`node minigame/scripts/build.mjs`。运行入口测试：`node minigame/scripts/smoke.mjs`。从仓库根目录执行；脚本通过 Git 定位主仓依赖，不依赖硬编码本机路径。开发者工具导入 minigame/。

验证：`node minigame/scripts/smoke-live.mjs`、`vitest run --config minigame/auth.vitest.config.ts`、`tsc -p minigame/live.tsconfig.json --noEmit`。根 tsc/test 不覆盖全部小游戏目录，不能替代这些专项检查。替身冒烟不调用真实账号或 AI；服务端真实隔离链见 `server/_core/minigameWorkspace.test.ts`。

后端账号适配需与已有认证工作区协调，共用原服务端身份与数据库，不向 Canvas 客户端放入 AppSecret。
