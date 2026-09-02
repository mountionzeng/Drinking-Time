---
date: 2026-09-02
topic: wechat-miniprogram-test-shell-execution
status: planning-complete-ready-for-agent-execution
branch_observed: codex/mobile-cross-device-workspace
scope: native WeChat Mini Program U1-U3 test shell under miniprogram only
authoritative_plan: docs/plans/2026-09-02-002-feat-wechat-miniprogram-test-shell-plan.md
---

# 交接：执行微信原生小程序 U1–U3 测试壳层

## 一句话任务

不要重新规划产品，也不要接真实微信登录。直接按
`docs/plans/2026-09-02-002-feat-wechat-miniprogram-test-shell-plan.md`
执行 U1–U3：在独立的 `miniprogram/` 目录建立微信原生 TypeScript 工程、Story／聊天／正文恢复状态机，以及醒目标识为 mock 的“聊聊 + 正文”双视图测试壳层。

本交接完成时，仓库里仍然**没有任何小程序实现代码**，也没有为小程序修改服务端、数据库或账号系统。现有成果只有权威计划与本交接文档。

本轮交付的准确名称是：**微信开发者工具可运行的原生 mock 测试壳层**。它不是微信登录完成、不是邮箱绑定完成、不是真机跨端完成，也不是可提审或可发布的小程序。

---

## 一、用户已经确认的方向

1. 使用微信原生小程序和官方 TypeScript 工程形态，不使用 `web-view`、Taro 或 uni-app。
2. 第一批只做已有 Story 选择、“聊聊”和发布工作台当前版本／当前平台正文。
3. 不带入图片、素材、分镜、时间线、预览、视频、Story 创建或支付能力。
4. 测试壳层完成后，下一阶段才通过微信服务端会话和邮箱验证码显式绑定现有账号。
5. 真实接入时必须继续使用 Web 端同一个 `userId`、Story、聊天、正文和余额，禁止建立小程序专用业务库或平行账号。
6. 测试 AppID 与正式 AppID 的 openid、Secret、session 和数据库环境完全隔离；正式号以后用正式库的已验证邮箱重新解析用户，禁止迁移测试库数字 `userId`。

### 本轮完成标准

- 微信开发者工具能导入、编译并操作工程。
- 启动页始终显示“测试模式／尚未绑定真实账号”。
- 用户先看到最小隐私说明，再进入完全本地的演示工作区。
- 可选择固定演示 Story，完成确定性的本地演示聊天，编辑并保存演示正文。
- 聊天未知结果、重复点击、迟到结果、Story 切换、正文冲突和恢复损坏都有明确状态与测试。
- mock 数据无隐私、无真实账号、无网络请求、无模型调用、无费用、无 `.webdev` 或远端数据库写入。
- 页面中没有本轮范围之外的图片、素材、分镜、时间线、预览、视频或 Story 创建入口。

---

## 二、接手前必须阅读

按顺序阅读：

1. `AGENTS.md`：主仓／worktree、3000 端口、数据文件和功能账本铁律。
2. `docs/handoff/SESSION-BOARD.md`：确认当前文件所有权并登记 `miniprogram/**`。
3. `docs/features/feature-ledger.json` 中：
   - `mobile-cross-device-chat-document`：当前 `observing`；
   - `account-compute-gift-payments`：当前 `planned`，另一个 Agent 正在实施；
   - `recent-story-entry`、`story-ownership`、`project-ownership`：不得削弱的既有合同。
4. `docs/plans/2026-09-02-002-feat-wechat-miniprogram-test-shell-plan.md`：本轮唯一权威计划，只执行 U1–U3。
5. `docs/plans/2026-09-01-001-feat-mobile-cross-device-workspace-plan.md`：Web 手机端的产品和持久化基线。
6. `docs/qa/2026-09-01-mobile-cross-device-acceptance.md`：窄屏、键盘、中文 IME、冲突和复制恢复的验收语言。
7. `docs/environment-guide.md`：本地数据机制和环境事故史。

开工第一批只读检查：

```bash
pnpm env:status
git status --short --branch
pnpm feature:validate
```

2026-09-02 交接时观察到：

- 主仓：`/Users/yuandai/Documents/New project/drinking-time-local`
- 分支：`codex/mobile-cross-device-workspace`
- 只有主仓的 3000 端口在运行，PID 39022；环境状态为健康。
- 主仓存在大量统一账号 Agent 的未提交修改。
- `docs/plans/2026-09-02-002-feat-wechat-miniprogram-test-shell-plan.md` 与本交接目前是未提交文档。

这些只是交接时快照，不是永久事实；接手 Agent 必须重跑检查。不要重启、杀掉或另开 3000 服务。

---

## 三、文件所有权和冲突边界

### 新 Agent 唯一拥有的实现路径

- `miniprogram/**`

包括独立的：

- `miniprogram/project.config.json`
- `miniprogram/tsconfig.json`
- `miniprogram/vitest.config.ts`
- `miniprogram/src/**`
- `miniprogram/tests/**`

### 必须由主仓当前协调者完成的登记

- `docs/handoff/SESSION-BOARD.md`：开工登记和收工销号所需的最小行级修改。

建议登记内容：会话名“微信原生小程序测试壳层”，分支／worktree 写实际值，所有权写“仅 `miniprogram/**`；不占账号、服务端、数据库或功能账本文件”。登记和销号都以**主仓当前的实时会话板**为准，由主仓当前 board owner／协调 Agent 写入；小程序 worktree 不修改、不提交自己的 `SESSION-BOARD` 副本。如果当前 owner 尚未完成登记，执行 Agent 必须停在代码修改前，不能跳过登记。

### 本轮禁止触碰

- `docs/features/feature-ledger.json`（统一账号 Agent 当前正在修改；只能由明确的单一 owner 建卡或更新状态）
- 根 `package.json`
- 根 `tsconfig.json`
- 根 Vitest 配置
- `client/**`
- `server/**`
- `shared/**`
- `drizzle/**`
- `.webdev/**`
- 统一账号计划、迁移、邀请码、账本、认证和部署文件

统一账号 Agent 留下的 MySQL 隧道、`dt_test` 测试账号、远端测试文件和邀请修复备份也不属于本线；不要安装本地 MySQL、关闭隧道、删除测试账号或清理远端文件。

另一个 Agent 当前还在修改 `server/db.ts`、账号／auth／production readiness、迁移、根配置、功能账本和会话板。不得格式化、覆盖、还原或顺手提交这些改动。

禁止使用：

- `git reset --hard`
- `git checkout -- <path>` 清理他人修改
- `git clean`
- `git add -A` 或无差别提交整个脏工作树

提交时只暂存本会话真正拥有的文件。

### 功能账本门禁

原生小程序是持久用户能力，最终需要功能卡。但当前 `docs/features/feature-ledger.json` 的 owner 尚未释放：

- U1–U2 可以继续纯 `miniprogram/` 脚手架和状态测试。
- **开始 U3 前**，必须由当前 ledger owner 建立或扩展准确的 `planned`／`observing` 卡；未完成时在 U2 后停止，不得进入 U3。
- 未取得账本所有权时，新 Agent 不得自己编辑 ledger。
- 只有 mock 代码和开发者工具证据时不得标记 `working`。

交给当前统一账号 Agent／ledger owner 的协调请求可以直接写成：

> 请为“微信原生小程序测试壳层”建立或扩展功能卡：状态保持 `planned`／`observing`，owner 仅指向 `miniprogram/**`，证据引用 002 计划和本交接；known gaps 明确保留真实微信登录、邮箱绑定、服务端、真机、跨端、合法域名和发布。请勿把 mock 壳层标记为 `working`。

---

## 四、推荐的执行隔离方式

主仓现在很脏，推荐为小程序建立独立 `codex/` 分支和 worktree，只在其中修改 `miniprogram/**`。注意：权威计划和本交接尚未提交，因此新 worktree 可能看不到它们；接手 Agent 应从上述主仓绝对路径只读打开这两份文档，不能误用外层 `New project` 仓库里的旧快照。

worktree 中：

- 可以编写代码、运行独立 TypeScript/Vitest 测试。
- 禁止启动 dev/preview server。
- 禁止写 `.webdev/` 业务数据。
- 始终只读主仓的实时 `SESSION-BOARD`；不修改或提交 worktree 中的陈旧副本。
- 不在统一账号 Agent 正做跨分支收敛时自行 merge。

实现提交后，先确认当前没有其他会话在做合并，再合回主仓；合并后才从主仓导入微信开发者工具做最终可视验收。合并完成后立即删除 worktree 和临时分支。若其他会话正在合并，则保留小程序分支和 worktree，只汇报“自动化完成、待唯一 merge owner 接管”；此时不得宣称开发者工具最终验收通过，不得销号，也不得删除 worktree。

如果用户要求直接在主仓执行，也仍必须严格只改 `miniprogram/**`，并且只暂存自己的文件。

---

## 五、本轮已经做出的技术裁决

### 1. 小程序使用独立测试配置

根 `vitest.config.ts` 的 include 当前不覆盖 `miniprogram/tests/**`，根 `tsconfig.json` 也不覆盖 `miniprogram/**`。因此：

- 新建 `miniprogram/vitest.config.ts`。
- 使用 `miniprogram/tsconfig.json` 覆盖源码和测试。
- 不为方便测试去修改根配置或根 `package.json`。
- 不得声称普通 `pnpm test` 或 `pnpm check` 已经覆盖小程序。

### 2. 状态层是纯 TypeScript，不复制浏览器代码

参考但不要直接 import：

- `client/src/features/mobileWorkspace/mobileConversationStore.ts`
- `client/src/features/mobileWorkspace/mobileDocumentStore.ts`
- `client/src/features/mobileWorkspace/mobileRecoveryIdentity.ts`
- `client/src/features/mobileWorkspace/MobileWorkspace.tsx`

它们提供产品合同，但依赖 React、DOM、浏览器 `Storage` 或 `@shared`。小程序状态层必须是纯 TypeScript，通过窄适配器注入微信 storage／lifecycle；不得引用 React、DOM、`localStorage` 或 Node-only API。

### 3. 先冻结小程序本地 transport 合同

U3 在 `miniprogram/src/services/transport.ts` 定义最小请求、响应、错误、turn 幂等、正文 revision 和余额摘要合同；mock transport 必须完全实现该合同。当前不得为了“共享”去新建或修改 `shared/**`。U6 以后由账号／服务端文件释放后的 Agent 把同一语义提升为真正的跨端共享合同。

### 4. mock 阶段保留最小隐私页，但绝不调用真实登录

本轮按权威计划保留隐私页和版本化同意状态，目的是把“同意先于 `wx.login`”做成可测试边界。U1–U3 无论用户是否同意，都不得真正调用 `wx.login`、邮箱验证码、Story API 或任何远端接口；同意后只进入明确标识的本地演示工作区。

### 5. 恢复作用域必须不透明且可注入

状态和 storage 接口接收不透明 `recoveryScope`，不能用邮箱、openid、微信昵称或客户端 `userId` 推导。mock 可使用固定、无隐私、明确只属于演示环境的 scope；未来 live 模式必须由服务端返回稳定 scope，不能把 mock scope 沿用为真实身份。

恢复限制对齐现有手机 Web 合同：7 天 TTL、每类最多 8 条、每条／总量上限按现有 256KB 边界实现并测试；畸形、过期或超量数据必须安全清除，不得阻断启动。

### 6. 关键 UI 状态不能只存在测试或内部枚举里

mock 工作区至少需要让用户看懂：

| 区域 | 状态 | 可用动作 |
| --- | --- | --- |
| 聊天 | idle / pending / unknown / synced / error | 发送、等待、按同一 turn 查询、重试 transport；unknown 不新建第二次生成 |
| 正文 | clean / dirty / saving / conflict / error | 编辑、保存、复制本地／服务端两份、放弃或继续；冲突不自动覆盖 |
| Story | loading / empty / selected / switching-dirty | 选择、取消切换、保留当前草稿或明确放弃 |
| 隐私 | unseen / accepted / rejected / withdrawn / stale-version | 查看说明、同意、拒绝、撤回；未同意不能越过未来真实身份门 |
| transport | mock-ready / mock-failure | 明确显示演示状态和重试；禁止静默切换成看似真实的成功 |

所有主要操作提供可读标签和状态，触控目标不小于 44×44px；系统字号放大后不能截断关键动作。页面／弹层切换和异步结果应有合理的焦点与状态提示。

---

## 六、权威实施顺序

### U1 — 原生工程与 Secret 安全边界

目标：微信开发者工具能识别工程，且从第一天阻止 Secret 和私有配置进入提交。

必须创建：

- `miniprogram/project.config.json`
- `miniprogram/.gitignore`
- `miniprogram/README.md`
- `miniprogram/tsconfig.json`
- `miniprogram/vitest.config.ts`
- `miniprogram/src/app.ts`
- `miniprogram/src/app.json`
- `miniprogram/src/app.wxss`
- `miniprogram/src/sitemap.json`
- `miniprogram/src/typings/wechat.d.ts`
- `miniprogram/tests/projectSafety.test.ts`

要求：

- tracked 配置只允许公开占位 AppID 或经用户确认的测试 AppID。
- `project.private.config.json`、构建产物、临时 npm 目录和任何 Secret 文件必须被忽略。
- 安全测试以 `git ls-files --cached --others --exclude-standard -- miniprogram` 的候选集合为准，并单独验证开发者工具生成的 private 配置确实被 ignore；扫描具体 key/value 赋值、私钥头、高熵凭据和真实接口拼接，允许测试 fixture 中明确标识的假值。不要因为 README 或测试中出现 `AppSecret`、`session_key`、`openid` 这些安全术语就误报通过或失败。
- 占位 AppID 下必须进入醒目的 mock 模式，不能尝试真实交换。

### U2 — Story、聊天、正文与恢复状态

目标：不依赖 React、DOM 或浏览器存储，建立可测试的跨运行时状态机。

必须覆盖：

- 稳定 turn／message identity 和 request hash。
- pending → unknown → status lookup → synced；unknown 不重建 turn、不二次“生成”。
- 正文 clean／dirty／saving／conflict，携带 version／platform／body revision。
- Story A 的迟到结果不能渲染到 Story B。
- `onHide` 不承诺网络保存；`onShow` 不覆盖 dirty 正文。
- 退出／账号 scope 变化先清理旧恢复记录，再渲染新状态。
- 损坏、过期、超量恢复记录安全清理。

先写状态测试，再实现状态转移；UI 点击测试不能替代这些行为证据。

### U3 — “聊聊 + 正文”mock 双视图壳层

目标：让用户在开发者工具里实际操作完整最小界面，同时始终知道它没有连接真实账号和数据库。

必须覆盖：

- 启动页、隐私页和工作区。
- 固定无隐私 Story 与确定性 mock transport。
- “聊聊”“正文”双视图和演示余额。
- 空 Story、transport failure、恢复损坏和正文冲突状态。
- 中文 IME composition 期间 Enter 不发送。
- 快速重复点击只有一个 pending turn。
- 320／360／390px 等效宽度、safe-area 和键盘缩小视口下，发送、保存、复制、冲突操作可达。
- 页面始终显示 mock 标识；不得伪造真实微信身份、费用或保存成功。

做到 U3 后立即停止。U4–U7 涉及真实 `code2Session`、Bearer principal、邮箱绑定、服务端、迁移、余额和合法域名，必须等统一账号 Agent 收口并重新登记文件所有权后另开执行阶段。

---

## 七、自动化和开发者工具验收

### 自动化门禁

```bash
pnpm exec tsc -p miniprogram/tsconfig.json --noEmit
pnpm exec vitest run --config miniprogram/vitest.config.ts
git diff --check -- miniprogram
git diff --cached --check -- miniprogram
```

提交后再运行 `git show --check --stat HEAD`，并核对
`git diff-tree --no-commit-id --name-only -r HEAD` 的每个路径都属于
`miniprogram/**`。会话板由主仓 owner 单独处理，不进入小程序实现 commit。

测试必须安装会抛错并计数的微信身份／网络 API stub，至少覆盖
`wx.login`、`wx.request`、`wx.uploadFile`、`wx.downloadFile` 和
`wx.connectSocket`。走完隐私拒绝、同意、聊天、保存和 transport 重试流程后，
断言这些调用全部为 0；最终报告写“应用代码未调用”，不能只凭开发者工具面板未观察到请求。

另外重新运行：

```bash
pnpm env:status
git status --short --branch
pnpm feature:validate
```

`pnpm feature:validate` 只证明功能账本结构合法；若 ledger owner 尚未建立小程序卡，它不能证明小程序已登记或可用。

### 微信开发者工具验收

本机已安装：

- App：`/Applications/wechatwebdevtools.app`
- CLI：`/Applications/wechatwebdevtools.app/Contents/MacOS/cli`

合回主仓并取得必要的 GUI 权限后，可从主仓打开：

```bash
/Applications/wechatwebdevtools.app/Contents/MacOS/cli open --project '/Users/yuandai/Documents/New project/drinking-time-local/miniprogram'
```

记录以下证据：

- 编译无 error。
- 启动页明确显示“测试模式／尚未绑定真实账号”。
- 未同意隐私说明不能进入未来身份流程；同意后只进入本地 mock。
- 可选择演示 Story、进行演示聊天、编辑／保存演示正文。
- 余额明确标为演示数据。
- 没有范围外入口。
- 没有网络请求、`.webdev` 写入、远端数据库写入或模型费用。
- 320／360／390px 与键盘场景下关键动作可达。

中文 IME、320／360／390px、键盘缩小视口和 safe-area 是人工视觉／交互验收，
逐项记录结果并保留截图；不能用状态机单测替代真实输入法和布局证据。

开发者工具可能生成私有配置；确认它已被 ignore，不得暂存或提交。

最终报告只能写“开发者工具 mock 壳层通过”。不得写“微信登录已完成”“邮箱已绑定”“手机和电脑已互通”“真机已通过”或“可以发布”。

---

## 八、AppID、Secret 和平台状态

- U1–U3 不需要 AppSecret，也不以真实 AppID 为阻塞。
- 如果开发者工具导入确实需要真实测试号信息，只向用户索取：**AppID** 与**小程序名称**。
- AppID 可以出现在客户端公开项目配置中，但必须确认它属于测试号还是正式号。
- 绝不能要求用户把 AppSecret、`session_key`、服务端 token、支付密钥或证书发到聊天里。
- AppSecret 以后由用户本人写入服务端秘密配置，绝不进入 `miniprogram/`、仓库、日志或本交接。
- 用户扫码成功、浏览器已登录微信开发者社区或公众平台，都不能单独证明已经取得可用测试 AppID。
- 微信后台的实名、扫码、付款、最终提交和敏感配置由用户本人完成；不得绕过平台安全限制。

---

## 九、授权边界与必须停手的条件

### 可以直接做

- 只读研究现有代码和文档。
- 仅在 `miniprogram/**` 内创建本地代码、类型、测试和 mock 数据。
- 不调用远端、不产生费用的本地测试。

### 遇到以下任何一项必须停止并告诉用户

- 需要修改 `client/**`、`server/**`、`shared/**`、`drizzle/**` 或根配置。
- 需要修改当前 owner 未释放的 `docs/features/feature-ledger.json`。
- 需要真实微信 `code2Session`、AppSecret、邮箱验证码或账号绑定。
- 需要远端数据库、域名、服务器、部署、备案或公众平台配置变更。
- 需要真实模型、内容安全或任何付费调用。
- `SESSION-BOARD` 已有人占用 `miniprogram/**` 或出现文件重叠。
- 为运行测试必须启动第二个 dev server 或在 worktree 写 `.webdev`。
- 发现当前计划与统一账号已落地的接口产生实质冲突。
- 当前有其他会话进行跨分支合并：只保留已提交的小程序 worktree 和自动化证据，等待唯一 merge owner；不得自行合并、主仓验收、销号或清理 worktree。

停手时给出具体文件、冲突原因和下一步建议，不要自己越界绕过。

---

## 十、收工要求

1. 小程序实现 commit 只包含本会话拥有的 `miniprogram/**`；会话板由主仓当前 owner 另行登记和销号。
2. 汇报 TypeScript、Vitest、Secret 扫描和开发者工具结果。
3. 列出所有未验证项：真实 AppID、真实登录、邮箱绑定、服务端、真机、跨端、合法域名、内容安全和发布。
4. 由明确的 ledger owner 更新功能卡：只有自动化和开发者工具证据时保持 `planned`／`observing`。
5. 运行 `pnpm feature:validate`。
6. 在 `SESSION-BOARD` 销号，并在“最近落地”记录提交号、能力和触达文件。
7. 若用了 worktree，确认无其他会话正在合并后合回主仓，并立即删除 worktree 和临时分支。
8. 不清理或提交账号 Agent、用户生成资产及其他未跟踪文件。

---

## 十一、可直接交给下一 Agent 的开场提示词

> 请在 `/Users/yuandai/Documents/New project/drinking-time-local` 项目中执行
> `docs/handoff/2026-09-02-wechat-miniprogram-test-shell-execution-handoff.md`。
> 权威计划是
> `docs/plans/2026-09-02-002-feat-wechat-miniprogram-test-shell-plan.md`，
> 本轮只做 U1–U3。开始前完整阅读 `AGENTS.md`、`SESSION-BOARD` 和交接文档，
> 先运行 `pnpm env:status`、`git status --short --branch`、`pnpm feature:validate`，
> 然后登记会话所有权。你唯一拥有的实现路径是 `miniprogram/**`；不要修改或提交
> 统一账号 Agent 正在改动的根配置、功能账本、客户端、服务端、shared 或 drizzle 文件。
> 在 `miniprogram/` 内自带 TypeScript/Vitest 配置，完成原生 mock 测试壳层、自动化测试和
> 微信开发者工具验收；不得调用真实 `wx.login`、模型、远端数据库或任何付费服务。
> 做到 U3 后停止，汇报证据和 U4–U7 的阻塞项，不要自行越界接真实账号。

---

## 交接结论

这条小程序线已经具备可直接执行的 U1–U3 范围、文件所有权、状态合同、测试方法和停止条件。新 Agent 不需要重新讨论原生还是 `web-view`，也不需要等待 AppSecret；只要严格把实现限制在 `miniprogram/**`，就能与统一账号 Agent 并行而不发生代码冲突。
