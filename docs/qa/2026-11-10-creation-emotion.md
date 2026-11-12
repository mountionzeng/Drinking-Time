# 共享作品情绪：第一轮接入验证

## 已验证

- 六检索API保留，词库单源；空输入不再匹配全库。
- 同一场景：白瓷小茶杯放在桌面，细腻彩色像素。分别设置温暖怀念、压抑不安、释然平静。文字generateTextDraft→runJsonAgent、分镜generateForMobile→renderGate→Legnext、音乐quote/generateStorySceneAudio→generate真实服务路径的测试替身收到不同意图及媒介建议；保留场景事实、人物身份/像素风格和音乐时长。
- 混合感受、轻强度、否定不转肯定、结尾变化、未知表达保留；公共层不读取个人档案。
- 章节/镜头覆盖、显式音乐反差、同范围撤销、无关镜头修改不使作品层版本过期。
- 持久化后重新读取、旧页面回写保护、所有权隔离、不存在镜头、CAS并发冲突。
- 文字新旧版本并存及来源状态。音乐E修订变化后旧报价在计费/供应商调用前拒绝；整片配乐包含按时间范围划分的本镜变化。
- 原图保真、长提示词、美术配色、原有故事保存测试回归。

## 命令与结果

隔离worktree，无.env，无业务数据；Vitest globalSetup将数据放/tmp。OPENAI_NEXT_API_KEY=test-key仅启用测试替身分支，无真实服务密钥。

`OPENAI_NEXT_API_KEY=test-key pnpm exec vitest run shared/creationEmotion.test.ts server/services/creationEmotion.test.ts server/services/textDraftHistory.test.ts server/services/storyAudioGeneration.test.ts server/routers.storyAgent.test.ts server/services/renderGate.test.ts server/services/renderGate.longPrompt.test.ts server/services/colorHarmony.integration.test.ts server/services/storySync.art-preview.test.ts server/services/storySync.publishing.test.ts server/services/storySync.visual-assets.test.ts`

11文件172项通过（后续补充测试结果见功能账本）；类型检查使用 `tsc --noEmit --incremental false`，避免共享node_modules写构建缓存。已修复首轮文字参数接线和镜头身份类型错误，复跑通过。

## 不等同于效果验收

代码主链路已接通；测试供应商确实收到情绪；真实付费生成/人工比较未执行。真实用户作品及已有资产未改。其他入口及语言理解范围见 `docs/handoff/CREATION-EMOTION.md`。此项登记partial，避免把主链路通过等同全系统入口覆盖。

## 本地端口验证与最终复查

同步19个本轮文件到主仓库前逐个核对原文件等于HEAD，未覆盖其他会话工作。主仓/readyz返回ready，新tRPC情绪接口已加载。真实故事1217执行get→preview→get，输入“有一点失落，但并不绝望，最后慢慢释怀。”得到分层结果，前后状态相同且revision=0；没有保存或生成。最终重点3文件23项复查与类型检查通过（与172项回归重叠，不相加），功能账本94卡通过。没有进行浏览器点击验收或付费作品比较。
