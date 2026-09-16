# 豆包语音能力合同

更新时间：2026-09-16

这份文档记录“对话式声音导演”可依赖的豆包语音事实。它不是开通证明，也不包含任何密钥、外部音色 ID 或账号专属响应。

## 当前结论

- 现有 `DOUBAO_SPEECH_API_KEY` 已用于录音文件识别，但这只能证明项目配置过豆包语音凭据，不能证明同一 Key 已获 TTS、官方音色或声音复刻权限。
- 新版控制台的 TTS V3、声音复刻 V3 使用 `X-Api-Key`。App ID / Access Token 属于旧版控制台鉴权，本项目的新路径不要求 App ID。
- 本轮没有发送 TTS、声音复刻训练、试听或其他付费请求，也没有上传声音样本。
- 当前 `.env` 没有经过核验的 TTS/复刻 entitlement、资源 ID、官方音色白名单、价格版本和完整声音样本数据政策，因此这些能力默认关闭。ASR 和手动导入不受影响。

## 已由官方文档核实的接口事实

| 能力                | 已核实事实                                                                                                                          |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| TTS V3 HTTP Chunked | `POST https://openspeech.bytedance.com/api/v3/tts/unidirectional`                                                                   |
| TTS V3 鉴权         | 新版控制台使用 `X-Api-Key`；`X-Api-Resource-Id` 必填并同时决定模型效果和计费商品                                                    |
| 官方 TTS 资源       | 文档列出 `seed-tts-1.0`、`seed-tts-1.0-concurr`、`seed-tts-2.0`                                                                     |
| 复刻合成资源        | 文档列出 `seed-icl-1.0`、`seed-icl-1.0-concurr`、`seed-icl-2.0`                                                                     |
| 声音复刻训练 V3     | `POST https://openspeech.bytedance.com/api/v3/tts/voice_clone`                                                                      |
| 声音复刻查询 V3     | `POST https://openspeech.bytedance.com/api/v3/tts/get_voice`                                                                        |
| 复刻试听            | 查询在成功状态可返回有效一小时的 `demo_audio`；应用必须先私有化并通过所有权检查后再给用户试听                                       |
| 复刻状态            | `Success (2)` 或 `Active (4)` 可用于 TTS                                                                                            |
| 后付费首次使用      | 试听不收音色槽位费；首次正式 V3 合成会使音色转正并收取槽位费用                                                                      |
| 未激活后付费音色    | 文档写明复刻后未调用合成会在 7 天后自动删除                                                                                         |
| 表现控制            | 文档定义 `speech_rate` 为 `[-50,100]`；仅部分音色支持 `emotion`，`emotion_scale` 为 `[1,5]`，所以必须逐音色白名单声明，不做全局猜测 |
| 样本格式上限        | V3 训练接受 wav/mp3/ogg/m4a/aac/pcm，最大 10 MiB；pcm 仅 24 kHz 单声道                                                              |

官方参考：

- [声音复刻 API V3](https://docs.volcengine.com/docs/6561/2227958?lang=zh)
- [HTTP Chunked/SSE 单向流式 V3](https://docs.volcengine.com/docs/6561/1598757?lang=zh)
- [大模型语音合成音色列表](https://docs.volcengine.com/docs/6561/1257544?lang=zh)

## 仍未验证，必须保持关闭

以下事实不能从公开文档或现有 ASR 成功推断；没有明确核验前，能力合同会 fail closed：

- 当前账号/Key 的 TTS 资源权限与实际 `X-Api-Resource-Id`。
- 当前账号/Key 的 V3 声音复刻 entitlement。
- 当前账号实际可用的官方音色及每个音色可用的情感控制。
- 官方音色试听是否通过免费样音、付费 TTS，或另一条账号专属路径提供。
- 控制台当前价格、音色槽位费用与可审计的价格版本来源。
- 声音样本和复刻结果的数据地域、供应商留存、是否用于训练、撤回/删除路径、DSAR 路径与 SLA。

公开文档提到删除和 7 天自动清理语义，但本轮没有找到足以满足产品要求的账号级删除/DSAR/地域合同，因此不能据此开放真实样本上传。

## 环境配置与局部降级

配置入口在 `.env.example`。能力按依赖独立关闭：

- 缺 Key：关闭所有豆包 TTS/复刻能力。
- 选中的 Key 槽位未核验或已撤销：分别以 `credential_unverified` / `credential_revoked` 关闭豆包 TTS/复刻能力；非法槽位以 `credential_slot_invalid` 关闭。
- 只有 Key、没有显式 entitlement：ASR 可照旧，TTS/复刻仍关闭。
- 缺 TTS 资源或价格/合同版本：关闭 TTS 与官方音色；手动导入仍可用。
- 官方音色白名单非法：仅关闭官方音色目录，不把外部音色 ID 暴露给客户端。
- 复刻政策字段不完整：只关闭真实样本提交/复刻；普通 TTS 若已验证可独立工作。

`DOUBAO_OFFICIAL_VOICE_ALLOWLIST_JSON` 是服务端白名单，不是客户端可编辑目录。示例结构（占位符不代表真实音色）：

```json
[
  {
    "id": "voice_owned_alias",
    "label": "经核验的展示名称",
    "providerVoiceId": "仅服务端保存的真实 ID",
    "previewVerified": false,
    "controls": {
      "rate": true,
      "emotions": [
        {
          "id": "emotion_owned_alias",
          "label": "经核验的展示名称",
          "providerValue": "仅服务端保存的真实值"
        }
      ],
      "intensity": true
    }
  }
]
```

客户端只能提交 `voice_*` / `emotion_*` 不透明 ID。服务器解析时会重新检查 entitlement、白名单和资源；直接提交原始 provider voice ID 会失败。

## 版本、报价与密钥轮换

- `DOUBAO_SPEECH_CONTRACT_VERSION` 和 `DOUBAO_SPEECH_PRICE_VERSION` 参与 capability fingerprint。任一变化都会改变指纹，后续报价必须绑定并重新获取。
- 指纹不包含密钥、密钥槽位、外部音色 ID 或资源 ID 明文；它会包含资源与服务端私有映射的单向摘要，所以执行语义改变会使旧报价失效。
- 轮换时先配置 `DOUBAO_SPEECH_API_KEY_NEXT`，将 `DOUBAO_SPEECH_NEXT_CREDENTIAL_STATUS` 保持为 `unverified`；完成无费用核验后才设为 `active`，然后再将 `DOUBAO_SPEECH_ACTIVE_KEY_SLOT` 从 `primary` 切为 `next`。两个槽位的状态独立；切换已核验密钥不会改变能力/报价身份。
- 撤销旧 Key 前应确认没有仍需要旧凭据查询的供应商操作。不得把密钥写入日志、错误、API 响应或功能账本。

## 后续真实 smoke 的授权边界

真实 smoke 必须由用户另行明确授权，并写明边界：使用哪个已核验音色、合成哪段短文本、费用上限、是否会激活克隆槽位。声音复刻 smoke 还必须先完成私有样本存储、同意记录、清理和删除/DSAR 合同验证。自动化测试只使用纯配置和 fixture，不调用供应商。
