# 配图文字准备超时修复

## 现象与证据

桌面 `/editing` 的文章图片制作显示「配图准备失败，尚未提交出图，请重试」。只读检查故事 1206 的封面生成记录：领取至失败为 45,502ms，provider 为 Midjourney，taskId 为空，尚无图片候选。对应文字推理账单记录为 `submission_unknown`，不能据此宣称文字调用没有发生费用。

请求在提交图片前，会将中文美术简报编译为短英文提示。旧路径经 `invokeAgent` 使用通用文字模型 `gpt-5.6-terra`，期限 45 秒；错误被统一文案隐藏。当前记录与该期限吻合，图片生成尚未开始。模型本身、网关和本地网络对这次超时各自的影响尚不能单独量化。

用户授权使用现有凭据，只读查询 `api.openai-next.com` 和 `api.302.ai` 的模型目录。Next 首次返回 HTTP 200，列有 `gpt-5.4-nano-2026-03-17`；302 超时。用户换网后的目录复查，两者约 10.5 秒连接失败，不能据此断言网络已改善。目录可见不等于推理参数兼容或真实生成成功。

## 改动

- 新增 `imagePromptCompiler`，复用现有 `IMAGE_PROMPT_302_MODEL`（默认 `gpt-5.4-nano-2026-03-17`）与提示词超时配置（默认 30 秒）。通用聊天模型设置不变。
- 经 `runInference` 保留准入与计费，优先 Next，同一模型配置用于 302 后备；不自动重放受理状态不明的文字请求。
- `publishingDraft.generateCover` 和正式封面提示词编译共用该 helper；完整美术简报、系统约束、媒介、构图及后缀继续传递。GPT-image 原始提示路径不变。
- 拒绝空白或被 token 上限截断的提示词，避免用不完整要求提交图片。文字准备超时后释放图片领取状态，明确显示「配图文字准备超时，尚未提交出图，请稍后重试」。
- 保留成本确认、既有候选、正式封面和图片任务恢复。没有修改手机或电脑前端布局，也没有迁移或手工改写故事数据。

## 验证

针对性回归共 135 项通过（7 个文件），全部使用模拟供应商，不触发付费服务：

```sh
pnpm exec vitest run \
  server/services/imagePromptCompiler.test.ts \
  server/services/imagePromptCompiler.provider.test.ts \
  server/services/publishingCoverStoryboardPrompt.test.ts \
  server/routers.publishingDraft.test.ts \
  server/_core/inferenceOrchestrator.test.ts \
  server/_core/inferenceBilling.test.ts \
  server/services/computeProviderBoundary.test.ts
```

重点覆盖：专用模型选路、完整美术要求传递、截断/空白阻断、期限配置、错误原因传递、未知提交不重放、准备失败不调用任何图片供应商，以及既有图片恢复与费用边界。

`pnpm check`、`pnpm build`、`pnpm feature:validate`（58 张功能卡）和 `git diff --check` 通过；构建仍有已有的大 bundle 警告。环境检查确认仅主仓库运行 3000 服务，工作树无 `.webdev` 业务数据或服务。

## 验证边界

本次未提交真实文字推理或图片任务。轻量模型的实际耗时、网关参数兼容性及美术结果质量，需后续由用户重试或在明确授权后实测。此前持久化的失败提示不会因代码更新自动消失；不得清除失败记录或重新购买来伪造成功证据。此修复只合入本地，不包含正式服务器部署。
