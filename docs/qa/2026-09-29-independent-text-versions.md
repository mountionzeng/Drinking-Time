# 独立文字版本与表达技巧学习：交接及验收

日期：2026-09-29。状态：observing；本地实现，未发布。

## 已确认的边界

用户已确认独立文字版本，不与成品图文/视频组合版本混为一体。需求稿中 R14/R15 的实施前版本问题已解决，以本记录为补充；不再等待旧会话的“Option A”。

本轮接通两个学习过程：用户明确标注自写/认可的原文用于提出假设，实际采用稿及修改反馈用于后续校正。模型每次重新评估证据，不训练模型权重，不把生成本身当作认可。

## 实现与使用

- 聊天输入框下“生成新版本”：旧稿 + 新增/修改对话 + 尚未发送的输入框文字。每次明确点击生成完整新候选。
- “文字版本”面板：设置材料来源、回看历史、编辑候选、填写反馈，再明确“采用这一版”。采用写入当前平台发布正文，不自动生成媒体或成品组合。
- 面板编辑采用前仅暂存在页面；切换版本和关闭时提示。采用或生成完成的数据由后端持久化，刷新可读回。
- 技巧库：`server/services/writingTechniqueLibrary.ts`；提示词：`server/services/textDraftPrompt.ts`。卡片为编辑性归纳，有作者、作品和来源链接、适用/避用场景、强度及原创示例。
- API：`textDrafts.read/generate/adopt/setLearning`，全部通过登录身份校验故事归属。
- 历史存储：Story body 的服务端字段 `textDraftHistory`。保留原文、候选、采用稿、来源版本、对话范围、实际提示词和模型标签。

## 验证范围

定向测试覆盖：首次生成与重放、并发认领、未知结果不重提、旧稿加新增对话、原始样本与采用反馈分离及停用、跨用户隔离、普通保存不能注入/覆盖学习记录、发布修订冲突、成品已引用快照不变、编辑稿依据选择。

浏览器在主仓库 `localhost:3000/editing` 验证了普通聊天输入框下的按钮与文字历史面板、来源选择器。没有对真实用户故事点击付费生成或采用。

已通过：8个定向测试文件共153项、`pnpm check`、`pnpm build`（有包体积提示）、`pnpm feature:validate`（47张功能卡）。全量回归中的聊天意图组件4项失败由新增RPC组件的测试依赖导致，已隔离子组件并在定向21项测试中全部复测通过。

首次全量 `pnpm test --maxWorkers=2`：545文件通过、2文件失败、11文件跳过；4707项通过、5项失败、57项跳过。除上述4项外，架构门禁发现新增服务引用旧 `db.ts` 兼容层，已改为直接引用 `repositories/stories`。修复后复测失败文件及新服务，3文件61项全部通过；没有再重跑整套15分钟的全量测试，不将首次结果描述为全绿。

验证命令：

```sh
pnpm check
pnpm feature:validate
pnpm exec vitest run server/services/textDraftHistory.test.ts client/src/features/publishingDraft/textDraftBasis.test.ts client/src/features/publishingDraft/TextDraftVersions.test.tsx server/services/storySync.publishing.test.ts server/services/publishingDraft.test.ts server/services/publishingPersistence.test.ts server/routers.publishingDraft.test.ts client/src/features/storyAgent/StoryAgentContext.intentRecognition.test.tsx
```

## Code Review Results

Scope：本轮文字版本相关改动；未审查或改写其他会话的头像、首次引导、应急路由工作。
Mode：autofix。遵守项目规则，由主线程顺序检查正确性、测试、维护性、权限、接口、持久化及异步UI边界，无子代理。

### Applied Fixes

- 采用前检测发布修订；若成品引用当前快照，先建立新工作稿，防止历史成品文字被覆盖。
- 普通故事保存不能写入伪造的文字学习历史；样本读取再次校验用户归属。
- 新故事尚无提示词谱系时允许正常生成，直接读取可空聚合，不错误吞掉权限或存储异常。测试使用真实聚合读取，仅模拟模型。
- 使用最新读取的候选作为默认依据；切换故事/平台后不把延迟响应写入当前编辑状态。
- 测试样本改用完整类型对象；聊天意图测试隔离新版本组件的RPC依赖。
- 按架构门禁使用故事仓库接口；持久化对话在写入历史前校验长度与结构，防止保存后无法读回。

Residual actionable work: none identified in the reviewed scope. 以下是验收边界，不宣称已验证。

### Coverage

- 未做付费模型真实调用，测试不证明事实保真和文学质量；需用真人稿件对照评价。
- 未验证 MySQL 模式、跨进程竞争及真实浏览器多轮生成/采用交互。
- 学习只接入新独立版本入口；每次按相同平台检索最近100个故事、最多各6份原始/采用证据，不是无限记忆。
- 每故事最多100次生成记录、5MB正文上限；超限明确报错，不静默截断或删除旧稿。

---

> Verdict: 本地实现待真实内容验收；未部署。

## Post-Deploy Monitoring & Validation

发布后由发布者在首轮试用及24小时内检查 `textDrafts.generate/adopt` 请求错误、CONFLICT比例与长时间 generating/unknown 状态；日志不得复制用户正文。健康信号：一个token一个候选、采用前发布正文不变、采用后刷新可恢复、跨账号不可读。

若出现重复模型提交、跨用户证据或历史成品被改写，立即停用新按钮/路由并保留历史数据供排查，不清空用户故事。真实试用需单独授权模型费用；不要以未获得结果为由自动重发。
