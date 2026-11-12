# 共享作品情绪接入约定

2026-11-10 · 公共负责人：01a1c4d0 · 文字/美术/音乐共享意图，各自转译。

## 最小数据与保存

- 权威词库 `shared/emotionTaxonomy.ts`；旧客户端路径仅再导出。六个函数保留；修复空检索命中全部，业务复用 findSubcategory / matchByLabel / getAllSubcategories / getMixedEmotions。对立情绪和叙事分组仍可选用，不能把对立类别自动当反差要求。
- `stories.body.creationEmotion` 是服务端所有字段，schemaVersion=1，revision 为独立情绪修订号，history 只追加。每项保存 scope、intent、reading、createdAt、userId。intent 为 raw + 可选 mediumDirections.text/art/music；null 代表撤销该范围覆盖、恢复继承。
- scope：story，chapter + **章节ID字符串**，shot + **稳定镜头ID**。不要存显示镜号作为身份。
- revision 是作品内全局递增的 E 号；不是文字/视频/声音资产的 V 号。生成版本分别保存自己使用的快照。情绪修订不创建新媒体、不覆盖旧媒体。
- 保存用 expectedRevision 与故事 CAS 双重保护；其他字段并发变化可重试，情绪冲突不能替用户合并。相同设定重放不追加重复修订。最多500修订，达到后保留旧史并报错，不悄悄裁剪。

## 公共 API

- `analyzeCreationEmotion(raw)`：本地建议，保留分句、阶段、程度、否定与证据；只做一次并随修订保存。未知表达原样保留，不伪造分类结果。它不是心理诊断或完整语言理解模型。
- `resolveCreationEmotion(state, {chapterId?, shotId?})`：作品→章节→镜头，各层独立。具体层只覆盖同一目标的冲突部分，未提到的要求继续生效。
- `compileCreationEmotion(snapshot, 'text' | 'art' | 'music')`：按媒介转译的紧凑资料，最多每层3条表达建议。不发送完整词库、causalThread 或个人档案。不新增模型调用。
- `storyEmotion(body, target)`：服务端便捷入口。没有设定返回 undefined，旧请求不加提示。
- `storyAgent.creationEmotion.get/preview/save/usage`：有所有权保护的 tRPC 接口。preview 不保存；save 必须用户明确要求；usage 返回文本/图片/音乐ID与 current、older-setting、untracked、not-set。无记录不能伪称来自某个旧E版本。

## 对话入口

现有桌面书/视频共同对话 `storyAgent.chat`：

- `把作品情绪设为：有一点失落，但并不绝望，最后慢慢释怀。`
- `我希望这个故事的情绪是温暖怀念`
- `把第01镜情绪改为：压抑不安，但音乐轻快反衬`
- `查看作品情绪历史`
- `查看第01镜情绪历史`

这些明确作品范围的句子本地处理，不调用模型、不购买媒体。普通“我今天很失落”不会自动保存为作品情绪。修改后回复保留旧内容，并列出旧设定/无来源的资产；最多展示20项，完整清单可查usage。自由讨论、没有明确作品对象的输入继续走原有对话，尚不做任意语言的自动提交。

## 给文字工程

当前 `generateTextDraft` 从已拥有的故事读取快照，传给 `compileTextDraftPrompt`，进入实际 modelMessage.creationEmotion，并保存在 TextDraftVersion.creationEmotion。保留事实、选区外正文、旧版本、来源身份以及当前 instruction 优先。

章节生成入口应传 `TextDraftRequest.emotionChapterId=String(chapter.id)`；ChapterWriting快照现已提供明确chapterId，TextDraftVersions仅在账户/故事/作用域匹配且当前正文作为生成依据时传入；服务端核对章节归属，不从标题或旧scope字符串猜。不要从用户记忆情绪推作品设定。

## 给美术工程

`RenderContext.creationEmotion` 接收上述快照；当前 `storyAgent.generateForMobile`（分镜主出图链路）从已验证的 story + stableShotId 传入。单一 renderGate 编译构图/空间/光线/材质建议，保留风格与角色约束。图片原有 prompt 保存 E 依据，供来源查询。

`preservePrompt` 和严格参考图保真路径维持既有锁定，**不自动套新情绪**，此时不声称采用情绪。超出模型容量时不截掉情绪或故事事实后偷偷提交。章节模块出图与文字合成图读取作品+章节快照；发布封面/插图/正文纹理、静态画册背景读取作品快照（页序不是章节ID）。调用方传入已验证快照，不由网关凭 storyId 越权捞取。正文纹理使用emotionArtForm=texture，仅映射浅色层次/细微材质/疏密，保持无主体、低对比阅读区。严格原图编辑仍不自动注入情绪。

## 给音乐工程

`quoteStorySceneAudio` 从 story 解析全书/整片/单镜范围；模块音乐可传章节ID。报价context包含creationEmotion；跨镜生成另带emotionSequence（相对开始帧、时长、本镜快照）和emotionTargets。编译使用节奏密度、音色、张力及停顿，不把speed当BPM。

执行重新读取并比较context/promptHash，情绪改变须重新确认报价；已经受理的任务恢复时沿用原报价快照，不重购。provenance保存快照及最终prompt。纯音乐限制、时长、自动入轨逻辑、现有费用确认均不改。storySoundPlan的编曲/曲式等新字段仍由音乐工程负责。

## 验收边界

已验证三条真实服务请求进入测试模型/媒体供应商，未调用真实付费生成。更丰富的口语理解、章节情绪的自然语言设置、手机独立对话入口仍需接入；新章节及次级图片链路已通过模拟请求测试，本轮未做真实付费生成或浏览器端生成操作。没有宣称真实画面、音乐听感或文字质量通过人工验收。

## 第二轮入口修复

前后端共用轻量 `shared/creationEmotionChat.ts`。明确作品情绪指令在前端声音/图像/选区/生成分流之前处理，Context不再为其调用剪辑代理或后台意图推理；仍保留镜头定位、排队与新输入。浏览器书/视频发送、刷新、镜头历史和下一音乐报价已验证，详见 `docs/qa/2026-11-10-creation-emotion-e2e.md`。

## 第三轮章节与次级图片

- 当前章节文字生成沿用原写作会话身份保护，新增chapterId；服务端拒绝其他故事/其他账户的章节。幂等重放返回原生成版本，不因情绪变化重新调用模型。
- 章节模块图片和无参考图的书页合成图使用chapterId；带严格原图的合成图继续只按本次明确修改。新增章节覆盖后，可通过模块任务的candidate→chapter关系识别旧图，不必依赖旧提示词当时已有章节标签。
- 封面、选中文字插图、正文纹理使用全作品情绪；画册背景继续继承正式封面的美术DNA及无字/阅读区约束，不读取相邻镜头。背景inputSnapshot新增可选emotionBasis，参与报价哈希并在刷新后保留；旧数据无此字段仍可读取。
- 所有恢复入口继续采用持久任务编号/旧prompt，不以新情绪重购；本轮未新增按钮、未自动改写或采用资产。
- 15文件323项测试、类型通过；验收细节见 `docs/qa/2026-11-10-creation-emotion-chapters.md`。
