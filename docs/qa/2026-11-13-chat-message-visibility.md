# 聊天发送、处理状态与回复可见性（3000）

日期：2026-11-13。仅本地主仓 main，未提交、未部署；不增加按钮。

## 已确认的故障

用户原话 `不行，云还是需要白一点`（msg-1794580034326-1kvzo）及回复 msg-1794580035943-plpxh 已持久化。原UI普通消息滚向容器末尾，但末尾是历史视频/图片素材卡；区域编辑发送还重新打开镜头历史，把 follow-latest 改成 history。范围回复把多张大图排在文字前面，用户容易看不到回应。

## 修复

- 所有当前消息和排队消息以实际消息节点为滚动目标，不以旧素材列表末尾为终点。
- 短回复保持本轮用户消息和回应同时可见；预览过高时优先显示要求及回复文字。范围图仍可下滑查看，异步图片加载不夺走人工阅读历史的位置。
- 发送时关闭历史展示并保留选中的镜头和图片；明确打开历史的入口仍存在。关闭历史回到最新对话。
- 输入框旁原有状态行在 isReplying 时固定显示“已收到，正在处理 · 可以继续输入”，不轮换成无关上下文；英文/法文词典同步。

## 真实页面验证

在 http://localhost:3000/editing、story 1217 Launch Video、第03镜、原帧 #2109 上操作：

1. 刷新后原来的“云还是需要白一点”和报价文字同时可见，原0.54算力云报价未确认。
2. 点击原帧打开第03镜修改历史后发送，历史自动收起，选中#2109保持，用户气泡及处理状态立即显示。
3. 等待时仍可在输入框输入，测试草稿已清除。
4. 本地指令“先核对范围，暂不生成图片或视频。”得到“先确认全部关键帧…当前没有提交视频任务”；刷新保留，最新气泡可见。
5. 再次打开、关闭镜头历史，返回最新一轮。没有新增按钮。

## 验收遇到的独立问题（未解决）

第一句测试“我先查看这一帧的范围，暂不生成图片或视频。”命中现有 studioAssistant 的宽泛 `查看.*视频` 规则，误走界面理解。返回 `LLM submission outcome unknown; reconciliation required`，错误气泡本轮已正常显示。billing operation 242，inference.text，submission_unknown，maxCostMinor=279250，即最多0.5585算力，actualCostMinor=null。已向用户说明，不重试、不清除/伪造账务；供应商费用仍待核对。第二句本地范围检查没有新增账务操作。该路由问题记入 studio-aware-conversation-actions 的缺口。

## 数据边界

前后 generatedImages、videoTakes、storyAudioAssets、timelineFrameExtractionOperations、storyTimelines 完全相同；剪辑修订仍28。没有新图/视频任务，也没有采用候选。原frameReview仍R2，仅updatedAt因本地检查更新，云报价未购买。标准同步删除了shots中的旧shotKey别名（稳定镜头身份保留），不是剪辑变更。聊天写入两轮验收消息；既有恢复逻辑去掉一个R2恢复占位，既有保存合并去掉较早的同内容回复msg-1794557109454-jzpan，本轮未改持久化逻辑。

## 检查与证据

- 10个文件、67项相关测试通过，含滚动几何、状态行、目录、镜头历史、队列、抽帧与范围恢复。
- TypeScript --noEmit、pnpm build通过。
- 功能账本102卡、git diff --check通过。
- 源码与数据起点/终点及日志：`/Users/yuandai/Documents/Codex/2026-11-13/chat-visibility/`。
- original-message-visible.png：原用户消息及云报价恢复可见。
- local-sending.png：消息气泡、固定处理状态、可输入区域。
- reloaded.png / history-closed.png：刷新及关闭历史后的当前轮。

本轮验收的是聊天可见性，不代表森林/云美术或新视频已验收。
