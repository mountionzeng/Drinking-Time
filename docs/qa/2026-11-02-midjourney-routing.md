# Midjourney 通道路由修复

用户明确接管授权仅限 imageGen.ts 的MJ通道路由及对应测试。其他助手的重试、冷却、提示词退款及页面修改保持原样。

## 证据与原因

- 302官方普通提交 `/mj/submit/imagine` 标价0.05PTC，Turbo提交 `/mj-turbo/submit/imagine` 标价0.1PTC，Relax提交 `/mj-relax/submit/imagine` 标价0.02PTC；查询同样区分路径。
- 原代码为正式图添加--turbo，使用Turbo估价，但提交和查询始终走普通/mj/；这与当前文档不同，但不能单凭文档差异断言它是既有过载的根因。后续实测发现生产使用旧api.302ai.cn网关，它不支持专用速度路径，见下方续验。
- 文档：https://doc.302.ai/160578879e0.md、https://doc.302.ai/329176688e0.md、https://doc.302.ai/329176693e0.md、https://doc.302.ai/235701263e0.md。
- 既有V7 Draft任务自10月29日停在49%；两种认证请求头均查到该状态，不能把请求头或模型版本当作已确认根因。没有取消或重提该任务。

## 最小变更

- 文档列出的api.302.ai/api.302ai.com网关按速度参数选择通道：Turbo→mj-turbo，Relax→mj-relax，Draft/Fast→mj。旧api.302ai.cn及自定义网关保留原/mj/路径与速度参数，避免假设所有网关都实现专用路径。模型版本、提示词、费用算法不变。
- 非普通通道的持久回执带 `mj-turbo:` 或 `mj-relax:` 前缀；同一回执在恢复查询时解析出通道与供应商原任务号。旧无前缀回执仍按普通通道查询，不根据当前生成选项猜测历史通道。
- 未改其他助手的安全重试、冷却和退款逻辑；未改UI模型选择；未执行新付费请求。
- 新回执需要本次解码逻辑：回退应用前必须保留或回补通道解码，不能让旧后端拿带前缀回执直接请求普通通道。

## 验证

- 测试先红：9个定向用例中6失败、3通过，失败原因是Turbo/Relax提交路径、恢复路径及回执通道缺失。
- 修改后7文件264项通过：imageGen、imageProviderHealth、imagePromptRefund、storyAgent路由、publishingDraft路由、publishingAlbumBackgroundGeneration、computeRequestAccess。
- 覆盖四种速度模式，排队受理后只提交一次，超时保留同通道回执、持久化回调失败保留回执、旧/新任务恢复不POST，以及既有过载/未知提交/退款回归。
- TypeScript、76张功能卡检查和diff空白检查通过。真实供应商出图仍需另行授权验收，不能把mock通过视为上游过载已恢复。

## 首轮发布与线上复核

- 沿用本对话已有上线授权，基于已上线快照独立构建；源代码只替换imageGen.ts及对应测试。其他会话的所有基线文件哈希保持不变。
- 精确发布快照类型检查、构建和7文件264项测试通过。首次快照测试因未带本机.env缺少文本模型配置有6项失败；使用假测试Key与test.invalid地址满足mock前置配置后264项通过，未复制真实凭据、未调用真实模型。记录在`/tmp/mj-routing-release-20261102/{tests.log,tests-configured.log,tsc.log,build.log}`。
- 已上线后端发布`mj-routing-20261102`；SHA256为`64c85e75c441bafa3c0ad2f9f080d108d530eb1cd7705873fba22ca7390d17c9`。115项产物全部校验一致，仅`dist/index.js`变化；前端仍为`6dd8d506-7d0f-480a-9a1b-487a69db366f`，服务器.env、package.json、锁文件未变。
- PM2在线、MySQL readyz和服务器HTTPS证书校验通过，重启后新增错误日志字节为0；发布锁已释放。独立复查115产物与readyz通过。
- 原后端和可兼容新回执的回退包保存在`/opt/Drinking-Time/dist.bak-mj-routing-20261102/`。回退应使用`index.compatible.js`，不可直接用`index.original.js`覆盖新回执解码；回退包仅在旧后端加入通道解码，3项历史/Turbo/Relax恢复测试通过。本轮未触发回退。
- 正式站Chrome打开虚构故事“纸船与灯塔·20261024”，从文字模块菜单进入“文字生成图片”，默认Midjourney，显示1.36算力；停在生成前，余额仍3.86。截图`/tmp/drinkingtime-mj-routing-online-20261102.png`。章节顶栏旧封面弹窗仍显示既有任务超时，未覆盖/重提历史任务。
- 本轮无新付费提交、未换模型，尚不能宣称真实出图/自动插入/刷新闭环成功。此前单次付费授权已使用，需要新的单次授权才能继续真实出图验收。
- 未commit或push；本轮部署不包含其他会话未发布的书转视频入口改动。

## 授权单次线上验收与旧网关兼容修正

- 用户随后明确允许线上一次、最多1.36算力。仅点击一次“生成图片”，返回`302 Midjourney submit HTTP 404`，没有出图。截图`/tmp/drinkingtime-mj-routing-404-20261102.png`。新标签读取账户余额仍为3.86，原文与已保存状态完整，见`/tmp/drinkingtime-mj-404-balance-20261102.png`；未再点击、未切换模型。
- 生产使用`api.302ai.cn`；首轮补丁没有覆盖该旧网关兼容性，是本次新增404的原因。用既有任务只读核对：普通/mj/查询200、旧任务仍49%；专用/mj-turbo/返回HTML 404，两种认证头相同。文档列出的`api.302.ai`在生产服务器超时（ETIMEDOUT），`api.302ai.com`亦超时。没有改域名、DNS、代理、凭据或发新POST。诊断摘要位于`/tmp/mj-routing-release-20261102/{channel-readonly.log,host-diagnosis.log}`。
- 已追加旧网关/自定义网关兼容修正：沿用原/mj/路径与速度参数；官方当前网关保留专用速度路径，历史及带通道回执均保留恢复逻辑。只修改imageGen.ts和对应测试，其他助手重试/冷却/退款未变。
- 先红：新增3项网关用例中旧.cn/自定义2项失败；修正后主仓与精确发布快照均7文件267项通过，快照类型检查及构建通过。产物补丁仅增加网关能力判断；记录在`/tmp/dt-mj-legacy-20261102/`与`/tmp/mj-legacy-release-20261102/`。
- 已上线`mj-legacy-gateway-20261102`，后端SHA256 `61b0b69809241ca86be83371dec088c986aa17addddcd2947ec34185acd0cb68`。115产物核对、PM2/HTTPS/readyz通过，新增错误日志0；前端与配置不变。备份`/opt/Drinking-Time/dist.bak-mj-legacy-gateway-20261102/`保留可解码新回执的回退包。
- 当前结论：草稿校验已能通过；本次真实出图失败，新增404的网关兼容性已修正上线。既有MJ过载/旧任务长期49%仍未解决，不能声称文生图闭环成功。单次授权已使用，不在这份授权下再提交，也不自动切更贵模型；继续验收须新授权或供应商可用通道的新证据。
- 已在同一虚构故事的另一标签中只选择GPT Image 2备用以核对费用，报价“1张·预估2.86算力”，未提交。仅该弹窗选择变化，产品默认仍MJ。费用高于本次1.36授权上限，等待新的费用授权；截图`/tmp/drinkingtime-gpt-fallback-quote-20261102.png`。

## 不付费续查：同版本任务对照与模块恢复缺口

- 用户选择继续MJ、不付费；本轮仅GET既有任务和临时副本mock测试，没有新的供应商POST、换模型或部署。
- 同一生产凭据、旧网关普通查询均200：任务1792849794968528为SUCCESS/100%，submit→finish约54.5秒；任务1793283359107274仍IN_PROGRESS/49%、finishTime=0、无图片。两者均为`--ar 3:4 --draft --v 7`。这否定“换成V7即可修复”的充分性，也说明该旧任务的49%来自上游状态；不能据此证明所有新任务不可用或把它等同于当前模块的404请求。摘要`/tmp/mj-legacy-release-20261102/existing-task-comparison.log`。
- 新确认的独立应用缺口：`BookModuleConvert.tsx:157`提交后只把submitted存在组件内；`:175`收到providerTaskId时仅判断错误分支，没有保存或恢复动作。`ChapterTextModules.tsx:304`关闭弹窗会卸载组件，重开恢复初始submitted=false，重新显示付费生成按钮。
- 服务端`storyAgent.ts:1756`的generateForMobile输入没有模块任务令牌/恢复参数；`:2555`调用generateMobileImage未接onMidjourneyTaskAccepted持久回调；`:2565`只在错误响应转交providerTaskId。现有resume302MidjourneyTask调用位于封面/画册路径，模块路径没有接入，不能用顶栏“恢复上次生成”代替恢复模块任务。
- 临时副本新增两项诊断用例均按预期失败：①已受理超时后没有恢复按钮；②同模块关闭重开后又出现“生成图片（1.36算力）”。全部调用为mock，未调用模型，未编辑主仓组件或受保护测试。文件`/tmp/mj-legacy-release-20261102/src/client/src/features/publishingAlbum/BookModuleConvert.mj-diagnostic.test.tsx`，输出`/tmp/mj-legacy-release-20261102/recovery-diagnostic.log`。
- 最小修复方向：模块任务按用户/故事/章节/模块绑定，在受理回调中先持久化任务号；恢复只查询同任务，成功结果幂等入仓、插入一次；重开读回未完成状态，未知结果不开放重新购买，源模块变化时结果保留仓库而不误插。需补回执持久化失败、并发重复、重开恢复、跨账号/模块拒绝、只GET不POST、重复完成只入库/插入一次测试。
- 这不是当前429或49%的替代解释，而是上游恢复后仍会妨碍慢任务交付的独立缺口。实施必须编辑用户仍保护的`BookModuleConvert.tsx`、`server/routers/storyAgent.ts`及对应测试；当前仅授权imageGen路由，故未动这些文件，等待用户协调恢复流程的修改范围。

## 用户授权后的模块恢复修复（本地，未部署）

- 用户已明确允许任务恢复及测试。本次新增 stories.body 内服务端拥有的 bookModuleImageTasks 回执账本，不新增数据库表。生成前持久化请求标识，受理时保存供应商任务号，恢复仅查询原任务。MySQL 行锁只覆盖持久化事务，不跨供应商网络等待；候选图片与任务完成同事务提交。
- 弹窗打开先读取任务，未完成/未知状态阻止重复购买；关闭重开仍可恢复。完成结果只入库一次，插入前核对源模块并避免相同图片重复插入。正文变化时保留仓库结果。通用故事保存不得伪造或覆盖回执。
- 对“一个任务卡住所有出图”的核查：两个 imageGen 熔断入口都传 provider；imageProviderHealth 按模型冷却，过载60秒、连续故障10分钟，已受理任务超时不计入熔断。新增测试让模块A停留在供应商等待、模块B仍进入生成，确认不跨网络持锁。此证据不证明外部MJ服务已恢复。
- 验证：8文件217项相关测试通过；另一次真实隔离MySQL测试通过，验证事务回滚及两个独立恢复进程只入库一次。tsc --noEmit、feature:validate（76卡）、git diff --check通过。临时MySQL只用Unix socket，验后已关闭。日志位于 /tmp/dt-module-image-recovery-20261102/。
- 尚未部署，未发起新的付费生成、未切换模型、未commit/push。历史没有持久化回执的任务无法自动找回；未知结果无回执时仍须人工核实供应商，不能自动放行重买。上游旧49%任务仍未解决，不能宣称真实出图闭环已通过。

## 本机真实验收追加：取消按域名推断专用通道

- 用户允许继续修复并少量算力本地实点。使用主仓3000、虚构故事1214“蓝色纸船与灯塔”、章节6首个文字模块；保留旧用户标签和原文。先核对无待恢复任务，报价1.36算力。
- 第一次点击返回 submit HTTP404，无供应商任务号，回执记failed。本机网关为api.302.ai（与生产.cn不同）；文档仍列/mj-turbo/，但实际提交不可用。同网关普通/mj/的历史任务GET成功返回SUCCESS100%，专用查询超时，未展示凭据。
- 因此撤销“官方网关域名即可证明支持专用路径”的假设。imageGen默认沿用/mj/与--turbo/--relax参数；仅服务端显式IMAGE_302_MJ_ROUTE_MODE=dedicated启用专用路径。历史带通道回执查询不变。404不自动跨路由重发；未修改.env或其他助手的冷却/退款逻辑。
- 新默认路由测试先红3项，修改后5文件209项通过；追加404不自动重买测试后imageGen111项通过。类型检查、账本校验另记录。
- 明确首次失败且本机累计仍12.49后，向用户说明修正后的再一次验收，费用上限仍1.36。第二次只点击一次，后端沿用明确未受理过载的安全重试，最终返回模型拥挤未受理，回执failed、无任务号/候选。没有切换GPT或继续点击。截图 /tmp/drinkingtime-mj-local-overload-20261102.png。
- 结论：本地路由404已排除，供应商明确过载仍阻塞出图；不宣称闭环通过。此次路由修正及任务恢复未部署，未commit/push。

## 302目录核查与模块V7固定（用户授权直接选择）

- 官方登录态API目录 https://302.ai/product/list?cate=api&tag=%E5%9B%BE%E7%89%87%E7%94%9F%E6%88%90&brand=Midjourney 列出V7/V6.1/V6文生图与图生图、V5.1/V5.2、Niji6和Turbo/Relax。商品卡均显示$0.025/次起，不能当作本次Turbo的确定价格；普通接口文档 https://doc.302.ai/160578879e0.md 标价0.05PTC，Turbo文档标价0.1PTC。列表存在不能证明实时容量可用。
- 代码核对发现普通无参考正式图未固定版本；带角色参考或draft才固定V7。因此不声称此前所有请求已在V7。选择书稿模块正式图固定V7，理由为已有V7历史成功证据且支持oref，避免版本默认漂移；不选择需改造角色参考的V6.1，也不假设Relax解决过载。
- imageGen新增内部mjVersion=7选项，替换编译提示词中的其他版本；仅模块图片入口传入，界面标明Midjourney V7。保留既有Turbo费用/参数与四候选，不启用draft，不改全站其他入口，不自动切模型或重提旧任务。
- 4文件206项测试通过，包含版本覆盖/不启用draft/保持Turbo和模块路由传递。未新增付费请求，未部署或提交；供应商实时出图可用性仍未验证。

## V7真实验收结果

- 用户再次明确允许试一次。本地主仓3000，故事1214章节6原文字模块，界面明确Midjourney V7四候选，报价1.36。只点击一次，后端保留明确未受理过载的既有安全重试；最终返回模型拥挤/上游过载，未取得供应商任务号，无图片候选，持久化状态failed。未切GPT或再点生成。
- 截图 /tmp/drinkingtime-v7-acceptance-20261102.png。结论：固定V7未绕过当前302 MJ通道过载，不能宣称出图修复完成；下一步应由供应商恢复容量或选择其他可用通道，而非继续猜版本。

## Legnext V7 Fast真实供应商验收成功

- 用户充值、授权生成专用Key并保存本机.env后，明确要求再试。2026-11-02从本机服务端直连Legnext，以虚构蓝色纸船与黄色灯塔提示词，明确 --v 7 --fast --ar 3:4，单次POST，不发回调、不重试提交。
- GET账户余额确认$10；POST /api/v1/diffusion受理后先将私有job_id写入/tmp/dt-legnext-acceptance-20261102/state.json（目录700、文件600），仅GET同任务至completed。task.meta.usage.consume=80；余额$9.92，实际成本$0.08。余额接口available_credits=9000与available_points=920需要组合理解，不能用available_credits单字段差值1000当成实际扣费；以任务consume80和美元差额交叉确认。
- 已下载四张928×1232 PNG到outputs/legnext-v7-acceptance-20261102/，首张人工视觉确认包含蓝色纸船、黄色灯塔，无错误页。密钥/私有任务号/供应商临时链接未写入仓库或日志。
- 证据范围仅为Legnext供应商直连成功；现有书稿按钮还未切换至Legnext，图片尚未自动插入正文，不代表拾光全流程或生产验收完成。未部署、未commit/push，未修改其他助手代码。
