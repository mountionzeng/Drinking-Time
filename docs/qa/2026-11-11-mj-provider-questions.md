# MJ原图编辑：可转发供应商的核查问题

仅整理，尚未替用户发送。不要把API密钥、原图私有地址或Legnext任务UUID贴到公开渠道。

## 发给302

我们按官方文档 https://doc.302.ai/317861511e0 调用 `POST https://api.302.ai/mj/submit/edits`，Bearer认证，JSON字段为 `prompt` 和 `image`。2026-11-11真实原图编辑返回HTTP404，没有任务号。同一密钥GET `/v1/models` 成功且含midjourney。另用空JSON（不含图片或prompt）核查，仍返回 `{"status":404,"error":"Not Found","path":"/mj/submit/edits"}`；单数 `/mj/submit/edit` 也404。

请确认：当前可用的外部图片MJ编辑完整URL与最小请求是什么？是否需单独开通或已迁移路由？此入口使用旧Retexture还是新版V8.1/V8.2 Edit Model？目前文档0.05PTC是否仍适用，404是否产生费用？请提供成功响应及查询任务方式。我们需要原图编辑，不接受把参考图放入Imagine当作等价替代。

## 发给Legnext

我们使用 `POST https://api.legnext.ai/api/v1/retexture`，字段 `imgUrl`（可公开读取HTTPS原图）和 `remixPrompt`。2026-11-11多次已记录任务失败；已试过无flags的英文最小修改要求，仍得到 `task_type: retexture`、`status: failed`、`Invalid_Prompt_Parameter`，`usage.consume: 0`。没有在失败后继续自动购买。

请核查Retexture当前上游是否可用，并给出可运行的最小请求。MJ官方现在提供V8.1/V8.2 Edit Model（`--edit`），但你们当前参数矩阵和JSON契约未列出该参数；是否已支持？若支持，请给出实际路由、请求结构、价格和回执格式。我们的输入是外部视频抽帧，没有成功MJ父任务，不能直接使用要求jobId的旧 `/v1/edit`。请勿建议用全图蒙版重绘或普通垫图替代，因为要求保留原图构图、明暗、灰度和物体位置，仅细化已有色彩。

任务UUID可由账号持有人在供应商控制台按上述时间查询，再通过私有支持渠道提供。
