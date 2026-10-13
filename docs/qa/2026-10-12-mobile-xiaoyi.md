# 手机常驻小忆 · 拾光第一套

2026-10-12，本地 main 工作区未提交、未部署。按用户“可以一个一个、先看草图”的节奏，已确认拾光小鸟草图，现接入 /m。纳音五种独立角色动效仍待逐个设计；纳音目前复用入口和展开收回，继续显示既有饮品图。

## 已接入

- 故事列表、故事详情、我页共享底部中央小忆，菜单前景遮挡小鸟下半身。
- 随机眨眼、笑眼、好奇、打盹、招手、转身；避免连续同动作，大动作权重低。进入聊天、切到后台、减少动态效果时停止随机动作，卸载清理计时器。
- 弹起和纸页展开／折回动画；Radix 模态焦点、Escape、外侧关闭，中文输入合成时不因 Escape 收起。视觉视口变化调整聊天框高度与位置。
- 独立新故事会话，打开不写库、不推理；第一句话才 storyUpsert，再经既有 durable mobile turn 生成和追加。不复用正在浏览的故事 ID，不影响旧正文草稿。
- 收起保留输入和进行中的轮次；恢复会话按账号存储。刷新后恢复未发草稿但不自动重发。另聊一个仅在无待发、无进行中、无未同步轮次时允许；账号切换/退出清理新故事恢复键。
- 新建响应不确定时不自动重试，保留文字并提示先检查列表。既有 storyUpsert 无客户端幂等创建 token，仍可能留下一个空故事；本轮不扩大后端契约。

## 验证

- `pnpm check`。
- `pnpm exec vitest run client/src/features/mobileWorkspace/newStorySession.test.ts client/src/features/mobileWorkspace/MobileNewStoryCompanion.test.tsx client/src/features/mobileWorkspace/MobileChatView.test.tsx client/src/features/mobileWorkspace/MobileWorkspace.test.tsx client/src/features/mobileWorkspace/mobileRecoveryIdentity.test.ts client/src/features/mobileWorkspace/useMobileConversation.test.tsx`。
- 3000 浏览器实际可见视口 422×774：从“我”切拾光，回故事，角色位于菜单中间；点开显示新故事问候；填入验收草稿、收起、重开逐字保留，随后清空测试草稿；无发送、无创建故事、无模型调用。截图 `2026-10-12-mobile-xiaoyi-open.jpg`。
- 两个已存在服务 3000/4321 均指向主仓同一数据文件；本轮没有新增服务或修改业务数据。

## 仍待验收

- 真机软件键盘、safe area、中文 IME、减少动态效果系统设置。
- 新故事首条真实供应商请求及跨设备同步，本轮未制造测试故事/调用付费模型。
- 表情帧有轻微形体变化，属于用户确认的首版角色动作素材，尚非逐帧精修动画。

## 美术来源

用户提供 `codex-clipboard-31a89237-8351-455c-9dc0-d08633899604.png`，在前几轮使用内置 imagegen 生成：
- expressions：2×2，保持原小鸟身体、叶子、水彩纸张纹理，仅正常眼／闭眼／笑眼／好奇眼。
- wave：2×2，同一小鸟的四分之三朝向、抬翅、挥翅和正面；不加文字与人类手指。

原始生成图位于当前线程 generated_images 的 `exec-2688651f-7c9c-4a67-aa87-54e2462a7492.png` 和 `exec-393f31a6-bc7f-42b5-87bc-56ef4cbd20e4.png`。WebP 优化素材已随代码存入 `client/public/shiguang/companion/`，运行时不依赖线程目录。

## 纳音五套动效追加（2026-10-12）

- 复用现有 EmotiveWuxingIcon 饮品、五官与手脚，不修改共享图标或导航视觉。
- 金：举手弹跳；木：舒展轻摆；水：左右探看；火：活泼点头；土：慢慢伸展。每隔 6.5–13 秒选一次表情，2.4 秒后回到静止，连续动作不重复。
- 每种饮品有独立的开合倾角、侧移和时长；终点固定在聊天顶部/原菜单位置。隐藏页面、打开聊天和减少动态效果时暂停随机动作；卸载清理计时器。
- `pnpm exec vitest run client/src/features/mobileWorkspace/nayinCompanionMotion.test.ts client/src/features/mobileWorkspace/MobileNewStoryCompanion.test.tsx client/src/features/mobileWorkspace/newStorySession.test.ts`：20 项通过。
- `pnpm check`、`pnpm feature:validate`（55 cards）、`git diff --check` 通过。
- localhost:3000/m 实际 UI 逐个选择五种外形，确认 launcher 的实际角色对应 metal/wood/water/fire/earth；椰子入口实际打开新故事聊天。没有发送消息或创建测试故事。截图：`docs/qa/2026-10-12-nayin-companion.jpg`。
- 未部署；尚未做真实手机逐帧动画与低性能设备流畅性验收。

### 咖啡杯藏在菜单后（2026-10-12）
- 默认下移44px，仅杯口和蒸汽露出；随机2.4秒动作弹出、摆动后落回，打开聊天恢复完整角色。
- 本地 `/m` 确认杯身/五官被导航前景遮挡；等待真实随机计时器后观察到 data-playing=true；截图 `docs/qa/2026-10-12-coffee-peek.jpg`。
- `pnpm check` 通过；本轮仅视觉调整，未发送消息、未部署。

### 另外四种角色隐藏待机（2026-10-12）
- 仅调整 companion CSS：金/木/水/火下藏深度分别62/38/54/52px，关键帧起止回到对应深度，咖啡杯维持已确认的44px。
- 本地 UI 逐一检查泡沫、茶面/热气、椰顶/吸管、壶盖/热气的露出范围；木水火截图见 `2026-10-12-peek-wood.jpg` / `2026-10-12-peek-water.jpg` / `2026-10-12-peek-fire.jpg`。
- 实际等待茶壶随机探头后点击入口，新故事聊天正常显示，data-docked=false，角色回到完整显示状态；没有发送消息。
- `git diff --check` 与功能账本校验通过；仍未部署，真实手机流畅性待验收。

### 顶部“我”入口与移除底栏（2026-10-12）
- 用户明确要求移除截图中的故事/我整条底栏，把我移到故事页右上角原新故事位置。
- MobileNavBar 改为一个顶部按钮：故事→我、我→返回故事；故事详情仍沿用返回列表。
- 六种角色共享底部中央锚点，小弧面替代旧整条菜单的遮挡，角色继续可点击并随机探头。
- `pnpm check` 通过；MobileWorkspace/MobileNewStoryCompanion/newStorySession 32 项回归通过；本地纳音与拾光往返导航及底栏消失已验证。未发消息、未部署。
