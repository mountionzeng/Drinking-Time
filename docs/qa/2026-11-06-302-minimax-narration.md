# 302 MiniMax 正式旁白续修

2026-11-06，main 本地；用户否定本机 Tingting 试听，明确要求使用302模型，并已授权花少量算力生成音频。

## 问题与判断

- 原302通用接口 OpenAI/Alloy 调用返回 HTTP500，错误体指向302内部的 `/v1/audio/speech`。官方仍列出 `/302/tts/generate`，没有证据证明整个旧接口已退役；OpenAI通道故障原因仍在上游。
- 本机语音无法达到用户要求，已弃用。当前接入此前没有显式MiniMax模型与响应解析。
- 只读查询302的 `/302/tts/provider?provider=minimaxi`，确认包含 `speech-2.8-turbo` 和 `audiobook_female_1`；`minimax` 不是其目录标识。

## 改动

- `storyVoice302.ts` 对显式配置的 `minimaxi` 使用302 `/minimaxi/v1/t2a_v2`，固定 `speech-2.8-turbo`、URL输出、32kHz/128kbps/单声道MP3；其他供应商保留原路径。
- 读取MiniMax `base_resp.status_code=0`、`data.status=2` 和 `data.audio`。未确认成功/超时/5xx保持未知，不重试、不回退模型。
- 签名报价版本包含固定模型名，providerAttempts和候选provenance记录实际模型。原文指纹、故事归属、费用预占、候选采用和幂等保护保留。
- 仅增加官方MiniMax音频bucket的精确HTTPS域名；其他bucket、后缀伪造、非公网DNS与不安全重定向继续拒绝。
- 本地 `.env` 配置 `TTS_302_PROVIDER=minimaxi`、`TTS_302_VOICE=audiobook_female_1`、超时120秒；`.env.example`提供对应配置。生产环境未修改。

## 真实一次生成

- 故事1217、章节9版本108、用户48。13个选中文字模块，原报价与新报价文本hash相同；不包含画面说明模块13。
- operationId `75d1b656-6247-4932-ac2e-cf82ffc50094`，应用报价0.06算力，只提交1次。
- 返回 `candidate-ready`，音频资产8，受管文件key `6da6086ae8f3f070ad4db37efc03ffaf`。
- billingOperation192 `settled`，actualCostMinor60000；hold192 `settled`；providerAttempt10 `succeeded`，模型 `speech-2.8-turbo`。
- 应用账本按既有产品价结算0.06算力；这不是302账户实际人民币账单的独立核对。302公布Turbo价格为30 PTC/百万字符，本次233字符供应商标价约0.00699 PTC。
- ffprobe：MP3、32000Hz、单声道、43.668秒、700404字节；ffmpeg全文件解码成功。
- `/api/story-audio-asset/1217/8` Range读取返回206及正确Content-Range；旧媒体路由仍返回octet-stream，未在本轮改变其行为。
- 音频复制至 `outputs/launch-video-storyboard-20261106/launch-video-302-minimax-narration.mp3`，上传并更新个人Page，读回新音频引用/时长/费用通过。
- 没有再次生成、写回书稿、采用正式时间轴、提交或部署。60秒仍为分镜节奏草案，待听感确认后安排逐镜落点，配乐/音效未生成。

## 验证

- 测试先验证旧实现无法处理MiniMax响应（2项预期失败），再修复。
- `pnpm exec vitest run server/services/storyVoice302.test.ts server/services/storyNarration.test.ts server/services/storyAudioImport.test.ts server/routers.timelineMedia.test.ts`：4文件80项通过。
- `pnpm check`：通过。
- `pnpm feature:validate`：84卡通过；`pnpm env:status`：主仓唯一3000服务健康；`git diff --check`通过。
- 新回归覆盖明确模型请求、MiniMax错误/500不重试、模型记账与重复候选不扣费、配置改变拒绝旧报价、精确下载域名安全。
- 已自审全部本轮差异；保留其他会话章/节/场/镜头和共享账本改动。

## 来源

- [302 TTS供应商目录](https://doc.302.ai/293994099e0)
- [302 MiniMax语音生成接口与价格](https://doc.302.ai/258529757e0)
- [302 Speech 2.8 Turbo](https://302.ai/product/detail/minimax-speech-2-8-turbo)
- [302旧通用TTS接口](https://doc.302.ai/293993828e0)
