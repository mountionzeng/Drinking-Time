# 普通话三音色短试听

2026-11-06，chat 01a1b107，main 本地，未提交/部署。用户否定 Sarah 的英语语调中文后，明确要求“先查一下，然后再给我试几个版本”。本轮完成三段同稿中文音色候选，等待用户实际听验。

## 查询与选择

- 只读302 `/302/tts/provider?provider=minimaxi`、`provider=doubao` 和 `/v1/models`。中文女声选择豆包温柔小雅、MiniMax淡雅学姐；中文男声选择豆包温暖阿虎。名称及普通话音色ID用于筛选，不能代表已经通过自然度验收。
- 豆包通过官方302通用 `/302/tts/generate` 接口，provider=doubao，实际voice分别为 `zh_female_wenrouxiaoya_moon_bigtts`、`zh_male_wennuanahu_moon_bigtts`。该接口未返回底层模型具体版本；`doubao-tts-unversioned` 是本项目明确表示未披露版本的服务标识，不是供应商宣称的模型名。当前302模型目录另列 `doubao_tts_hd`，未据此伪称本次响应确认了该版本。
- MiniMax实际模型 `speech-2.8-turbo`，voice=`danya_xuejie`，与最初被认为生硬的 `audiobook_female_1` 不同。原MiniMax和ElevenLabs候选保留。
- 首先试过文档列出的 Qwen3 `qwen3-tts-flash-2025-09-18` / Cherry：一次响应HTTP404，明确 `InvalidParameter / Model not exist.`，operation `670966ed-32db-405a-bf65-860143e49fa0`，billingOperation196 released，应用actualCostMinor=0。未重试、未再买Ethan版；未保留不可用Qwen接入代码、域名或示例配置。文档存在不等于当前模型可用。

## 同稿与费用

使用章节9当前版本110中原13段旁白的前三段，原模块ID保留且逐字匹配固定原稿，共66字符。书稿版本由原对话更新，本会话未写书稿、分镜或Page。

> 我们可以接住你的任何细碎的情绪，她们值得被珍视。
>
> 我们相信再聪明的回应，也替不了你亲自感到的瞬间
>
> 她是你，和这个世界之间的触角。

三个quote均通过 `bookMedia.quoteNarration`，分别核对模型/服务、音色、user48/story1217、0.02算力和同一textHash `0e5f1ed8c991eb41d7107e4dc30c93249263e057c46619f36809ec0b82c7a21b` 后调用 `timelineMedia.generateNarrationCandidate` 一次。每版完成后才切换下一版配置，不在付费请求中重启服务。

| 版本 | 音色 | 时长（秒） | 资产 | 账单/尝试 | 应用实扣 |
|---|---|---:|---:|---|---:|
| A | 豆包 温柔小雅（女） | 13.92 | 10 | 198 / 13 | 0.02 |
| B | 豆包 温暖阿虎（男） | 11.645875 | 11 | 199 / 14 | 0.02 |
| C | MiniMax 淡雅学姐（女） | 12.968375 | 12 | 200 / 15 | 0.02 |

- A operationId `d7ccf1f6-a156-45f4-bd82-1ff75968264d`。
- B operationId `be7b52f2-e1b2-447f-89ad-8cec2534e6b1`。
- C operationId `38ff3a44-f951-4c9c-9c53-fcca31de45dc`。
- 三个billingOperation和hold均settled，每个操作只有一个providerAttempt succeeded，合计0.06算力；失败Qwen应用扣费0。供应商实际账户账单未独立核对。
- 官方价：豆包35 PTC/百万字符、MiniMax Turbo30 PTC/百万字符，66字符每版约0.00231、0.00231、0.00198 PTC，总标价估算0.0066 PTC，与应用收费不同。

## 文件与验证

- 输出目录 `outputs/launch-video-storyboard-20261106/chinese-auditions/`，`manifest.json`记录完整稿、音色ID、模型/服务、operation、费用、时长和sha256。
- A `A-doubao-wenrouxiaoya.mp3`、B `B-doubao-wennuanahu.mp3`、C `C-minimax-danyaxuejie.mp3`。豆包返回原始WAV/24kHz/单声道，分别保留 `*-original.wav`，仅转码128kbps MP3以便交付，没有变速、变调或加停顿。MiniMax原始MP3直接复制。
- 三个MP3经ffprobe确认编码、时长并全文件ffmpeg解码；三条本地受管接口均206，前1024字节及Content-Range通过。
- 受管素材采用实际探测编码。302豆包返回URL/显示名可能以mp3结尾但实际为WAV，不能仅凭扩展名判断文件格式；既有播放路由仍octet-stream，本轮未改。
- 最终 `pnpm exec vitest run server/services/storyVoice302.test.ts server/services/storyNarration.test.ts server/services/storyAudioImport.test.ts server/routers.timelineMedia.test.ts`：4文件87项通过；`pnpm check`通过。
- 新增豆包请求原文/音色契约、500保持未知不重试、服务版本与quote绑定、同操作只生成/导入/扣费一次、音色切换拒绝旧quote测试。原MiniMax/ElevenLabs/OpenAI支持保留。
- 本地配置最后停在MiniMax/danya_xuejie供继续试听，不代表用户已选定。未生成全稿、未采用时间轴；自然度、重音、口音和温度待用户比较A/B/C。
- 功能状态仍observing/partial，未因音频文件生成而宣称整体产品验收完成。
- 收工功能账本84卡校验、`git diff --check`通过，环境检查确认只有主仓3000一个服务。

## 来源

- [302供应商目录](https://doc.302.ai/293994099e0)
- [302通用TTS接口](https://doc.302.ai/293993828e0)
- [302豆包TTS与价格](https://doc.302.ai/203310451e0)
- [302 MiniMax TTS与价格](https://doc.302.ai/258529757e0)
- [302 Qwen3文档：本轮实测该版本不存在](https://doc.302.ai/354838671e0)
