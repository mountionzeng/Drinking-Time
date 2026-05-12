# Drinking Time 产品定义与双引擎架构

## 1. 为什么叫 Drinking Time

这个名字是在讲一种创作状态。

`Drinking Time` 可以被定义为：

> 创作者进入灵感、吸收世界、提取气氛、并把想象转成影像的时刻。

更准确地说，它表达的是：

- 轻松进入创作状态
- 释放个人想象力
- 把天马行空的画面感转成专业影像语言
- 最终把灵感变成工业级、可交付、可盈利的产品

所以这个名字对应的是：

> 从灵感摄入到影像产出的那段创作时间。

这让 `Drinking Time` 既有情绪感，也有方法论意味。

它不是一个冷冰冰的生产工具名，而是一个带有创作者立场的品牌名。

## 2. 需求

`Drinking Time` 是一个面向影视、广告、短片客户的专业工作台，核心分成两部分：

1. 分析部分
  - 输入参考图、参考片、剧本、分镜、brief，
  - 把这些非结构化信息拆成可以量化、可以复用、可以传给模型的提示词和数据
2. 创作部分
  - 基于分析结果去生成图像、镜头、视频片段或视觉方案
  - 允许继续人工修正、迭代、筛选和交付

所以它的本质是：

> 一个把影视前期理解能力转成结构化 AI 生产能力的双模块系统。

## 3. 品牌使命

如果用一句话总结这个品牌想做的事，应该是：

> 让创作者更轻松地创造出美丽、专业、影视级别的影像，并把独特想象力转化成工业级、可盈利的作品。

这句话很重要，因为它同时覆盖了三层价值：

- 对创作者：降低表达门槛
- 对作品：提高专业完成度
- 对商业：让创意具备交付和盈利能力

## 4. 核心优势

这件事之所以成立，不是因为你会调 API，而是因为你有传统影视数字绘景背景。

你的价值在于：

- 你能读懂剧本和镜头语言
- 你能理解场景、气氛、空间、时代、调性
- 你知道哪些描述对视觉结果真正有用
- 你可以把“感觉”翻译成“可执行的视觉参数”

这意味着你的产品核心竞争力不是模型本身，而是：

> “分析能力 + 审美判断 + 生成控制能力”

## 5. 正确的产品定义

建议把 `Drinking Time` 定义成：

> 一个服务影视视觉开发与 AI 生成流程的创作平台。前半段负责理解和结构化素材，后半段负责生成、迭代和输出。

这个定义比“个人工作室官网”更准确，也比“AI 视频工具”更有壁垒。

## 6. 两个核心模块

### 模块 A：Analysis Engine

这是系统的前半段。

它负责把碎片化参考图、剧本片段、分镜描述和 brief 转成结构化数据，并最终沉淀为可复用的影视环境模板。

#### 输入

- 单张参考图
- 多张参考图
- 视频参考片段
- 剧本片段
- 分镜片段
- 客户 brief
- 关键词碎片
- 你自己的临时笔记

#### 输出

- 风格标签
- 场景类型
- 时间 / 天气 / 光线信息
- 相机的焦距
- 镜头类型
- 运动方式
- 空间层次
- 主体元素
- 材质特征
- 色彩倾向
- 气氛关键词
- 可直接用于模型的 prompt 草案
- 负面提示词
- 参数建议
- 影视环境模板

#### 这个模块真正做的事

不是“识别图里有什么”，而是把碎片化视觉线索整理成系统化环境定义，再把视觉语言转成生产语言。

比如把一句：

> 废弃工业区里的潮湿夜景，远处有钠灯，镜头缓慢推进，空气里有雾，整体压抑但不恐怖

拆成：

- 场景：abandoned industrial district
- 时间：night
- 气候：humid / misty
- 光源：sodium vapor lights / distant practical lights
- 镜头：slow push-in
- 空气感：volumetric fog
- 调性：oppressive / restrained / cinematic
- 负面项：no horror creatures, no neon cyberpunk, no cartoon styling

这一步才是你最值钱的地方。

#### 这个模块最重要的产物

Analysis Engine 最重要的输出不应该是一段一次性 prompt，而应该是：

> 一个可以跨项目复用、跨模型调用、可人工继续编辑的影视环境模板。

这个模板相当于把“环境世界观”从杂乱参考里抽出来，变成你自己的标准资产。

### 模块 B：Creation Engine

这是系统的后半段。

它负责把分析结果变成可交付内容。

#### 输入

- Analysis Engine 输出的结构化结果
- 你人工修正过的 prompt
- 参考首帧 / 尾帧
- 输出时长
- 画幅比例
- 分辨率
- 模型选择
- 成本档位

#### 输出

- 预览图
- 概念镜头
- 视频片段
- 不同风格版本
- 可供客户筛选的方案包

#### 这个模块真正做的事

- 生成
- 批量试错
- 对比不同方案
- 记录版本
- 保留可回溯参数
- 为人工后期和正式交付做准备

## 7. 为什么一定要分成这两段

因为客户真正付钱的，不是“你按了生成按钮”，而是：

- 你有没有理解需求
- 你能不能把模糊描述变成清晰方案
- 你能不能稳定地产出接近目标的结果

如果没有分析层，创作层就只是普通模型前端。

如果没有创作层，分析层就只是笔记工具。

你真正的产品价值在于两者连起来。

## 8. 产品第一版应该怎么做

V1 不要一上来就做成完整 SaaS。

第一版先做成一个“专业展示 + 可操作原型”的系统。

### V1 目标

- 讲清楚你是谁、你能做什么
- 展示你如何把碎片化参考信息结构化
- 展示你如何把结构化结果继续生成
- 让客户能提交项目需求
- 让你自己先能本地跑通这两段流程

## 9. 第一版信息架构

### 网站层

- `/`
  - 首页
- `/about`
  - 背景与方法
- `/portfolio`
  - 案例展示
- `/services`
  - 服务范围
- `/inquiry`
  - 需求提交

### 工具层

- `/analysis`
  - 分析工作台
- `/analysis/result`
  - 结构化结果页
- `/create`
  - 创作工作台
- `/create/result/:taskId`
  - 生成结果页

这样前台和工具层是并行存在的。

前台负责获客和信任，工具层负责真正的工作流。

## 10. Analysis Engine 的产品结构

### 页面应包含

- 素材上传区
- 参考素材时间轴
- 剧本 / brief 输入区
- 碎片信息整理区
- 分析维度面板
- 结果结构化展示区
- 环境模板生成区
- prompt 生成区
- prompt 编辑区
- 导出按钮

### `/analysis` 首页首屏交互稿

这一屏的目标不是“展示很多功能”，而是让客户一眼明白三件事：

- 这里可以直接开始
- 不需要先整理文件
- 系统会把碎片素材自动变成有结构的分析流

#### 首屏标题文案

主标题：

> 把碎片参考，整理成可生产的影视环境模板

辅助说明：

> 直接拖入图片、剧本、brief、分镜或笔记。系统会自动识别素材类型、按天整理时间轴，并生成可继续编辑的环境分析结果。

#### 首屏布局

建议首屏分成三块：

- 左侧：拖拽导入区
- 中间：自动生成的时间轴预览
- 右侧：分析结果预览

可以理解成：

```text
┌──────────────────────────────────────────────────────────────┐
│ 标题 + 一句话说明                                             │
├──────────────────┬──────────────────────┬────────────────────┤
│ 拖拽导入区       │ 时间轴预览           │ 结果预览           │
│ Drop anything    │ Mar 18 / Mar 19 ... │ Environment Draft  │
│ 图 / 文 / PDF    │ 素材卡片按天排列     │ lighting / mood... │
│ 一键开始分析     │ 可改顺序与重要度     │ Start Analysis     │
└──────────────────┴──────────────────────┴────────────────────┘
```

#### 默认空状态

左侧导入区显示：

- 标题：`Drop your references here`
- 中文提示：`把图片、视频、PDF、剧本片段、brief 或笔记直接拖进来`
- 辅助提示：`不用先分类，系统会自动整理`

导入区下方放一排轻量标签：

- `Images`
- `Scripts`
- `Storyboards`
- `Briefs`
- `Notes`

主按钮：

- `开始分析`

次按钮：

- `导入示例素材`

这里的重点不是让用户选复杂上传方式，而是给他一个很低压力的起点。

#### 拖入后的即时反馈

用户一拖入素材，首屏立刻进入“自动整理中”状态。

文案建议：

- `Reading references...`
- `识别素材类型`
- `提取日期和标题`
- `按天整理时间轴`
- `建立初始分析结果`

这个状态应该是轻量动态的，不要像传统后台上传页面一样复杂。

#### 自动整理后的首屏状态

中间时间轴区立即出现：

- `Mar 18`
- `Mar 19`
- `Undated`

每条素材卡片显示：

- 缩略图或文件图标
- 标题
- 类型
- 日期
- 重要度滑杆或 1-5 级选择器

卡片右上角可以有两个轻量动作：

- `Pin`
- `Exclude`

素材卡片默认由系统先排好，用户只做修正。

#### 右侧结果预览区

这一块不要一开始就塞满参数，而应该先给“分析正在形成”的感觉。

建议先显示 4 个预览模块：

- `Mood`
- `Lighting`
- `Spatial Structure`
- `Camera Language`

每个模块先给出 2-4 个系统提炼出的关键词。

底部显示一个模板草案卡：

- `Environment Template Draft`
- 一行 summary
- 当前参考素材数量
- 当前关键参考数量

底部主按钮：

- `生成完整分析`

次按钮：

- `继续添加素材`

#### 首屏应该允许的最少人工操作

在这一屏，用户只需要能做这几件事：

- 拖入更多素材
- 改某条素材日期
- 改重要度
- 调整顺序
- 排除素材
- 开始完整分析

不要在首屏就要求：

- 手动建文件夹
- 手动建分类
- 手动填写大量表单
- 先写完整 prompt

#### 交互原则

这屏最重要的体验不是“强功能感”，而是：

> 我随手丢进去的混乱素材，正在被快速整理成专业工作流。

所以首屏应该更像：

- 自动吸收
- 自动整理
- 自动显现结构

而不是：

- 上传表单
- 多步骤向导
- 繁琐配置面板

#### 适合直接写进页面的文案

Hero 标题：

> Turn scattered references into a production-ready cinematic environment.

Hero 副标题：

> Drop images, scripts, briefs, storyboards, or notes. Drinking Time auto-sorts them into a daily timeline and prepares a reusable analysis draft.

空状态提示：

> No need to pre-organize anything. Just drop it in.

分析按钮：

- `Start Analysis`

示例入口：

- `Try with Sample References`

### 素材导入原则

这里的交互应该极简。

客户不应该先学会怎么分类、怎么命名、怎么手动排顺序，才敢开始用。

更合理的方式是：

- 直接把图片、视频、文字、PDF、剧本片段拖进网页
- 系统自动识别素材类型
- 系统自动提取可用时间信息
- 系统自动给出初始排序
- 用户只在必要时修正

也就是说，上传动作应该被弱化成：

> 拖进去就行，网页自己先整理。

#### 导入后的系统默认行为

素材进入系统后，先自动做这几件事：

1. 类型识别
  - 图像
  - 视频
  - 剧本文本
  - 分镜
  - brief
  - 笔记
2. 基础信息提取
  - 文件名
  - 可见标题
  - 创建时间 / 修改时间
  - 文本中的日期线索
3. 自动排序
  - 优先按明确日期排序
  - 没有明确日期时，按导入顺序和语义相关度排序
  - 放入 `Undated / 未定时间`
4. 自动归组
  - 同一天的素材自动聚合
  - 相似主题素材自动靠近展示

这样用户第一次看到的就不是一堆散文件，而是一条已经初步整理好的参考时间轴。

#### 人工只管修正，不管搬运

用户应该能做的操作保持很少：

- 改日期
- 调顺序
- 调重要程度
- 锁定某条素材
- 排除某条素材

不要让用户先做大量文件管理工作。

### 场景/镜头产出表（NLP 解构表）

你这个想法非常关键：  
Analysis Engine 里除了时间轴，还应该有一张“对应具体场景/镜头”的产出表。

这张表的作用是把客户需求从“自然语言描述”推进到“可生产任务”。

也就是说：

- 客户把图、文字、剧本、brief 拖进来
- 系统用 NLP 把需求拆成结构化镜头条目
- 每条条目判断当前是否可产出
- 可产出的条目直接进渲染队列
- 还没到可产出的条目留在灵感/需求池

这张表要解决的不是展示信息，而是生产调度。

#### 表格建议字段

最小字段建议：

- `sceneNo`（场景号）
- `shotNo`（镜头号）
- `sourceSummary`（需求摘要）
- `intentType`（灵感 / 客户明确需求 / 导演指令）
- `status`（当前阶段）
- `readinessScore`（可产出评分）
- `deadline`（该镜头死线）
- `priority`（优先级）
- `blockingIssues`（阻塞项）
- `nextAction`（下一步动作）
- `autoRender`（是否允许自动渲染）

#### 状态机建议

每条镜头建议有一个清晰状态，不要只有“完成/未完成”：

- `idea_pool`：艺术灵感，暂不产出
- `requirement_pool`：客户需求，信息不完整
- `structured`：已结构化，可继续细化
- `production_ready`：达到可产出条件
- `queued`：已进入渲染队列
- `rendered`：已出图
- `blocked`：存在阻塞（信息缺失/冲突/超预算）

这样你就能把“灵感”和“产出任务”放在同一系统里，但不会混在一起。

#### 自动渲染触发规则

你说的“如果某个镜头能出图就直接渲”可以做成明确规则：

满足以下条件才触发自动渲染：

- `status = production_ready`
- `readinessScore >= threshold`（例如 0.75）
- `autoRender = true`
- 没有阻塞项
- 没有锁定冲突（例如客户暂缓）

触发后：

- 自动生成首版图像（first-pass）
- 写回版本记录
- 更新状态为 `rendered` 或 `queued`

#### 死线驱动（倒排产出）

死线不应该只是显示字段，而应该影响队列顺序。

推荐做法：

- 先设项目总交付时间 `projectDeadline`
- 系统按镜头复杂度和依赖关系反推每条 `shotDeadline`
- 队列按 `deadline + readiness + priority` 综合排序

这样就能用需求倒逼产出，不会变成“谁先点谁先生成”。

#### 对“只是灵感”的处理

如果某条输入只是灵感，还没到可产出阶段，应该自动进入：

- `idea_pool`

并且系统给出最小建议：

- 缺少哪些字段才可产出
- 建议补什么参考
- 预计需要几轮细化

不要强行渲染“还没准备好”的条目，这会浪费计算预算，也会降低结果质量。

#### 表格在界面里的位置

建议放在 `/analysis` 首屏中下区，和时间轴并行：

- 上半区：拖拽导入 + 时间轴
- 下半区：场景/镜头产出表

这样用户可以直接看到：

- 时间维度（素材如何演进）
- 生产维度（哪些镜头能产出、哪些还不行）

#### `/analysis` 低保真线框（桌面）

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ Top Bar: Project / Deadline / Global Filter / Auto Render Switch          │
├─────────────────────────────────────────────────────────────────────────────┤
│ 上半区：拖拽导入 + 时间轴                                                   │
│                                                                             │
│  [Drop Zone]      [Day Timeline Buckets]          [Template Draft Preview] │
│  图/文/PDF拖入     Mar 24 | Mar 25 | Undated       Mood / Lighting / Camera│
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│ 下半区：场景/镜头产出表（NLP 解构表）                                        │
│                                                                             │
│ [Filter: status] [Filter: intent] [Sort: deadline] [Only AutoRender]      │
│                                                                             │
│ ┌────┬─────┬─────┬──────────────┬────────────┬──────────────┬───────┬────┐ │
│ │Sel │Scene│Shot │Status        │Readiness   │Deadline      │Auto   │Act │ │
│ ├────┼─────┼─────┼──────────────┼────────────┼──────────────┼───────┼────┤ │
│ │□   │S03  │A012 │production... │0.82 (bar)  │2026-03-30    │ON     │... │ │
│ │□   │S01  │A004 │idea_pool     │0.28 (bar)  │-             │OFF    │... │ │
│ │□   │S05  │A020 │blocked       │0.67 (bar)  │2026-03-28    │ON     │... │ │
│ └────┴─────┴─────┴──────────────┴────────────┴──────────────┴───────┴────┘ │
│                                                                             │
│ [Batch: Move To Queue] [Batch: Set Deadline] [Batch: Set AutoRender]       │
│ [Generate Ready Shots] [View Blocked Reasons]                               │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 表头字段（第一版）

建议第一版先固定这些列，避免过宽：

- `Select`
- `Scene`
- `Shot`
- `Intent`
- `Status`
- `Readiness`
- `Deadline`
- `Priority`
- `AutoRender`
- `Blocking`
- `NextAction`
- `Actions`

#### 行内动作（Actions）

每行右侧 `Actions` 建议最小包含：

- `Open Blueprint`
- `Render Now`（仅在 `production_ready` 可用）
- `Set Deadline`
- `Move To Idea Pool`
- `Mark Blocked`

#### 批量动作（表格上方或下方）

最实用的批量动作建议是：

- `Set Deadline`
- `Set Priority`
- `Enable AutoRender`
- `Disable AutoRender`
- `Queue Ready Shots`
- `Export Shot List`

#### 状态视觉规则

建议固定状态颜色，减少认知负担：

- `idea_pool`：灰色
- `requirement_pool`：蓝灰
- `structured`：蓝色
- `production_ready`：绿色
- `queued`：青色
- `rendered`：深绿
- `blocked`：红色

同时给 `readinessScore` 用统一进度条样式，避免只靠数字判断。

#### 死线可视化

`deadline` 列建议加倒计时显示：

- `D-5`
- `D-1`
- `Overdue +2`

并且超期条目自动置顶（除非用户手动改排序）。

#### 行展开详情（避免主表过宽）

点击一行可以展开二级详情，显示：

- `sourceSummary`
- `blockingIssues`
- `linkedTemplateId`
- `linkedShotBlueprintId`
- 最近一次渲染结果缩略图

这样主表保持干净，但深信息可快速查看。

#### 空状态与异常状态

表格应有三个明确状态：

- `Empty`：还没有镜头条目，提示“继续拖入素材开始 NLP 解构”
- `Building`：NLP 正在拆需求，显示逐步进度
- `Blocked`：解析失败或字段冲突，提示修复入口

#### `/analysis` 移动端折叠方案

移动端不要强行显示完整表格。

建议改为卡片列表，每张卡片显示：

- `Scene / Shot`
- `Status`
- `Readiness`
- `Deadline`
- `AutoRender`
- 一个主动作按钮（通常是 `Open Blueprint` 或 `Render Now`）

顶部保留：

- `Filter`
- `Sort`
- `Queue Ready Shots`

#### 适合落地的数据结构

```ts
type ShotProductionRow = {
  id: string;
  sceneNo: string;
  shotNo: string;
  sourceSummary: string;
  intentType: "idea" | "client_requirement" | "director_note";
  status:
    | "idea_pool"
    | "requirement_pool"
    | "structured"
    | "production_ready"
    | "queued"
    | "rendered"
    | "blocked";
  readinessScore: number; // 0-1
  deadline?: string; // ISO date
  priority: "low" | "medium" | "high" | "urgent";
  autoRender: boolean;
  blockingIssues?: string[];
  nextAction?: string;
  linkedTemplateId?: string;
  linkedShotBlueprintId?: string;
};
```

#### 与现有 ShotBlueprint 的关系

这张表不是替代 `ShotBlueprint`，而是它的入口层。

可以理解为：

- `ShotProductionRow`：调度和可产出判断层
- `ShotBlueprint`：镜头的完整制作参数层

只有当某行进入 `production_ready` 后，才强制补全 `ShotBlueprint` 的关键字段并提交渲染。

### 参考素材时间轴与权重机制

Analysis Engine 的参考素材区，不应该只是一个无序图库。

更合理的做法是：

- 按素材提供的时间信息，生成一个以“天”为单位的时间轴
- 每一天作为一个时间分组节点
- 图片、剧本片段、分镜、brief、笔记都可以挂到某一天下面
- 如果某条素材没有明确日期，就放到 `Undated / 未定时间` 分组

这样做的好处是：

- 能看出参考素材如何沿时间推进
- 能看出某几天是不是视觉定义最关键的阶段
- 能把“前期参考”“中段修正”“最终锁定素材”区分开

#### 时间轴界面建议

- 左侧：按天排列的时间轴
- 中间：当天素材卡片
- 右侧：当前生成中的环境模板和参数面板

每张素材卡片至少显示：

- 标题
- 类型（图像 / 剧本 / 分镜 / brief / 笔记）
- 日期
- 重要程度
- 提炼出的关键标签
- 是否参与当前模板生成

#### 重要程度机制

每条素材都应该允许手动设置 `importance`

建议先用 5 档：

- 1 = 弱参考
- 2 = 辅助参考
- 3 = 标准参考
- 4 = 关键参考
- 5 = 锚点参考

这个值应该同时影响两件事：

1. 界面显示大小
  - 越重要，时间轴上的卡片越大
  - 越重要，视觉优先级越高
2. 生成参数权重
  - 越重要，这条素材对环境模板和 prompt 的贡献越大

但这里要注意：

> 卡片显示大小和模型生成权重应该相关，但不应该完全等同。

也就是说，前端视觉大小可以用 `importance` 直接控制；  
而真正传给分析结果的权重，应该是一个综合值。

例如：

```ts
finalWeight =
  manualImportance *
  relevanceScore *
  sourceConfidence *
  timeConfidence;
```

这样会更稳，因为：

- 有些素材虽然你主观上觉得重要，但信息并不完整
- 有些素材日期可信度不高
- 有些素材只对局部参数有效，不应该全局放大

#### 权重应该作用在哪些输出上

重要程度不应该只影响一整段 prompt，而应该作用在结构化字段上：

- 色彩倾向
- 光照逻辑
- 空间层次
- 材质特征
- 镜头语言
- 情绪关键词
- 负面约束
- 默认生成参数

例如：

- 某张夜景图的重要度高，那么它对 `lighting`、`colorPalette`、`atmosphere` 的权重更高
- 某条分镜的重要度高，那么它对 `cameraLanguage`、`movement`、`shotPurpose` 的权重更高
- 某个 brief 的重要度高，那么它对 `exclusions`、`commercial constraints`、`delivery format` 的权重更高

所以更准确的说法是：

> 不是“素材整体权重”直接压一切，而是“素材在不同维度上的权重分配”。

### 分析维度建议

- 题材
- 时代
- 地理 / 空间属性
- 气候
- 时间段
- 光照逻辑
- 色调
- 情绪
- 镜头景别
- 镜头运动
- 参考艺术风格
- 需要避免的元素

### 输出数据格式建议

不要只输出一段长 prompt。

应该先输出一个可复用的 `EnvironmentTemplate`，prompt 只是这个模板的派生结果。

例如：

```ts
type ReferenceFragment = {
  id: string;
  title: string;
  sourceType: "image" | "video" | "script" | "storyboard" | "brief" | "note";
  capturedAt?: string;
  dateBucket?: string; // 例如 2026-03-18
  datePrecision?: "day" | "range" | "unknown";
  importance: 1 | 2 | 3 | 4 | 5;
  isPinned?: boolean;
  relevanceByDimension?: {
    lighting?: number;
    colorPalette?: number;
    atmosphere?: number;
    spatialStructure?: number;
    materiality?: number;
    cameraLanguage?: number;
    exclusions?: number;
  };
  extractedSignals?: string[];
  notes?: string[];
};

type EnvironmentTemplate = {
  id: string;
  name: string;
  summary: string;
  scenarioType: string;
  era?: string;
  locationProfile: {
    region?: string;
    terrain?: string;
    architecture?: string[];
    spaceScale?: "tight" | "medium" | "vast";
  };
  environmentLayers: {
    foreground: string[];
    midground: string[];
    background: string[];
    skyline?: string[];
  };
  atmosphere: {
    mood: string[];
    weather?: string[];
    season?: string;
    timeOfDay?: string;
    airDensity?: string;
  };
  lighting: {
    keySources: string[];
    practicalLights?: string[];
    contrast?: string;
    colorTemperature?: string[];
  };
  materials: string[];
  colorPalette: string[];
  soundImagery?: string[];
  cameraLanguage: {
    shotSizes?: string[];
    movements?: string[];
    lensFeel?: string[];
  };
  exclusions: string[];
  promptBlocks: {
    environmentPrompt: string;
    cameraPrompt?: string;
    atmospherePrompt?: string;
    negativePrompt: string;
  };
  generationDefaults: {
    aspectRatio?: string;
    duration?: number;
    motionStrength?: string;
    qualityTier?: string;
  };
  references: ReferenceFragment[];
};

type AnalysisResult = {
  template: EnvironmentTemplate;
  promptDraft: string;
  reusableTags: string[];
  timeline: {
    bucketUnit: "day";
    buckets: {
      date: string;
      fragmentIds: string[];
    }[];
    undatedFragmentIds?: string[];
  };
};
```

这样后面你接任何模型都更稳，而且你可以把模板存下来，下次在类似项目里直接复用。

### 用于制作的必须输出

如果目标不是“分析完就结束”，而是要直接服务制作流程，那么 Analysis Engine 实际上应该输出两层东西：

1. `EnvironmentTemplate`
  - 可复用的环境模板
  - 解决“这个世界长什么样”
2. `ShotBlueprint`
  - 面向单个场景 / 镜头的制作蓝图
  - 解决“这一镜具体怎么拍、怎么生、怎么继续改”

场景号、镜头号、焦距这些字段，更应该属于 `ShotBlueprint`，而不是环境模板本身。

例如：

```ts
type ShotBlueprint = {
  projectId: string;
  sequenceNo?: string;
  sceneNo: string;
  shotNo: string;
  version: string;

  environmentTemplateId: string;
  shotPurpose: string;
  narrativeBeat?: string;
  continuityNotes?: string[];

  subject: string[];
  action: string[];
  blocking?: string[];

  camera: {
    shotSize: string;
    angle?: string;
    height?: string;
    focalLengthMm?: number;
    lensFeel?: string;
    movement?: string;
    framingNotes?: string[];
  };

  timing: {
    durationSec?: number;
    fps?: number;
    aspectRatio?: string;
  };

  lighting: {
    keySource?: string[];
    practicals?: string[];
    contrast?: string;
    colorTemperature?: string[];
    atmosphereFx?: string[];
  };

  generation: {
    model?: string;
    promptDraft: string;
    negativePrompt?: string;
    referenceAssets?: string[];
    seed?: number;
    resolution?: string;
    motionStrength?: string;
  };

  editableFields?: string[];
  lockedFields?: string[];
  handoffNotes?: string[];
};
```

### 制作阶段建议必须有的字段

下面这些字段，我建议分成“必须有”和“可补充”两层来看。

#### A. 识别与版本

必须有：

- 项目号 `projectId`
- 场景号 `sceneNo`
- 镜头号 `shotNo`
- 版本号 `version`
- 环境模板 ID `environmentTemplateId`

原因：

- 没有这些字段，后面就没法追踪、迭代、回退和交付。

#### B. 叙事目的

必须有：

- 镜头目的 `shotPurpose`
- 情绪 / 戏剧点 `narrativeBeat`
- 连戏说明 `continuityNotes`

原因：

- 同一个环境里，不同镜头的任务完全不同。这个字段决定镜头为什么存在。

#### C. 主体与调度

必须有：

- 主体 `subject`
- 动作 `action`
- 调度 / 站位 `blocking`

原因：

- 没有主体和动作，模型容易只生成“环境图”，而不是可用于镜头开发的画面。

#### D. 摄影参数

必须有：

- 景别 `shotSize`
- 机位角度 `angle`
- 镜头运动 `movement`
- 焦距 `focalLengthMm`
- 画幅比例 `aspectRatio`
- 时长 `durationSec`

建议有：

- 机位高度 `height`
- 镜头感受 `lensFeel`
- 帧率 `fps`
- 构图备注 `framingNotes`

原因：

- 这些字段决定它是不是“镜头”，而不只是“好看的图”。

#### E. 光照与气氛

必须有：

- 主光源 `keySource`
- 实际光源 `practicals`
- 对比关系 `contrast`
- 气氛效果 `atmosphereFx`

建议有：

- 色温倾向 `colorTemperature`

原因：

- 影视环境的可复用性，很多时候就靠光照逻辑和空气感。

#### F. 生成参数

必须有：

- `promptDraft`
- `negativePrompt`
- 模型名 `model`
- 参考素材 `referenceAssets`

建议有：

- `seed`
- `resolution`
- `motionStrength`

原因：

- 这些是把分析结果真正送进生成流程的桥梁。

#### G. 人工接管字段

必须有：

- 可编辑字段 `editableFields`
- 锁定字段 `lockedFields`
- 交接说明 `handoffNotes`

原因：

- 你已经明确说了镜头号、焦距这些以后可能手动改，那系统必须从一开始就支持“AI 先生成，人工再接管”。

### 哪些字段适合 AI 先猜，哪些字段必须人工定

适合 AI 先给建议：

- 场景类型
- 景别
- 镜头运动
- 焦距范围
- 光照标签
- 气氛关键词
- prompt 草案

必须允许人工最终确认：

- 场景号
- 镜头号
- 最终焦距
- 时长
- 连戏逻辑
- 交付用途
- 锁定字段

这一步很重要，因为你做的是生产工具，不是自动写诗工具。

### 模板化输出的真正意义

你不是在做“每次重新分析一次”的工具。

你更应该做的是一个环境模板库，让 Analysis Engine 持续把碎片输入沉淀成标准化资产。

比如最后形成这样的模板类型：

- 废弃工业夜景模板
- 未来高密度旧城区模板
- 山地雾林神秘空间模板
- 末世高速公路黄昏模板
- 南方潮湿旧居民区模板

这样你后面接单时，不需要每次从零开始。

## 11. Analysis Engine 的正确流程

更准确地说，Analysis Engine 应该分成六步：

1. Fragment Intake
  - 接收碎片化输入
  - 自动识别素材类型
  - 自动提取时间线索
  - 自动完成初始排序
2. Timeline Mapping
  - 按天把素材挂到时间轴上
  - 识别未定时间素材
  - 建立时间上下文
3. Weighted Normalization
  - 给每条素材设置重要程度
  - 计算不同维度的参考权重
4. Semantic Normalization
  - 把不统一的描述整理成统一字段
5. Environment Structuring
  - 组合成完整的影视环境模板
6. Prompt Derivation
  - 从模板派生 prompt 和生成参数

所以 prompt 不是核心资产，模板才是核心资产。

## 12. Creation Engine 的产品结构

### 页面应包含

- 节点式创作画布
- prompt 预览与编辑
- 对话框协作面板
- 模型选择
- 参数配置
- 参考图上传
- 生成任务提交
- 任务状态展示
- 多版本结果对比
- 收藏 / 导出 / 继续迭代

### Creation Engine 的主交互不应该是传统表单

如果 Analysis Engine 更像“把碎片整理成结构”，  
那么 Creation Engine 应该更像“把结构重新编排成生产流程”。

所以它不应该只有：

- 一堆参数输入框
- 一个大 prompt 文本框
- 一个提交按钮

更合理的主界面是：

> 一个可以自由组合的节点式创作画布。

### 节点式操作界面

用户应该可以像搭工作流一样，自由组合这些节点：

- `Environment Template`
- `Shot Blueprint`
- `Reference Images`
- `Prompt Block`
- `Model`
- `Generation Params`
- `Mask / Region`
- `Variation`
- `Upscale / Refine`
- `Output`

这样用户看到的就不是“固定表单”，而是：

- 哪个输入影响哪个结果
- 哪个步骤在控制环境
- 哪个步骤在控制镜头
- 哪个步骤在做局部修正
- 哪个分支产出了不同版本

这对创作者非常重要，因为影视开发本身就不是线性表单流程，而是反复分叉、比较、回收和重组。

### 节点画布的最小结构

第一版不需要做得像 ComfyUI 那么重。

最小可以先有这 6 类节点：

1. `Input`
  - 参考图
  - 文字 brief
  - 分析结果
2. `Structure`
  - Environment Template
  - Shot Blueprint
3. `Prompt`
  - 正向 prompt
  - negative prompt
4. `Model`
  - 模型选择
  - 模型特定参数
5. `Edit`
  - 局部修改
  - 风格调整
  - 参数覆盖
6. `Output`
  - 预览图
  - 视频片段
  - 版本分支

### 对话框不是主入口，而是局部控制台

你说的对话框非常有必要，但它的最佳位置不是替代画布，而是作为画布旁边的协作面板。

更准确地说：

- 节点画布负责结构和流程
- 对话框负责解释和修改

用户可以在对话框里说：

- `这个版本整体太冷了`
- `把第三个结果的雾气减一点`
- `只改这个镜头的焦距感，不动环境`
- `参考第一张图的光，不要改构图`

这样语言交互和节点交互是并行的。

### 指针编辑模式

这里最关键的就是你说的“指到某个东西，只改那个东西”。

这应该做成一个正式能力：

> Pointer Edit Mode / 指针编辑模式

用户可以把指针指向：

- 某一张结果图的局部区域
- 某一段 prompt 文本
- 某一个节点
- 某一个参数字段
- 某一个版本分支

然后只对这个目标发出修改指令。

### 指针可以指向什么

建议第一版先支持四类目标：

1. `Image Region`
  - 选中图像某个区域
  - 例如天空、地面、建筑、人物位置
2. `Prompt Span`
  - 选中 prompt 里的某个短语
  - 例如 `humid night fog`
3. `Node Parameter`
  - 选中节点里的某个字段
  - 例如 `focalLengthMm=50`
4. `Output Variant`
  - 选中某一个结果版本
  - 例如 `Variant B`

### 指针编辑后的交互方式

用户选中目标后，在旁边对话框输入自然语言：

- `这里亮一点`
- `这段 prompt 改成更克制的工业夜景`
- `这个版本不要动构图，只提高清晰度`
- `这个镜头改成 85mm 的压缩感`

系统返回的不是整套重写，而应该是：

- 局部 patch
- 参数差异
- prompt 局部替换
- 新分支结果

也就是说，系统要做的是：

> localized edit，而不是 full regenerate。

### 指针编辑为什么重要

因为创作阶段最烦人的事就是：

- 我只想改一点点
- 结果系统把全部都重做了
- 原来对的部分也被破坏了

所以 Drinking Time 必须支持：

- 局部改
- 定向改
- 保留其他部分
- 生成差异版本

这比单纯“会生成”更有专业价值。

### 适合落地的交互结构

Creation Engine 页面可以分成四区：

- 左侧：节点库
- 中间：节点画布
- 右侧：对话框与属性面板
- 下方：输出结果与版本带

大致像这样：

```text
┌────────────┬──────────────────────────┬─────────────────────┐
│ 节点库     │ 节点画布                 │ 对话框 / 属性面板   │
│ Inputs     │ Template -> Prompt ->   │ 选中目标            │
│ Prompt     │ Model -> Output         │ 输入修改指令        │
│ Model      │        \-> Variant B    │ 应用 / 忽略         │
│ Edit       │                         │                     │
├────────────┴──────────────────────────┴─────────────────────┤
│ 输出结果区 / 版本带 / 局部修改历史                              │
└──────────────────────────────────────────────────────────────┘
```

### 指针编辑的最小数据结构

```ts
type PointerTarget =
  | {
      type: "image_region";
      imageId: string;
      maskId?: string;
      bbox?: [number, number, number, number];
    }
  | {
      type: "prompt_span";
      nodeId: string;
      start: number;
      end: number;
    }
  | {
      type: "node_parameter";
      nodeId: string;
      field: string;
    }
  | {
      type: "output_variant";
      outputId: string;
    };

type PointerEditRequest = {
  target: PointerTarget;
  instruction: string;
  preserveLockedFields?: string[];
  createNewBranch?: boolean;
};
```

### Creation Engine 最关键的体验

这一层真正应该做到的不是：

- “我有很多模型参数”

而是：

- “我可以像导演和美术一样，针对某个局部做明确调整”
- “我可以把修改挂在一个节点上，而不是把整张图推倒重来”
- “我可以保留好结果，只让变化发生在我指定的地方”

### 创作阶段的关键能力

- 支持多个模型适配
- 支持统一参数到不同厂商映射
- 支持节点式自由组合
- 支持指针式局部编辑
- 支持版本记录
- 支持结果回溯
- 支持二次修改后再次提交

## 13. 正确的系统架构

### 第一层：Frontend

负责：

- 品牌站
- 分析界面
- 创作界面
- 表单和任务状态

建议继续用：

- React
- TypeScript
- Vite
- Tailwind
- Framer Motion

### 第二层：Backend API

负责：

- 上传素材
- 调用分析服务
- 保存结构化结果
- 调用视频模型
- 记录任务状态
- 返回结果

建议最小接口这样拆：

- `POST /api/analysis`
- `POST /api/generate`
- `POST /api/generate/pointer-edit`
- `POST /api/nodes/execute`
- `GET /api/tasks/:id`
- `POST /api/inquiries`

### 第三层：Integrations

负责：

- 图像分析模型
- 文本解析能力
- 视频模型 API
- 对象存储

不要让前端直接碰具体供应商 API。

## 14. Personal Agent Slot / 小龙虾协作接口

你后面完全可以开放一个接口，让用户带着自己的“小龙虾”来协作。

但这里要区分清楚：

- 这不是做一个通用聊天入口
- 这也不是让外部 agent 直接接管你的系统
- 它更像一个受控的协作插槽

更准确的说法应该是：

> Drinking Time 提供一个 `Personal Agent Slot`，允许用户把自己的 AI 助手接进分析与创作流程，但只能在受控边界内协作。

### 为什么这件事值得做

因为你的系统真正值钱的是：

- 时间轴整理
- 环境模板生成
- 镜头蓝图结构
- 多模型参数映射

而用户自己的“小龙虾”可能更擅长：

- 用他的语言继续解释需求
- 帮他整理想法
- 提建议
- 帮他做二次修正
- 在他的工作流里持续陪跑

所以最佳结构不是二选一，而是：

- `Drinking Time Core`
- `User Personal Agent`
- `Controlled Collaboration Layer`

### 正确的产品定位

前台不要写成：

> 和你的 AI 助手聊天

而应该写成：

> 让你的个人助手参与分析和创作，但由 Drinking Time 负责结构化与生产控制。

也就是说：

- 你的系统负责把混乱素材变成生产语言
- 用户自己的 agent 负责参与讨论、建议和偏好修正

### 小龙虾应该放在哪里

它不应该占据首页主入口。

更合理的是：

- `/analysis` 主入口仍然是拖拽素材
- 右侧或右下角有一个 `与我的小龙虾协作` 开关
- 在分析结果页里有一个协作面板

这样主流程不会被聊天入口劫持。

### 协作模式建议

第一版建议只开放 3 档：

1. `Suggest Only`
  - 只能读取当前分析结果并提出建议
  - 不能直接改数据
2. `Editable Fields`
  - 可以改允许编辑的字段
  - 例如 mood、lighting、cameraLanguage、importance
3. `Generation Tuning`
  - 可以参与 prompt 和生成参数优化
  - 但不能改锁定字段和历史版本

这样你就有清晰边界，不会失控。

### 小龙虾能读什么

用户自己的 agent 可以读取：

- 当前 reference timeline
- 素材基础信息
- 重要度与权重
- 当前 environment template draft
- 当前 shot blueprint draft
- 当前 prompt draft
- 当前哪些字段允许编辑

### 小龙虾不能直接做什么

第一版不建议开放这些权限：

- 删除原始素材
- 改系统日志
- 覆盖历史版本
- 直接改锁定字段
- 直接调用底层供应商私钥
- 跳过你的结构化中间层直接提交生成

这几个边界必须硬性保留。

### 协作接口最小 API 草案

最小可以先拆成这几组：

- `POST /api/agents/connect`
  - 连接用户自己的 agent
- `GET /api/agents/:agentId/capabilities`
  - 返回这个 agent 支持的协作能力
- `POST /api/analysis/:sessionId/agent-suggest`
  - 基于当前 analysis session 请求建议
- `POST /api/analysis/:sessionId/agent-apply`
  - 将建议应用到可编辑字段
- `POST /api/generate/:taskId/agent-tune`
  - 基于当前生成任务调优 prompt 和参数

### 接口输入不应该是纯聊天文本

不要只传一段自然语言说：

> 帮我优化一下

更好的做法是传结构化上下文，例如：

```ts
type AgentCollaborationContext = {
  sessionId: string;
  mode: "suggest_only" | "editable_fields" | "generation_tuning";
  allowedFields: string[];
  lockedFields: string[];
  timeline: {
    bucketUnit: "day";
    buckets: {
      date: string;
      fragmentIds: string[];
    }[];
  };
  templateDraft: EnvironmentTemplate;
  shotDraft?: ShotBlueprint;
  promptDraft?: string;
};
```

这样外部 agent 的建议才是可控的、可回写的、可回溯的。

### 小龙虾返回结果的格式

返回值也不应该只是一段聊天回复。

更合理的是：

```ts
type AgentSuggestion = {
  summary: string;
  proposedChanges: {
    field: string;
    value: unknown;
    reason?: string;
    confidence?: number;
  }[];
  promptSuggestions?: {
    promptDraft?: string;
    negativePrompt?: string;
  };
  warnings?: string[];
};
```

这样系统就能：

- 展示建议
- 让用户逐条接受或拒绝
- 保留改动来源
- 保留人工最终确认

### 前端交互建议

在 `/analysis` 页面里，小龙虾协作入口可以这样出现：

- 开关：`与我的小龙虾协作`
- 连接状态：`Connected / Not connected`
- 模式选择：
  - `Suggest Only`
  - `Editable Fields`
  - `Generation Tuning`

连接后，右侧面板可显示：

- `小龙虾建议`
- `建议字段`
- `理由`
- `接受`
- `忽略`

重点是：

> 外部 agent 给建议，用户做确认，Drinking Time 负责落结构和控流程。

### 正确的边界总结

你要开放的是：

- 协作能力
- 个性化助手入口
- 用户自带 agent 的参与权

你不能放弃的是：

- 结构化中间层
- 权限边界
- 版本记录
- 人工确认机制
- 生成任务的最终控制

所以最终形态不是：

> 一个让大家接机器人聊天的网站

而是：

> 一个允许用户带着自己的 AI 助手进入影视分析工作流的专业创作平台。

## 15. 为什么要先做结构化中间层

因为你未来一定会换模型、换参数、换工作流。

如果你直接把输入拼成一句 prompt，然后直接扔给某一个模型：

- 可维护性差
- 不可复用
- 很难对比
- 很难积累经验
- 很难形成自己的方法论

但如果你有结构化中间层：

- 你可以积累自己的分析模板
- 你可以比较不同模型对同一结构化输入的反应
- 你可以做案例库和知识库
- 你可以慢慢沉淀成自己的系统壁垒

## 16. 商业价值会落在哪里

客户买的不是“按钮”，而是：

- 你对剧本和参考的理解
- 你把内容拆解成视觉语言的能力
- 你对结果的控制能力
- 你更快地给出概念方案和样片的能力

所以 `Drinking Time` 最值钱的部分，不是创作页本身，而是：

> 你把参考资料转成高质量结构化生产输入的那一层。

## 17. 下一步最合理的开发顺序

1. 先把首页和服务定位写清楚
2. 先做 `Analysis Engine` 的界面和数据结构
3. 再做 `Creation Engine` 的参数面板和任务流
4. 最后再接真实 API

## 18. 当前最准确的一句话总结

> `Drinking Time` 是一个面向影视视觉开发的双引擎平台，一端把参考图与剧本分析成结构化 prompt 和数据，另一端把这些数据转成可控的 AI 图像 / 视频创作结果。
