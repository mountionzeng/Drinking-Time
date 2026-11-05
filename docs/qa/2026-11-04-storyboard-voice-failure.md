# 故事版“生成旁白”失败排查

2026-11-04，本地 main，未提交、未部署。

## 已确认

- 用户截图约 12:39 点击第 02 镜“生成旁白”，当前故事 1217。
- 本地 billingOperations/creditHolds 的记录 178：12:39:02 发起，12:39:08 结束，状态 released、actualCostMinor=0。请求确实进入服务端，本次预占已释放，未成功绑定旁白。
- 调用链：StoryboardVoiceCell → StoryboardPanel → CreationEditorContext.generateShotVoice → storyAgent.generateStoryShotVoice → generateBilledStoryboardVoice → generateStoryVoice302。
- 按钮对应的是镜头旁白入口；失败由 StoryboardPanel 捕获后只调用短暂 toast，用户回看按钮时看不到原因。
- 302 官方 V1 文档仍给出 `/302/tts/generate`、`text/provider/voice` 与 `audio_url`，和当前接入格式一致，不能据此判定接口已退役或随意换供应商。
- 上一轮相关诊断 `/private/tmp/tts500/r2.out` 有上游 HTTP 500、内部 `/v1/audio/speech` 返回 500 的记录；这是历史证据，不是本次请求的原始错误体。本次失败的精确供应商原因尚未取到。

## 已修复与边界

- 错误按 storyId + stableShotId 保留在对应按钮下方，下次明确发起时清除；不增加按钮，保留原旁白播放器、文字和背景音分离。
- 供应商真实生成尚未恢复，不能称旁白已修好。未修改模型、音色、费用或失败结算策略，未发起新的付费请求。
- 已询问用户本次看到的错误文字，并请求一次第 02 镜真实测试授权，上限 0.04 算力、失败不自动重试；尚未执行。

## 验证

- 52 项专项通过：StoryboardMatrix.accessibility、storyboardVoiceText、routers.storyShotFields、storyVoice302、mediaComputeBilling。
- 新断言覆盖错误可见、重试中隐藏旧错误、清除错误、不新增按钮、不移除已有音频。
- pnpm check、git diff --check 通过；主仓仅3000服务。
- 未操作用户原标签；读取原标签日志时浏览器连接接口不可用，未因此刷新用户页面或触发生成。

## 用户授权后的单次诊断

- 用户补充报错为“配音服务暂时不可用”，明确授权一次测试、最高 0.04 算力，失败不重试。
- 13:14 左右对 V1 第 02 镜原文“我们可以接住你的任何细碎情绪。它们都值得被珍视。”调用现有 generateStoryVoice302；预先校验产品报价不超过 20,000 微元（0.04 算力），fetch 调用计数限制为 1，并写入一次性开始标记，避免重跑。
- 此次为独立供应商诊断，未调用正式镜头保存或账本服务，未修改 V2 文案，也未创建新的本地账单。
- 请求约 39ms 连接失败，没有 HTTP 响应，归类 submission_unknown；无法证明供应商是否受理或扣费，不能据此宣称旁白恢复。遵守授权没有重试。原请求 178 的未扣费结论不等于本次诊断供应商结算结论。
- 诊断结果：`/private/tmp/story-voice-once-20261104-result.json`。此轮未得到供应商原始错误体，真实旁白仍待连接恢复后验证。

官方接口依据：https://doc.302.ai/293993828e0
