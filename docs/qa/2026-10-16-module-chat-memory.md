# 模块上下文与排版操作记忆验收

日期：2026-10-16。仅主仓 localhost:3000；未部署、未购买生成或向真实模型发送验收消息。

## 用户入口与行为

- 电脑「图像 → 排版」选中文字或图片，左侧原聊天显示页码与模块类型；手机「制作图文 → 排版」点选后，原小忆入口使用同样上下文。
- 发送时固定当前模块文字、位置、缩放、样式、裁切、本页文字及可用的 600×800 JPEG 预览。原图 URL 不进入聊天请求。没有画面时明确只讨论文字与位置。
- 即使没有聊天，完成改字、移动、缩放、裁切、样式、增删模块、跨页、增删页或整理后也记一次。选择、悬停、拖动中间帧、取消和无变化操作不记。
- 本机按账号/故事保存最近 100 条，发问时提供最近 20 条；详情显示最近 6 条，可展开查看或清除。不同来源版本有标记，撤销/重做标记原操作，不把撤销当作用户喜好。
- 清除操作记录不改作品；普通正文伴写、模块本机草稿、复制/下载/分享、历史版本与费用确认保持原路径。

## 自动化

14 文件、192 项测试通过：

```sh
pnpm exec vitest run \
  client/src/features/publishingAlbum/layoutOperationMemory.test.ts \
  client/src/features/publishingAlbum/moduleCompanionContext.test.ts \
  client/src/features/storyAgent/desktopChatQueue.test.ts \
  client/src/features/mobileWorkspace/mobileConversationStore.test.ts \
  client/src/features/mobileWorkspace/MobileMemoryFollowupChat.test.tsx \
  server/services/writingCompanion.test.ts \
  client/src/features/publishingAlbum/imagePackModules.test.ts \
  client/src/features/publishingAlbum/imagePackModuleRenderer.test.ts \
  client/src/features/publishingAlbum/PublishingImagePack.test.tsx \
  client/src/features/publishingDraft/PublishingDraftWorkspace.test.tsx \
  client/src/features/publishingAlbum/MobileModuleTools.test.tsx \
  client/src/features/mobileWorkspace/MobileNewStoryCompanion.test.tsx \
  client/src/features/mobileWorkspace/MobileWorkspace.test.tsx \
  client/src/features/mobileWorkspace/useMobileConversation.test.tsx
```

覆盖实际两端路由的上下文传递与故事归属拒绝（模型模拟）、原正文不变、发送快照不可变、手机恢复隔离、无选中模块时发送操作记忆、无图降级、记录上限和撤销/重做。`pnpm check`、`pnpm build`、`git diff --check` 通过；构建仍有既有大包提示。

## 浏览器实测

1. 电脑真实工作区：文字/图片选中后聊天标签对应；聚焦聊天保留选中；换页清理旧目标。未编辑作品。
2. 手机 390×844：点文字后聊天识别文字模块；关闭聊天、切到图片再打开，目标更新且未发送输入保留；取消选中恢复原文字上下文。临时本机封面标题和输入已恢复，视口已重置，无模型调用。
3. 独立验收稿（账号/故事 999999999，独立 scope）：不聊天，只移动和切换文字样式，记录分别增加；撤销标为「已撤销」、重做恢复且计数不增加；刷新后没有选中模块但历史保留；清除历史后作品不变。修正微调记录精度，真实键盘移动显示左侧 5.0% → 5.1%。
4. 验收草稿与记录已用专用按钮清除，临时源文件已移除。一个临时浏览器页出现连接超时并崩溃，在新验收页完成剩余检查；不据此声称多标签稳定性已全面验证。

本机截图：`/tmp/module-chat-mobile.png`、`/tmp/layout-operation-memory-qa.png`。截图为本轮临时验收证据，不是长期仓库资产。

## 边界

- 当前是本机、本故事的操作记忆，不跨设备同步，不是训练模型；从功能启用后开始记录，不能追溯此前未记录的操作过程。
- 只在用户提问时随上下文参考这些记录，不自动建议、改稿或调用生成。单次操作不固化成偏好；当前明确要求优先。
- 已发送的对话/排队快照沿用发送时内容；清除本机记录不追溯删除已发送的对话。
- 未测试真实模型建议质量、真实 iOS/Android 触摸/软键盘和公网双设备使用。
