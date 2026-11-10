# 最近书/视频/对话代码的冗余清理

## 清理范围与证据

按用户“删一些冗余代码”的要求，结合当前未提交改动、Knip和全仓引用核对，优先删除可以证明不影响现有运行行为的部分。未处理历史素材、持久数据、旧版本兼容或供应商接入。

本轮相对开始时净删除202行，没有添加产品代码：

- storyboardReviewModel：删除已没有运行入口的约30秒批量生成规划函数及其类型，81行。其唯一剩余消费者是同名旧测试；上轮用户明确移除按钮，专用handler已删除。
- storyboardOneClickVideo.test：删除仅覆盖该废弃规划函数的4个测试及fixture，102行。逐镜自动补图、视频规划和费用逻辑的现有测试保留。
- messages.json：删除该按钮独占的3组多语言文案，12行。已检查没有动态/静态调用或其他文案引用。
- StoryAgentChat：删除恒为false的旧滚动分支，5行。现有镜头历史顶部/退出到底部逻辑保持。
- ShotChatInspector及其测试：删除已不读取的onClear属性及测试中无效传参，各1行。实际取消选中仍由对话小框负责。

删除前文件快照保留在本机 /tmp/drinking-cleanup-before-20261110，可与本轮起点精确比较；未覆盖其他未提交修改。

## 验证

- 7文件89项相关测试通过：StoryCardsBoard.intent、storyboardAutomaticVideo、ShotChatInspector、shotConversation、StoryAgentContext.intentRecognition、visualProductionWorkflow、storyboardSelectionFollow。
- pnpm exec tsc --noEmit通过（包含noUnusedLocals/noUnusedParameters）；没有独立配置的ESLint任务。
- 全仓搜索已删除标识/文案没有残留产品引用。
- Knip完整默认扫描前后均有727条既有提示（288个文件），新增0；退出码1来自这些原有提示，不能称全库扫描已全绿。报告中的未导出给外部使用、仍在文件内运行的函数不等于死代码，本轮没有批量删除它们。
- 初始production模式报告因当前entry配置覆盖不足误报大量现用依赖，已弃用，不据此删包或入口。依赖清单和Knip配置未改。
- 功能账本移除已废弃测试的当前evidence路径并保留历史记录；92卡验证和git diff --check通过。

本轮是无行为变化的代码删除，未重新购买媒体、未写用户作品数据、未提交或部署。未声称全系统冗余已经清空。
