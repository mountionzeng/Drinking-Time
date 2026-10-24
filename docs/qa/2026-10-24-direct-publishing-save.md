# 2026-10-24 发布稿直接保存

## 用户反馈与判断

用户认为保存时的“这次改的是措辞，还是内核？”弹窗多余，授权判断后删除无必要步骤。
原流程先调用 AI 判断正文变化，再要求用户二选一；其中“更新故事内核”实际只返回版本转换建议，不保存正文，又要求创建新版本，形成重复判断。

## 改动

- `publishingDraft.applyEdit` 直接沿用 `apply_wording` 写入当前平台稿件，不再调用 AI 分类；保留输入长度、所有权和 revision 冲突检查。无内核的手写稿仍沿用原有初始化路径。
- 删除工作区决策弹窗及相关前端状态、确认请求。显式保存成功显示“稿件已保存”。
- 不更新共享故事内核、不重写其他平台，也不自动建立成品版本。保留旧确认接口供兼容调用。
- 返回结果检查当前 Story、平台、版本和 revision；仅清理提交时的同一份编辑缓冲。保存期间继续输入或恢复到原来的正文，都保留为待保存修改。
- 新文字候选采用流程、成品版本与图像/视频层保持原逻辑。

## 验证

- `pnpm exec vitest run server/routers.publishingDraft.test.ts shared/publishingDraft.test.ts server/services/publishingPersistence.test.ts client/src/features/publishingDraft/PublishingDraftWorkspace.test.tsx`：4 文件、169 项通过。
- 浏览器：`NODE_PATH=/Users/yuandai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules node scripts/verify-publishing-save.cjs`。
  - 仅主仓库 3000 端口；真实工作区组件与 Zustand store，虚构稿件和内存 tRPC，拦截所有真实 `/api/` 请求。
  - 改写正文后一次保存成功，无弹窗、无确认/内核请求；共享内核不变。
  - 保存中继续输入、保存报错后保留文字、重试、保存中恢复原文均验证。
  - 截图 `/tmp/publishing-direct-save.png`；页面仍完整展示编辑区和“已保存”状态。
- `pnpm check`、`pnpm feature:validate`、`pnpm build`。

## 范围与限制

初次验证仅在本地进行；现已提交、推送并部署，发布证据见文末。未操作真实稿件、未调用生成模型或付费生成。浏览器使用内存接口验证 UI，服务端行为由路由和持久化测试验证，未额外执行生产 SQL 集成测试。其他会话的未提交改动保留。

## 后续：图片生成弹窗被未保存稿件挡住

用户截图中的按钮在付费提交前就已禁用。通过当前编辑页面复现：文字区存在未保存修改 → 图像区将 `dirty` 合并进 `coverBusy` → 弹窗只显示“先保存或等待”，并遮挡外层保存入口。不是已提交图片任务的供应商渲染失败。

修复：图像生成弹窗增加原地“保存文案，继续”。保存中禁用重复保存，成功后保持弹窗与图片要求，显示费用确认；失败保留原文、要求与重试入口。区分保存、整理文案、图片任务、视频准备和内容校验提示。只在用户再次确认生成费用后提交；使用保存结果的 publishing revision。空正文及非法内容仍不可生成。

验证：组件测试先新增两个失败断言，修改后通过；`scripts/verify-publishing-save.cjs` 扩展为真实组件内存流程，覆盖保存失败→重试→保存中禁用→成功启用生成→要求不丢失→点击费用确认后只提交一次且使用最新 revision。生成接口由虚构费用响应替代，真实 API 全部阻断，没有付费出图。截图 `/tmp/publishing-image-save-ready.png`。首次候选尚未采用时也提供保存入口；原有移动端文稿确认流程保留。

后续修复验证结果：PublishingDraftWorkspace、PublishingImagePack、MobileImageStudio、publishingDraft router 共 4 文件 105 项测试通过；类型检查、67 卡账本校验与构建通过。用户当前页面仍持有旧开发模块，未强制刷新，以免影响其未保存正文；已恢复原文字视图，需先保存再刷新加载新界面。

## 文章末尾配图入口

在正文及话题标签之后增加“配图”，有正文且页面提供图像导航时展示；复用 `onOpenImages` 切换到当前故事的图像页。未保存正文仍可进入，后续保存和付费确认沿用前述流程。浏览器回归改为点击真实“配图”按钮，验证切换不产生 mutation，切回文字仍保留未保存内容。截图 `/tmp/publishing-article-image-button.png`。

## main 与正式站发布

2026-10-24（Asia/Shanghai），应用提交 `36192dd5326f2173f22d40a483a67471245ba91b` 已推送 main 并部署正式站。

- 本地主仓已在 main，无需跨分支合并。发布前确认其他会话无合并作业；独立 Git 索引仅提取本轮 11 个文件与相关账本条目。其他会话的 Logo、充值、提示词和工作区变更仍保留在本地。
- 精确提交树导出到干净源码快照验证，没有在副本启动服务。类型、67 张功能卡、36 条迁移基线、生产构建通过；小程序 16 文件 215 项通过。
- 完整回归：668 文件通过、5684 项通过、67 项跳过。9 项失败在未修改的 e8e4ec23 基线上完全复现（4 文件 90 项中 81 通过）：管理员查询范围断言 1 项，测试签名密钥缺失 2 项，既有图像生成配置门禁 6 项。首次沙箱执行受本地监听 EPERM 影响，重跑后只剩上述基线失败；不宣称全库全绿。生产 SQL 集成测试未额外执行。
- 浏览器隔离流程覆盖直接保存、冲突与重试、保存期间继续编辑、恢复原文、文章末尾配图导航、未保存文字往返保留，以及图片弹窗保存后使用最新 revision 显式确认费用。全部采用虚构稿件与内存接口，没有付费出图。
- 正式站部署前与上次已验证的 bf705978 运行文件逐项一致。依赖文件一致，本轮无数据库、环境、nginx、证书或登录开关变更。
- 构建共 95 个目标文件；增量仅 `dist/index.js`、`dist/public/index.html`、`dist/public/assets/index-DYJnl7ZB.js`。先核对上传摘要并备份整个旧 dist，再更新服务端、重启既有 PM2、检查健康，最后切换页面入口；旧哈希资源保留。
- 线上 95 个目标文件摘要全部匹配；PM2 online，PID 468975。公网 `/m`、`/editing`、`/healthz`、`/readyz` 均 200；readiness 为 MySQL、要求登录；公网首页、JS、CSS 摘要与构建一致。
- 回滚备份：`/opt/Drinking-Time/dist.bak-20261024-publishing-36192dd5`。恢复其中服务端包和 public/index.html，再重启既有 PM2 可回到旧应用；数据库无需回滚。发布脚本在健康失败时自动执行这一恢复路径。
- 线上文件清单：`/opt/Drinking-Time/dist.release-20261024-publishing-36192dd5.sha256`。服务器仓库 checkout 仍为 0f649128，运行版本以此 dist 清单为准。
- 本机证据目录：`/tmp/dt-publishing-release-20261024-3y61yeiq`，含干净快照、测试和基线日志、构建、部署前摘要、上传包、部署结果及公网校验。
- 线上登录后的真机操作、真实供应商出图未重新执行，不能据本次验证承诺供应商渲染速度或成功率。
