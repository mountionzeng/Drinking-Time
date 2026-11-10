# 302 ElevenLabs 同稿旁白试听

2026-11-06，main 本地，chat 01a1b107。用户认为 MiniMax 生硬，指定尝试截图中的 ElevenLabs，已授权少量算力生成。本次保留全部13段原文，不含画面说明和旧英文结尾；未改写章节、分镜、原实验文稿或Page，未提交/部署。

## 实际模型与选声依据

- 302通用目录 `/302/tts/provider?provider=elevenlabs` 返回 `tts-multilingual-v2`、`tts-flash-v2.5`，这是302包装接口的模型名，不能直接当官方 `model_id`。
- 只读查询 `/elevenlabs/models`，确认实际模型 `eleven_multilingual_v2` 支持中文、叙述/有声书，`model_rates.character_cost_multiplier=1`。目录也包含v3/v4系列，本次没有测试或推断其质量。
- `/elevenlabs/voices` 返回 Sarah — Mature, Reassuring, Confident，实际 `voice_id=EXAVITQu4vr4xnSDxMaL`，有 `zh + eleven_multilingual_v2` 验证记录。官方描述温暖、安抚；她原始语言标签为英语，中文表现及自然度仍待用户试听，不能描述为中文母语真人录音。
- 本次选 Multilingual v2 + Sarah，stability=0.35、similarity_boost=0.75、style=0、speed=0.94、use_speaker_boost=true。降低稳定度及稍缓语速是试听假设，不是质量验收结论。未在正文插入情绪标签或附加指令。
- 官方格式接口价格0.3 PTC/1000字符、费率1；233字符对应标价约0.0699 PTC。另一个302包装同步接口标价0.1 PTC/1000字符，但本次未使用，不混淆两条路由价格。没有读取供应商实际消费账单，应用结算与供应商标价分开记录。

## 接入与保护

- `storyVoice302.ts` 显式 `elevenlabs` 路由到 `/elevenlabs/text-to-speech/{voice_id}?output_format=mp3_44100_128&response_format=url`，提交实际 `model_id` 与固定voice_settings，解析顶层 `url`。
- 模型名与声音设置hash进入签名报价版本，providerAttempts及候选provenance保存模型/音色。改变配置或原文将拒绝旧报价；成功回执复用不重新扣费。
- ElevenLabs HTTP500与超时保持submission_unknown，不自动重试、不切换模型。MiniMax和旧OpenAI路径保留。
- 受管下载只增加官方示例的精确HTTPS域名 `file.302ai.cn`，仍逐跳校验域名、端口、DNS，拒绝后缀伪造。既有MiniMax域名保留。
- 本地 `.env` 设 provider=elevenlabs、voice=EXAVITQu4vr4xnSDxMaL，超时120秒；`.env.example`增加选择说明，生产配置未改。

## 一次真实生成

- 正式 `bookMedia.quoteNarration` → `timelineMedia.generateNarrationCandidate`。故事1217、用户48、章节9版本108，原文233字符（177汉字）；源hash `977e59cc0ed18fc0781a6906ce75a345b04d298b382596f170e710ebeb4a9507` 与固定稿一致。
- quote priceVersion=`tts-302-eleven_multilingual_v2-cny-v1-d2ac9b6eface`，报价0.06算力。签名令牌未写入本记录。
- operationId `de9a97f6-aca0-44a4-a649-a637096336f5`，仅一次提交，返回candidate-ready，asset9，storageKey `bbba40377e6e36ca7b37d3dd79120883`。
- billingOperation193与hold193均settled，actualCostMinor=60000，即应用实际结算0.06算力；providerAttempt11 succeeded，model=eleven_multilingual_v2。无第二次付费生成。
- 文件 `outputs/launch-video-storyboard-20261106/launch-video-302-elevenlabs-sarah-narration.mp3`，46.718549秒，748607字节，MP3/44100Hz/单声道；ffmpeg完整解码成功。
- `/api/story-audio-asset/1217/9` 返回206、Content-Range bytes 0-1023/748607，1024字节；现有接口Content-Type仍为application/octet-stream，本次未改该行为。
- 章节9仍version108；候选未采用到正式时间轴。原MiniMax资产8与试听文件保留。未实际听验音色自然度、口音和情绪，交付用户比较。

## 验证

- `pnpm exec vitest run server/services/storyVoice302.test.ts server/services/storyNarration.test.ts server/services/storyAudioImport.test.ts server/routers.timelineMedia.test.ts`：4文件84测试通过。
- `pnpm check`：通过。覆盖模型/voiceID与正文原样请求、URL响应、500不重试、无HTTPS产物拒绝、模型与设置签名、一次扣费、配置变化拒绝及下载域名边界。
- `pnpm feature:validate`：84卡通过；环境检查确认主仓唯一3000服务健康；`git diff --check`通过。首次 `pnpm env:status` 受沙箱IPC限制，改用 `node --import tsx scripts/env-status.ts` 执行同一脚本通过。

## 用户听验反馈与原生中文复查

- 用户实际试听后明确否定：Sarah“完全就是用英语的语调来说中文”，听感诡异。本候选在本次作品中淘汰，保留资产和账务记录，不得继续标为待验或可用推荐。
- 上轮根据英文音色的warm/reassuring描述及跨语言中文验证记录做选声，依据不足。语言可生成不等于中文韵律自然；调低稳定度或调慢语速不能作为修复英语腔的证据。
- 只读请求 `/elevenlabs/voices?page_size=100` 返回 `total_count=25, has_more=false`。该账号本次返回的音色中仅Stella Gu（BqljjWyTnrioXPCNkCd4）原始语言标签为zh、beijing mandarin；供应商描述为cold/apathetic/distant，未找到符合温暖日常讲述目标的原生中文选项。此结果只代表该接口当前账号列表，不代表ElevenLabs全球音色库没有其他中文音色。
- 本轮未再提交付费请求、未替换已有资产或时间轴，也未更改运行配置。当前本地配置仍指向Sarah，这是技术路由状态，不代表用户认可，应在下一次生成前明确选择合适音色。
- 后续筛选以普通话原始语言及日常交谈风格为前提，先用短句验证口音、断句与重音，再生成全稿。现有接口、费用和防重能力保留；本轮仅记录真实质量反馈。

## 官方来源链接

- [302供应商目录](https://doc.302.ai/293994099e0)
- [302 ElevenLabs官方格式TTS与价格](https://doc.302.ai/315663848e0)
- [302模型查询](https://doc.302.ai/315961154e0)
- [302音色查询](https://doc.302.ai/315983072e0)
- [302包装同步接口与不同价格](https://doc.302.ai/300177709e0)
