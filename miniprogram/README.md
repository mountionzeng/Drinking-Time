# 拾光 · 微信原生小程序测试壳层

本目录是**微信开发者工具可运行的原生 mock 测试壳层**。

它**不是**：微信登录已完成、邮箱已绑定、手机和电脑已互通、真机已通过，或可提审／可发布的小程序。

权威计划：`docs/plans/2026-09-02-002-feat-wechat-miniprogram-test-shell-plan.md`（本轮只执行 U1–U3）。

---

## 现在能做什么

- 用微信开发者工具导入、编译、点开三页：启动页 → 隐私说明 → 演示工作区。
- 在工作区里选固定演示 Story、完成确定性的本地演示聊天、编辑并保存演示正文。
- 看到聊天未知结果、正文冲突、Story 切换脏草稿、transport 失败和恢复损坏各自的状态与出路。

## 现在一定不会做什么

- 不调用 `wx.login`、`wx.request`、`wx.uploadFile`、`wx.downloadFile`、`wx.connectSocket`
  （`tests/noRealWechatCalls.test.ts` 会装计数 stub 并断言调用次数为 0）。
- 不调用模型、不产生任何费用、不写 `.webdev/`、不碰远端数据库。
- 页面里没有图片、素材、分镜、时间线、预览、视频或 Story 创建入口。

---

## 导入开发者工具

```
/Applications/wechatwebdevtools.app/Contents/MacOS/cli open --project '<仓库根>/miniprogram'
```

工程用 `appid: "touristappid"`（公开占位／游客模式）。填入真实测试 AppID 不需要改任何业务源码：
只改 `project.config.json` 的 `appid` 一个字段。**换成真实 AppID 也不会离开 mock 模式** ——
`src/core/runtimeMode.ts` 里的 `LIVE_BACKEND_CONFIGURED` 仍是 `false`，要等 U4 的服务端会话落地才翻转。

`urlCheck` 保持 `true`。关掉合法域名校验只会让开发者工具「看起来能联网」，那是真机验收的伪证据。

## 目录结构

```
src/core/        纯 TypeScript 状态层（不引 React / DOM / localStorage / Node API / @shared）
src/services/    窄适配器：storage.ts 是唯一接触 wx 存储 API 的文件；transport.ts 是冻结的本地合同
src/pages/       三页：start（启动）→ privacy（隐私说明）→ workspace（聊聊 + 正文）
tests/           小程序自带的 Vitest 套件
```

状态层与页面之间隔着 `core/workspacePresentation.ts`：页面只做 `setData` 和转发点击，
所有对用户可见的文案、状态与可用性都在那里定，因此可以脱离微信运行时逐条断言。

## 自动化门禁

```
pnpm exec tsc -p miniprogram/tsconfig.json --noEmit
pnpm exec vitest run --config miniprogram/vitest.config.ts
```

小程序自带 `tsconfig.json` 与 `vitest.config.ts`。根 `pnpm test` / `pnpm check` **不覆盖本目录**，
别拿它们当小程序的通过证据。

---

套件里有几条是**守门测试**，不是普通单测：

| 文件 | 守的是什么 |
| --- | --- |
| `tests/projectSafety.test.ts` | 提交候选集合里的 Secret、私钥、高熵凭据、`api.weixin.qq.com` 直连、真实 AppID 外泄、私有配置未被 ignore |
| `tests/runtimeIsolation.test.ts` | `src/core/**` 与 `src/services/**` 不引 React / DOM / `localStorage` / Node API / `@shared`；`wx.*` 只出现在 `services/storage.ts` |
| `tests/noRealWechatCalls.test.ts` | 用会计数并抛错的 stub 换掉 `wx.login` / `request` / `uploadFile` / `downloadFile` / `connectSocket`，跑完真实页面的完整流程后断言计数全为 0 |
| `tests/workspacePresentation.test.ts` | 页面里没有范围外入口（图片／素材／分镜／时间线／预览／视频／新建 Story）；动作触控目标 ≥ 88rpx |

## 只能人工验收的部分

以下几项**不能**用状态机单测代替，必须在开发者工具里用真实输入法和真实布局逐项看：

- **中文 IME**：代码里有两层保护 —— `resolveSendIntent` 在 `composing` 时拒绝回车，
  以及微信 `<textarea bindconfirm>` 本身只在键盘发送键触发、不在候选词确认时触发。
  但小程序运行时**不暴露 composition 事件**，`composing` 只能靠页面的 focus/blur 近似维护，
  所以「打一半的中文按回车不发送」必须用真机或模拟器的中文输入法实测。
- 320 / 360 / 390px 等效宽度下的布局与关键动作可达性。
- 软键盘弹起缩小视口后，发送、保存、复制、冲突操作是否仍然够得着。
- safe-area（刘海屏／底部横条）下输入区是否被遮挡。
- 系统字号放大后动作按钮是否截断。

### 开发者工具验收清单

自动化跑完之后，这几条只能人眼看。逐条勾，留截图：

- [ ] 编译面板没有 error。
- [ ] 启动页顶部常驻「测试模式 · 未绑定真实账号」。
- [ ] 没看隐私说明时，「进入演示工作区」是禁用的；点它只弹提示，不跳转。
- [ ] 隐私页点「暂不同意」后仍然进不去；点「我已看过，同意」后才能进。
- [ ] 工作区能选两个演示 Story，「聊聊 / 正文」两个页签都能切。
- [ ] 发一条消息，得到「（演示回答，未调用任何模型）」开头的回复。
- [ ] 改正文点保存，状态从「有未保存的修改」变成「已保存」。
- [ ] 余额行显示「演示余额 ¥30.00」并随聊天下降。
- [ ] 用底部「演示状态开关」逐个切到：打开 Story 失败 / 聊天结果未知 / 聊天明确失败 / 正文冲突 / 余额不足，
      确认每种都有可读状态和出路（重试、查询结果、复制两份文本）。
- [ ] 正文有未保存修改时切 Story，弹出裁决面板；「放弃修改并切换」不是默认焦点。
- [ ] **中文输入法**：打一半中文按回车，不发送。
- [ ] 模拟器切到 iPhone SE(320) / 常见 360 / iPhone 12(390)，发送、保存、复制、冲突操作都够得着。
- [ ] 软键盘弹起后输入框不被遮挡；带刘海机型底部不被横条压住。
- [ ] 系统字号调大后，按钮文字换行而不是被截断。
- [ ] Network 面板全程没有请求；`.webdev/` 没有新文件；没有任何费用。
- [ ] 如果开发者工具生成了 `project.private.config.json`，确认 `git status` 看不见它。

## Secret 边界

AppSecret、`session_key`、服务端会话密钥、刷新凭据**永远不写进本目录、仓库、聊天或普通日志**。

以后接真实登录时，服务端需要的秘密只有变量名会出现在文档里，值由用户本人写入服务端秘密配置：

| 变量名 | 放在哪 | 谁来填 |
| --- | --- | --- |
| `WECHAT_MINIPROGRAM_APP_ID` | 服务端环境配置 | 用户本人 |
| `WECHAT_MINIPROGRAM_APP_SECRET` | 服务端秘密存储（**不是**本目录） | 用户本人 |

`tests/projectSafety.test.ts` 扫描 `git ls-files --cached --others --exclude-standard -- miniprogram`
的整个提交候选集合，拦截 Secret 赋值、私钥头、高熵凭据和 `api.weixin.qq.com` 直连；
并单独验证开发者工具生成的 `project.private.config.json` 确实被 ignore。

## 下一阶段（U4–U7，尚未开工）

真实 `code2Session`、Bearer principal、邮箱绑定、服务端适配、真机、合法域名、内容安全与发布门禁，
都要等统一账号线收口并重新登记文件所有权后另开阶段。
