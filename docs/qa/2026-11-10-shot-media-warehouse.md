# 仓库按镜头归组 · 2026-11-10

## 本地结果

保留原来的可拖动横滑浮窗，增加“镜头 / Shots”分类和组下拉。图片、首尾参考帧、视频、声音按生成时间混排，显示镜号、媒体种类、组内版本；视频/声音显示秒数。原图预览和采用入口继续使用原实现。

用户明确选镜头（分镜表、对话小框或自然语言指定镜头）时打开对应仓库组。播放跟随不触发自动打开。对话显示最近已保存素材的仓库入口；图片/视频成功文案也说明已保存。整书音乐/旁白留在全片组，未知旧来源留在未归类。

新增只读素材投影，不修改资产归属、采用状态、原文件名、原影片版本或账务。音频接口只添加净化后的 stableShotId，保持归属隔离。

## 主仓 3000 实测

入口 `http://localhost:3000/editing`，真实故事 1217（launch video）：

- 点击第01镜，仓库自动显示2份历史图片，含尾帧 V02；对话原记录保留。
- 点击第02镜切换空组，不借用上一镜资产。旧聊天中的未结构化镜号无法据此重绑。
- 第03镜的三张书转视频参考图首次遗漏，修复显式引用后：仓库3张、对话本镜图片3张；参考帧 V01/V02/V03 可见。
- “全片”组显示10份音频，名称/版本/时长及原生播放控件可见，横向滚动保留。
- 切到图片分类再点同一镜头，回到该镜头组。
- 关闭仓库后播放至37秒，仓库保持关闭；随后暂停并回到开头。
- 刷新后再选镜头，图片版本/组保持一致。旧参考图不会被重新采用。

未调用付费生成、未改真实业务内容、未导出成片、未提交或部署。原故事现无视频Take，视频卡片的混排与8秒显示以固定样本自动化验证。

## 自动化

- 9文件31项：warehouseShotMedia、WarehouseShotGroups、MaterialWarehousePanel、ShotChatInspector、ChatImageRevisionGallery、StoryAgentChat.layout、chatVideoCompletion、audioWarehouseShot、routers.timelineMedia。
- useShotImageRender：13项通过。
- `pnpm exec tsc --noEmit --incremental false` 通过。
- `pnpm build` 通过（既有大包提示保留，含构建前草稿保护测试）。
- `pnpm feature:validate` 与 `git diff --check` 最终检查。

日志 `/tmp/warehouse-tests-final.log`、`/tmp/warehouse-render-tests.log`、`/tmp/warehouse-typecheck-final.log`、`/tmp/warehouse-build.log`。

## 边界

- V01等为组内同媒体种类的显示序号，依据持久资产ID排列；采用切换/镜头排序不改变序号。新增较早的历史关联或永久删除资产可能改变排序。原始文件名及影片/声音子版本另行保留。
- 没有稳定身份或明确引用的历史资产不能自动归到猜测的镜号。全书声音不会按出现位置拆成多个镜头资产。
- 最近素材提示是已保存资产的投影，不将导入的旧图误报成本次新渲染，也不伪造逐资产聊天历史。
- 未进行真实付费视频/音效生成及生产部署验收。

## 独立对话恢复

原对话 cwd 为非 Git 的 workflow 目录，直接 worktree fork 初始化失败。已恢复可用的继承上下文对话 `01a1c440-fcfd-7470-8e4a-69dcedfc9e4c`，标题“新功能开发 · 继承网页流程上下文”，独立工作树 `/Users/yuandai/.codex/worktrees/additional-web-feature/drinking-time-local`，基线116e84f2。线程状态completed/idle、error:null，等待用户描述另一个功能。没有复制环境/业务数据或启动额外服务。

## 15:50 后工具栏收紧

按用户三张截图去掉“仓库”图标/标题，将原组下拉合入“镜头 / Shots”的胶囊位置；下方不再重复一行选择器/排序说明。分类与导入、放大、关闭全在一排，工具栏41px高、各控件28px高；分类窄屏横滑，操作区不折行。素材区域边距收紧到6px。

菜单使用现有 Select，显示当前镜号/名称/数量，展开后可选其他镜头/全片/未归类。打开菜单即回到镜头分类，已选择的同一项也可从“图片”分类调回。标题移除后保留工具栏空白处拖动/聚焦方向键移动；已加键盘边界，防止方向键同时移动时间轴播放头。

真实3000验证：第01→第03镜菜单切换显示3张参考图；转到全部图片再选同一第03镜恢复；9个控件位于同一水平线；窄面板仍单排；方向键移动浮窗20px再复原，镜头保持01且播放头保持00:00。截图 `/Users/yuandai/Documents/Codex/2026-11-09/drinking-time-workflow/warehouse-single-toolbar-20261110.jpg`。

现有仓库组件7项测试、类型检查、93卡及diff检查通过；无新增样式断言测试，无业务数据/付费调用/发布。日志 `/tmp/warehouse-toolbar-tests.log`、`/tmp/warehouse-toolbar-types.log`。
