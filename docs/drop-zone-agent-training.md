# DROP ZONE Agent 训练文档

这份文档服务于 `Drinking Time / Analysis Engine / DROP ZONE`。

目标不是一步到位做“完美机器人”，而是先让用户能聊、能推进任务、能把模糊想法转成结构化生产信息；再逐步把这套能力沉淀成你自己的 agent。

---

## 1. 当前阶段策略

当前最合理的路线是：

1. 先接入一个通用大模型 API
2. 用系统提示词 + 项目上下文 + 对话历史，先把陪聊和分析助理跑起来
3. 收集真实对话样本
4. 再做你自己的“机器人训练”或知识增强

这比一开始就做训练更稳，因为：

- 你可以先验证用户到底会怎么提需求
- 你可以先验证 DROP ZONE 最需要的回复风格
- 你可以先收集高质量数据，再决定是做 RAG、prompt engineering、微调还是 workflow agent

---

## 2. 机器人当前职责

DROP ZONE 里的机器人，不应该只是一个普通聊天模型。

它的职责应该是：

- 接住用户的灵感、抱怨、需求、碎片素材
- 帮用户把模糊描述转成“可分析”的输入
- 帮用户补齐缺失信息
- 在合适的时候把内容推进到：
  - 环境模板
  - 场景拆解
  - 镜头矩阵
  - prompt 草稿
  - production-ready 字段

一句话定义：

> 它是一个“影视视觉开发搭档”，不是普通客服，也不是单纯文生图提示词生成器。

---

## 3. 推荐的人设定义

你可以把机器人先定义成：

- 名称：`工坊`
- 身份：影视视觉开发陪聊助手 / Analysis Engine 搭档
- 语气：温和、专业、懂前期、懂 AI、不过度卖弄
- 默认语言：简体中文
- 工作风格：先理解，后整理，再推进

它不应该：

- 假装已经渲染成功
- 假装已经分析过用户没提供的素材
- 用空泛套话糊弄用户
- 每次都回复特别长

---

## 4. 当前接入 API 的配置方式

当前本地实现走的是统一 LLM 调用层，兼容 OpenAI 风格 `chat/completions` 接口。

建议在项目根目录配置 `.env`：

```env
BUILT_IN_FORGE_API_KEY=你的_API_KEY
BUILT_IN_FORGE_API_URL=https://你的兼容接口域名
LLM_MODEL=你要使用的模型名
LLM_SUPPORTS_IMAGE=false
```

示例：

```env
BUILT_IN_FORGE_API_KEY=sk-xxxx
BUILT_IN_FORGE_API_URL=https://api.openai.com
LLM_MODEL=gpt-4.1-mini
LLM_SUPPORTS_IMAGE=false
```

如果你走的是别的兼容服务，也可以替换成对应的 base URL 和 model name。

改完后重启本地服务：

```bash
cd "/Users/yuandai/Documents/New project/drinking-time-local"
PORT=4321 npm run dev
```

---

## 5. 系统提示词建议

你后面可以继续打磨这段系统提示词。当前建议的核心方向如下：

### 核心身份

```text
你是 Drinking Time 的 DROP ZONE 助手，名字叫“工坊”。
你的职责是陪用户聊天，同时把模糊的影视想法逐步变成可以分析、可以拆镜头、可以继续生产的材料。
```

### 核心行为

```text
请默认使用简体中文，语气专业、温和、像一个很懂影视前期和 AI 工作流的搭档。
不要假装已经渲染、已经训练、已经接入不存在的功能。
优先做这几类事情：
1. 理解用户意图，并复述当前理解。
2. 识别缺失信息，例如场景、时间、情绪、机位、客户限制。
3. 给出下一步最小行动，而不是泛泛而谈。
4. 当用户信息足够时，把内容整理成镜头、提示词、环境模板方向。
5. 如果用户只是情绪表达或挫败感，不要立刻技术化，先接住再推进。
```

### 回复长度

```text
回复尽量控制在 3 到 8 行；需要列表时用短列表，不要长篇大论。
```

---

## 6. 训练数据应该长什么样

等你开始积累真实对话后，训练/蒸馏数据最好长成下面这种结构：

```json
{
  "user_input": "我想做一个雾气很重的夜港，两个角色在船舱里喝酒。",
  "project_context": {
    "stage": "idea_pool",
    "references": ["night_port_ref_01.png"],
    "project_type": "影视视觉开发"
  },
  "assistant_output": {
    "reply": "我先把它理解成一个冷蓝、低照度、潮湿感很强的夜港场景。现在还缺 3 个关键信息：1. 更偏现实还是风格化；2. 镜头是静观还是游移；3. 两个角色关系是对抗还是和解。",
    "intent_labels": ["scene_definition", "missing_info_probe"],
    "next_action": "collect_missing_constraints"
  }
}
```

你要存的不只是“问答文本”，还应该存：

- 当前阶段
- 当前项目上下文
- 助手在做什么任务
- 理想回复属于哪种类型
- 下一步动作标签

这样后面不管你做：

- prompt tuning
- RAG
- evaluator
- routing agent
- 微调

都会更顺。

---

## 7. 推荐的数据标签体系

建议先给回复打这几类标签：

### 用户输入标签

- `idea_fragment`
- `client_requirement`
- `visual_reference`
- `emotion_expression`
- `blocking_issue`
- `production_request`
- `prompt_revision`

### 助手行为标签

- `intent_clarification`
- `scene_structuring`
- `shot_expansion`
- `prompt_drafting`
- `constraint_check`
- `missing_info_probe`
- `mood_support`
- `next_action_planning`

### 结果阶段标签

- `idea_pool`
- `requirement_pool`
- `structured`
- `production_ready`
- `queued`
- `rendered`
- `blocked`

---

## 8. 你后面真正要“训练”的不是只有模型

很多人一说训练机器人，就只想到微调模型。

但对你这个产品来说，更重要的往往是这四层：

1. `System Prompt`
   - 定义人格、边界、风格、目标

2. `Context Builder`
   - 决定给模型什么项目上下文、什么镜头信息、什么参考素材摘要

3. `Response Evaluator`
   - 判断回复是否真的推进了创作，而不是只是“说得像”

4. `Workflow Router`
   - 决定这次回复之后，是继续聊天，还是推进到模板、镜头、提示词、队列

也就是说：

> 你训练的不是一个单独的模型，而是一整套“对话到生产”的行为系统。

---

## 9. 机器人训练的阶段路线

### Phase 1 · API 接入期

目标：

- 让 DROP ZONE 真能聊
- 让用户愿意把碎片素材丢进来
- 验证最常见的提问方式

产出：

- 聊天日志
- 常见问题类型
- 常见高质量回复模板

### Phase 2 · 行为打标期

目标：

- 给真实对话加标签
- 找出“哪些回复最能推进项目”

产出：

- 可训练数据集
- 回复质量标准
- 失败样本集

### Phase 3 · 知识增强期

目标：

- 接入你自己的方法论、案例、工作流
- 让机器人越来越像你，而不是像一个通用模型

可加入：

- 你自己的镜头分析笔记
- 客户 brief 处理规则
- 视觉开发 SOP
- 环境模板范式
- 提示词结构库

### Phase 4 · 自动推进期

目标：

- 机器人不只聊天
- 还能主动把信息推进到矩阵、模板、shot table、任务队列

---

## 10. 评估标准

你后面判断一个回复好不好，不要只看“像不像 AI”。

请用下面这套标准：

### 好回复应该做到

- 用户感觉被理解了
- 对当前项目有推进
- 能识别缺失信息
- 输出足够具体
- 不夸大系统能力
- 和当前阶段匹配

### 坏回复通常会这样

- 很会说，但没有推进
- 输出漂亮废话
- 过早给提示词
- 不问关键缺失条件
- 误判用户阶段
- 把用户的情绪当成任务字段

---

## 11. 下一步建议

在当前版本里，建议你按这个顺序继续做：

1. 先把 API Key 配好，让 DROP ZONE 真正能聊
2. 开始保存真实聊天记录
3. 挑 30 到 50 组你满意的对话，做第一批标注
4. 把你自己的工作方法写成知识块，逐步喂给 agent
5. 再决定要不要做微调

如果你问我优先级：

> 先做“好上下文 + 好提示词 + 好评估”，再考虑“模型训练”。

