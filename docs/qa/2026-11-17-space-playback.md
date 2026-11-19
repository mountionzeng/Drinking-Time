# 空格播放恢复 · 2026-11-17

## 结果与范围

主仓 localhost:3000/editing，Launch Video（story 1217）。已恢复普通按钮焦点下 Space 播放/暂停；Enter 仍激活按钮。只修改快捷键规则及两个交互边界，不触碰播放时钟、生成/计费、协作、删除流程或业务库文件。不 commit、push、部署。

## 原因与精确修改

- storyboardEditRow.ts：原规则让所有非时间线普通按钮消费 Space。点过“折叠聊聊”后，Space 会折叠聊天而不会播放。现在普通按钮只保留 Enter 激活，Space 交给已有播放处理器 preventDefault/stopPropagation。
- storyboardEditRow.test.ts：两个现有断言改为普通按钮 Space 走带、Enter 激活。输入、IME、修饰键、长按、菜单与时间模型测试保留。
- views/StoryboardEditRow.tsx：原边界只识别 aria-haspopup=menu；实际视觉层排列使用 aria-haspopup=dialog。改为所有有效 aria-haspopup 触发控件保留自身按键操作。
- StoryAgentChat.tsx：故事标题重命名区补 data-renaming=true，保存/取消按钮也处在编辑边界内。

后两处由原页验收发现：初始补丁让重命名取消和排列弹出按钮的 Space 被播放抢走。两项失败保留在 space-playback-browser.json，修正后分别通过复验。

## 原页面可复现验收

1. 点“折叠聊聊”使按钮获得焦点，再按 Space：视频实际播放；再按 Space：实际暂停，聊天开合状态不变。Enter 可正常展开/折叠。
2. 视频预览 DOM 实测 currentTime 从 1.3249 推进到 10.1745 秒；再按 Space 后 paused=true。即时样本仍发生播放头/镜头同步定位，因此另外补查稳定落点：连续两次读回走带控制 00:17.168，02 视频预览 currentTime=4.8584、paused=true，均不再变化。素材缩略图的 loop 预览独立运行，不作为整片播放判据。
3. 时间线按钮获得焦点，Space 播放，再按暂停，均通过。
4. 消息输入框原草稿为空；Space 写入一个空格且不播放，Backspace 清除后保持空草稿，未发送消息。
5. 修改故事名称→“取消修改故事名称”按 Space：退出重命名且不播放，没有保存标题变化。
6. “视觉层 3 排列控制”按 Space：正常弹出排列控件且不播放。Escape 关闭，未添加、删除、移动图层。
7. 刷新原页面，普通按钮 Space 仍可播放/暂停。最终恢复暂停、播放头回开头、聊天展开。

## 验证证据

本会话 outputs/ 中保存：
- space-playback-tests-final.log：4 个测试文件、193 项通过，exit 0。
- space-playback-types-final.log：TypeScript 通过，tsbuildinfo 写入本会话 work/，exit 0。
- space-playback-build.log：标准 pnpm build（含 77 项草稿保护）通过，exit 0；现有大 bundle 告警保留。
- space-playback-scope.json：主仓/候选范围核对通过；52 个既有非构建验收附件按原有带哈希决策保留在主仓，无源码漏项。这是本地诊断，不是生产发布许可。
- space-playback-browser.json、space-playback-playing.jpg、space-playback-final.jpg：原页面行为与截图。
- space-playback-data-check.json：111 图、10 视频、3 条采用关系、4 条范围、storyTimelines（含当前修订38和持久旧版本）逐对象一致；故事正文除 _revision 2248→2249 与 updatedAt 外完全一致。没有覆盖或恢复旧库。
- space-playback.diff、space-playback-files.json：本轮基线到最终文件的差异和哈希，不夹带此前未提交改动。

修复前两个断言失败；第一次测试缓存写入和类型缓存写入因候选 node_modules 指向主仓而 EPERM，不能视为业务测试通过。改用 --no-cache 和独立 tsbuildinfo 后最终命令均 exit 0，未放宽测试。

功能卡 storyboard-position-anchors 保持 observing；既有 knownGaps 不变。未宣称删除确认框或图片生成链路修复。
