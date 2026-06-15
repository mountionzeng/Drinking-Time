---
title: 美术参考库系统集成规划
type: feat
status: active
date: 2026-06-15
origin: docs/brainstorms/2026-06-15-art-repository-system-requirements.md
---

# 美术参考库系统集成规划

## 总结

构建一套 Vision-first 的美术参考库系统，用户 99 张精选参考图 → 系统自动提取视觉特征（美术流派、颜色、材质等）→ 生成时动态匹配相关参考 → 融合到生成提示词。同时引入用户反馈循环：满意配置被记录为偏好，不满意反馈被系统学习并改进。目标是确保每次生成的图片都符合用户审美，通过交互式学习持续优化。

---

## 问题背景

目前系统生成的图片质量不稳定，缺乏统一、可学习的美术标准。用户已积累 99 张精选参考素材，希望系统能：
1. 从这些参考中**自动学习**美术指导，无需人工标注
2. 每次生成时**动态应用**这些指导
3. **根据用户反馈**持续优化

---

## 需求追踪

- R1. 系统能从 99 张参考图自动提取视觉特征（美术流派、颜色、材质、光线、构图等）
- R2. 生成时能根据用户描述（镜头内容、用户意图、上传的参考图）动态匹配相关参考
- R3. 美术流派是最高优先匹配维度（50% 权重），其次是颜色（30%），其他维度（20%）
- R4. 系统能理解用户反馈（文字、半结构化选项），学习用户的审美偏好
- R5. 满意的配置被存储为偏好库，未来遇到类似场景优先应用
- R6. 不满意的反馈也被记录，系统学习避免重复犯错
- R7. 用户可随时修改偏好（反馈方式：满意确认 vs 划走+文字解释）
- R8. 生成流程完全集成，用户无需关心参考库机制，体验自然

---

## 范围边界

**不包含**：
- 手动标注参考图的工具（Vision API 自动处理）
- 向量嵌入或复杂的语义检索库（LLM 直接理解 metadata 即可，数据量小）
- 参考库的版本控制或多用户协作（单用户，一个参考库）
- 参考库的 Web UI 管理界面（初期通过文件直接编辑）

**后续可选**：
- 自动化元数据填充（vision API）
- 用户反馈的自动评分
- 按项目/故事级别的参考库定制
- 参考配置的导出/分享

---

## 关键技术决策

1. **Vision-First 特征提取**：完全依赖 Vision API 自动分析参考图，无需人工标注。一次性脚本生成特征缓存，后续维护成本低。

2. **美术流派最优先**：artStyle（美术流派）权重 50%，是第一层过滤维度。理由：美术风格决定了整体视觉表现，直接影响最终效果。

3. **多维动态匹配**：
   - 第一层：美术流派过滤（50%）
   - 第二层：颜色匹配（30%）
   - 第三层：情感/场景匹配（15%）
   - 第四层：材质匹配（5%）

4. **双向反馈学习**：
   - 满意反馈 → 存入偏好库
   - 不满意反馈 → 存入反馈库，系统理解改进维度

5. **细粒度偏好匹配**：偏好库按镜头的多维特征（时间、地点、人物、物体、情感等）匹配，部分匹配也可用最接近的偏好。

6. **缓存策略**：特征缓存在启动时加载到内存，后续参考匹配都从内存读取（快速）。新增参考后增量分析更新。

---

## 现有代码和模式

### 生成流程
- **Endpoint**: `server/routers.ts` 中 `storyAgent.generateForMobile`
- **触发器**: `DrawThisMomentPanel.tsx` 调用 `trpc.storyAgent.generateForMobile.useMutation()`
- **流程**: 编 prompt → `renderViaGate()` 注入美术方向 → `generateImage()`
- **反馈记录**: `recordSignal` endpoint 存入 `imageSignals` 表（swipe_left/right）

### ArtRecipe 系统
- **类型**: `shared/artDirection.ts` 的 `ArtRecipeDNA`（style、palette、light、composition、material、negative）
- **默认配方**: `DEFAULT_ART_RECIPE_DNA`（电影感写实基线）
- **融合点**: `renderViaGate()` 中的 `artJudge()` 钩子，若 `ctx.artDirection` 存在则优先应用

### 用户反馈存储
- **表**: `imageSignals`（userId、storyId、imageId、action、metadata）
- **当前作用**: 记录 swipe 行为，推导故事配方

### 数据持久化
- **主表**: `stories`（body 存全量故事数据）、`generatedImages`、`imageSignals`
- **写入**: `generateForMobile` 后创建 `GeneratedImage` 记录；swipe 后异步记录 signal

---

## 实现单元

### U1. Vision 特征缓存初始化脚本

**目标**：用 Vision API 自动分析 99 张参考图，提取视觉特征，生成 `features-cache.json`

**依赖**：无

**文件**：
- Create: `scripts/initArtReferenceCache.ts`
- Create: `art-repository/features-cache.json`（生成产物）

**方法**：
1. 逐张读取 `art-repository/references/*.jpg`
2. 调用 Claude Vision API 或等价能力分析每张图
3. 提取 artStyle（美术流派）、artistReference、dominantColors、colorTone、lightingCharacter、mood、composition、materials、cameraAngle、visualDescription
4. 存储为 JSON，按图片文件名索引

**关键特征字段**：
- `artStyle`: 水彩、油画、素描、插画等（自动识别，无固定枚举）
- `dominantColors`: ["金色(暖亮)", "褐色(暖中)"] 格式，包含色温和明度
- `visualDescription`: 对整张图的自然语言描述（用于 LLM 理解）

**执行方式**：一次性脚本，`pnpm run init:art-cache`

**测试期望**：
- 缓存文件生成，包含 99 条记录
- 每条记录都有 artStyle、dominantColors、visualDescription
- artStyle 识别合理（可手工抽样验证 5-10 张）

---

### U2. 特征缓存加载器（后端）

**目标**：系统启动时加载特征缓存到内存，供后续参考匹配使用

**依赖**：U1

**文件**：
- Create: `server/services/artRepository.ts`
- Modify: `server/_core/bootstrap.ts` 或等价的启动入口

**方法**：
1. 定义 `ArtReferenceCache` 类型（持有 99 条特征记录的内存结构）
2. 导出 `loadFeaturesCache()` 函数，系统启动时调用
3. 导出 `getFeaturesCache()` 函数，其他服务查询缓存
4. 缓存初始化后，后续 artReference 操作都从内存读取

**模式跟随**：
- 类似于现有的 `creationAgent.ts` 中其他单例服务的初始化方式
- 使用 TypeScript 类来封装缓存逻辑

**测试期望**：
- 启动时缓存正确加载，内存中有 99 条记录
- `getFeaturesCache()` 能返回完整缓存
- 多次调用返回相同实例（单例）

---

### U3. 参考匹配 Agent（后端）

**目标**：实现多维动态参考匹配，根据用户描述和上下文找出最相关的参考图

**依赖**：U2

**文件**：
- Create: `server/services/artReferenceAgent.ts`
- Modify: `shared/artDirection.ts`（添加辅助函数）

**方法**：

核心函数签名：
```typescript
async function matchArtReferences(input: {
  shotNo: string;
  subject: string;  // 人物、场景描述
  action: string;
  mood: string;
  userDescription?: string;  // 用户补充
  userReferenceImage?: string;  // 用户上传的参考（base64 或 URL）
  storyContext?: string;
}): Promise<{
  topReferences: Array<{
    filename: string;
    confidence: number;
    visualDescription: string;
    matchReasoning: string;
  }>;
  extractedGuidance: {
    artStyle: string;
    dominantColors: string[];
    colorTone: string;
    lightingCharacter: string;
    moodTones: string[];
    composition: string;
    materials: string[];
  };
  applicableRules: string[];  // 匹配的全局美术规则
}>
```

处理流程：
1. **颜色信号提取**：从 userDescription 中识别时间（"夜晚"→深色）、场景线索（"阳光"→金色）、显式颜色等
2. **美术流派期望识别**：从 userDescription 和 userReferenceImage 识别用户期望的美术风格（"手绘感强"→水彩、插画）
3. **参考过滤**（第一层）：从缓存中筛选 artStyle 符合期望的参考
4. **多维匹配**（在筛选结果中）：
   - colorScore = matchColors(colorSignals, ref.dominantColors) * 0.50
   - emotionScore = matchMood(userContext.mood, ref.mood) * 0.30
   - compositionScore = matchComposition(userContext, ref.composition) * 0.15
   - materialScore = matchMaterial(userContext, ref.materials) * 0.05
5. **排序返回**：按综合得分排序，返回 top-3
6. **规则提取**：从 `art-repository/rules/global-rules.md` 中提取适用于当前场景的规则

**LLM 调用**：
- 使用单个 LLM 调用来理解用户描述、执行颜色信号提取、执行多维匹配
- 避免多次往返，追求效率

**模式跟随**：
- 设计风格类似于现有的 `creationAgent.ts` 中的 agent 函数
- 错误处理：如果 userReferenceImage 分析失败，降级为纯文字匹配

**测试期望**：
- Happy path：给定镜头描述"夜晚房间，思考"，返回 top-3 参考，artStyle 包含水彩/插画，colorTone 包含 warm-dark
- Edge case：userDescription 为空，仍能返回基于 shotNo/mood 的相关参考
- 错误路径：userReferenceImage 解析失败，系统降级返回文字匹配结果

---

### U4. 参考库检索 API 路由

**目标**：暴露 `artReference.match` 端点，供前端调用

**依赖**：U3

**文件**：
- Create: `server/trpc/routers/artReference.ts`
- Modify: `server/trpc/root.ts`（注册路由）

**方法**：
1. 定义 `artReference.match` 查询路由，输入参数对应 U3 中的 `matchArtReferences` 输入
2. 调用 `matchArtReferences()`，返回结果

**API 签名**：
```typescript
router.artReference = router({
  match: protectedProcedure
    .input(z.object({
      shotNo: z.string(),
      subject: z.string(),
      action: z.string(),
      mood: z.string(),
      userDescription: z.string().optional(),
      userReferenceImage: z.string().optional(),  // base64 或 URL
      storyContext: z.string().optional(),
    }))
    .query(async ({ input, ctx }) => {
      return matchArtReferences(input);
    }),
});
```

**模式跟循**：
- 使用 `protectedProcedure` 保证用户认证
- Input validation 用 zod schema
- 返回类型明确

**测试期望**：
- 端点可正确调用，返回结构正确
- 前端能通过 `trpc.artReference.match.useQuery()` 调用

---

### U5. 前端集成（DrawThisMomentPanel）

**目标**：在生成前调用参考匹配，融合指导到提示词和 artRecipe

**依赖**：U4

**文件**：
- Modify: `client/src/features/storyAgent/views/DrawThisMomentPanel.tsx`
- Modify: `shared/artDirection.ts`（添加 `enrichWithReferences()` 函数）

**方法**：

修改生成流程：
```typescript
// 原流程：prompt → generateForMobile
// 新流程：
// 1. 调用参考匹配
const referenceMatch = await trpc.artReference.match.query({
  shotNo,
  subject,
  action,
  mood,
  userDescription,
  userReferenceImage,
});

// 2. 融合 artRecipe
const finalRecipe = enrichWithReferences(
  referenceMatch.extractedGuidance,
  storyArtRecipe  // 故事锁定的配方
);

// 3. 融合 prompt
const artNotes = buildArtDirectionNotes(
  referenceMatch.extractedGuidance,
  referenceMatch.applicableRules
);
const enrichedPrompt = `${originalPrompt}\n\n${artNotes}`;

// 4. 生成
const result = await generateForMobile({
  prompt: enrichedPrompt,
  shotNo,
  projectId,
  storyId,
  userId,
  artDirection: finalRecipe,
});
```

**关键函数** `enrichWithReferences(extracted, storyRecipe)`：
- 融合策略：故事锁定配方 > 参考库指导 > 全局默认
- 如果 storyRecipe 存在，extracted 作为补充；否则 extracted 可直接用
- 返回融合后的 `ArtRecipeDNA`

**关键函数** `buildArtDirectionNotes(extracted, rules)`：
```
[美术风格]: {artStyle} + {artistReference}
[色彩]: {dominantColors.join(", ")}
[光线]: {lightingCharacter}
[情感]: {moodTones.join(", ")}
[质感]: {materials.join(", ")}

[美术规则]
{rules.join("\n")}
```

**模式跟循**：
- DrawThisMomentPanel 已有 generateForMobile 的调用模式
- 参考融合逻辑放在 shared/artDirection.ts（便于复用和测试）

**测试期望**：
- Happy path：调用参考匹配后，enrichedPrompt 中包含美术指导信息
- Edge case：无参考匹配时（比如用户描述完全陌生），系统不crash，返回空指导
- Integration：生成的图片应用了参考库风格（需要人工视觉验证）

---

### U6. 反馈收集 UI（前端）

**目标**：实现生成结果后的反馈交互：[满意] [划走/不满意+文字框]

**依赖**：U5（生成完成后）

**文件**：
- Modify: `client/src/features/storyAgent/views/ImageCard.tsx` 或新增组件
- Create: `client/src/features/storyAgent/components/FeedbackPanel.tsx`

**方法**：

生成完图片后，显示三层交互：
1. **上层**：[满意] [划走] 按钮
2. **点击 [划走/不满意]** 后出现：
   - 硬编码选项列表（可多选）：
     - □ 色调太冷/太暖
     - □ 美术风格不对
     - □ 材质不对
     - □ 人物表情/姿态不对
     - □ 构图不满意
     - □ 其他
   - 文本框：用户可自由输入原因
3. **语言引导**（可选）：根据用户选中的选项，系统可问诗"你是说 XXX 不对？" 来确认理解

**UI 流程**：
```
生成完成 → ImageCard 显示结果
  ↓
用户点 [满意] → 保存到偏好库 → 显示确认，继续
用户点 [划走] ↓
  → FeedbackPanel 出现
  → 用户选择 + 输入原因
  → 系统理解反馈
  → 保存到反馈库
  → 立即重新生成（基于改进逻辑）
  ↓
新结果展示，用户可继续反馈或满意
```

**模式跟循**：
- 模态或侧滑抽屉，不打断用户主流程
- 类似于现有的其他反馈交互（比如 EditShotPrompt）

**测试期望**：
- [满意] 按钮可点击，生成满意记录
- [划走] 后出现反馈面板
- 反馈可被解析和理解
- 反馈后能触发重新生成

---

### U7. 偏好库管理（后端 + 数据库）

**目标**：存储和查询用户的满意配置和不满意反馈，支持细粒度匹配

**依赖**：U6（反馈需要存储）

**文件**：
- Create: `server/services/userPreferences.ts`
- Modify: `drizzle/schema.ts`（新增 `userArtPreferencesLiked` 和 `userArtPreferencesDislkied` 表）
- Modify: `server/db.ts`（DB 操作函数）

**新表结构**：

```typescript
// 满意偏好库
table("userArtPreferencesLiked", (t) => ({
  id: t.integer().primaryKey().autoincrement(),
  userId: t.integer().notNull(),
  projectId: t.integer().notNull(),
  sceneFingerprint: t.text().notNull(),  // JSON，包含 timeOfDay、location、pose、emotion 等
  artStyle: t.text(),  // 应用的美术风格
  usedReferences: t.text(),  // JSON 数组，应用的参考图文件名
  colorScheme: t.text(),
  appliedRules: t.text(),  // JSON 数组
  generatedPrompt: t.text(),  // 最终用的 prompt
  likeCount: t.integer().default(1),  // 同一配置满意多次
  createdAt: t.integer(),
}));

// 不满意反馈库
table("userArtPreferencesDislked", (t) => ({
  id: t.integer().primaryKey().autoincrement(),
  userId: t.integer().notNull(),
  projectId: t.integer().notNull(),
  sceneFingerprint: t.text().notNull(),
  usedConfiguration: t.text(),  // JSON，生成时用的配置
  userFeedback: t.text(),  // 用户输入的原因或选中的选项
  systemUnderstanding: t.text(),  // JSON，系统对反馈的理解 {dimension, problem, shouldBe}
  createdAt: t.integer(),
}));
```

**服务函数** `userPreferences.ts`：
- `saveLikedPreference(userId, projectId, config)`: 保存满意配置（若已存在则 likeCount++）
- `saveDislikedFeedback(userId, projectId, feedback)`: 保存反馈
- `findMatchingPreference(userId, projectId, sceneFingerprint)`: 查询匹配的满意配置（精确或部分匹配）
- `getDislikedFeedback(userId, projectId, sceneFingerprint)`: 查询历史反馈，避免重复

**细粒度匹配逻辑**：
```typescript
// sceneFingerprint 包含：
{
  timeOfDay: "夜晚",
  location: "房间",
  pose: "坐着",
  emotion: "思考",
  objects: ["书桌"],
  materials: ["木质"]
}

// 查询时：
// 1. 精确匹配（所有维度都相同）
// 2. 部分匹配（最关键的 3-4 个维度相同，如 timeOfDay + location + emotion）
// 3. 返回最高分的偏好
```

**测试期望**：
- Happy path：保存偏好、查询偏好、部分匹配
- Edge case：同一配置连续满意多次，likeCount 递增
- Integration：前端反馈流能正确调用保存函数

---

### U8. 反馈解析 Agent（后端）

**目标**：理解用户的文字或半结构化反馈，解析成系统可理解的维度和改进方向

**依赖**：U6（接收反馈）

**文件**：
- Create: `server/services/feedbackParser.ts`

**方法**：

核心函数 `parseFeedback(userFeedback: string | string[])`：
```typescript
// 输入：用户反馈（文字或选中的选项数组）
// 输出：
{
  dimension: "color" | "artStyle" | "material" | "emotion" | "composition" | "other",
  problem: string,  // 什么不对（比如 "cold"、"too-realistic"）
  shouldBe: string,  // 应该是什么（比如 "warm"、"hand-drawn"）
  confidence: number,  // 0-1，对理解的置信度
}
```

处理流程：
1. 如果是硬编码选项（比如 `["色调太冷", "材质不对"]`），直接映射到维度和改进方向
2. 如果是自由文字，用 LLM 理解（一次调用）
3. 返回结构化理解

**硬编码映射表**：
```typescript
{
  "色调太冷了": { dimension: "color", problem: "cold", shouldBe: "warm" },
  "色调太暖了": { dimension: "color", problem: "warm", shouldBe: "cold" },
  "美术风格太逼真": { dimension: "artStyle", problem: "photorealistic", shouldBe: "hand-drawn" },
  "材质感不对": { dimension: "material", problem: "unknown", shouldBe: "review-reference" },
  // ...
}
```

**测试期望**：
- Hard-coded 选项能正确映射
- 自由文字反馈能被 LLM 理解
- 返回的 shouldBe 能指导下一轮生成

---

### U9. 重新生成逻辑（后端 + 前端）

**目标**：用户不满意后，系统基于反馈调整参考库应用或规则，立即重新生成

**依赖**：U3、U5、U8

**文件**：
- Modify: `DrawThisMomentPanel.tsx`
- Create: `server/services/regenerateWithFeedback.ts`

**方法**：

流程：
1. 用户提交不满意反馈 → `parseFeedback()` 理解反馈
2. 存入反馈库（U7）
3. 调用 `regenerateWithFeedback(originalInput, feedback)`：
   - 若 feedback 涉及美术流派（比如"太逼真，要手绘感"），调整 artStyle 期望，重新过滤参考
   - 若涉及颜色，调整颜色信号，重新匹配
   - 若涉及材质，调整材质期望
   - 生成新的 artDirection 和 prompt
4. 调用 `generateForMobile()` 出新图
5. 前端显示新图，用户可继续反馈或满意

**关键函数** `regenerateWithFeedback()`：
```typescript
async function regenerateWithFeedback(
  originalInput: MatchArtReferencesInput,
  feedback: ParsedFeedback,
  userPreferences: UserPreferencesService,
): Promise<GenerateResult>
```

逻辑：
- 若 feedback.dimension === "artStyle"，修改 artStyle 期望后重新调用 `matchArtReferences()`
- 若 feedback.dimension === "color"，修改颜色信号后重新调用
- 其他维度类似
- 基于新的匹配结果，融合新的 artDirection 和 prompt，调用 generateForMobile

**模式跟循**：
- 复用 U3 的 `matchArtReferences()` 逻辑，只修改输入参数
- 和 U5 中的融合逻辑一致

**测试期望**：
- Happy path：反馈"色调太冷"→重新生成结果应该用更暖的颜色参考
- Integration：用户可连续反馈 2-3 次，系统逐步改进

---

### U10. 生成时偏好库查询（后端）

**目标**：生成时优先检查用户偏好库，若有匹配的满意配置则优先应用

**依赖**：U7

**文件**：
- Modify: `DrawThisMomentPanel.tsx` 或新增预处理函数

**方法**：

在调用 `matchArtReferences()` 前，先查询偏好库：
```typescript
// 构建 sceneFingerprint
const sceneFingerprint = buildSceneFingerprint({
  timeOfDay: extractTimeOfDay(userDescription),
  location: extractLocation(userDescription),
  pose: extractPose(userDescription),
  emotion: mood,
  objects: extractObjects(userDescription),
  materials: extractMaterials(userDescription),
});

// 查询偏好
const matchedPreference = await userPreferences.findMatchingPreference(
  userId,
  projectId,
  sceneFingerprint
);

// 若有匹配的满意配置，直接用它；否则调用 matchArtReferences()
if (matchedPreference) {
  // 使用偏好库中的配置
  const artDirection = buildArtDirectionFromPreference(matchedPreference);
  const enrichedPrompt = buildPromptFromPreference(matchedPreference);
  // 生成
} else {
  // 正常流程：调用参考匹配
  const referenceMatch = await matchArtReferences(...);
  // ...
}
```

**效果**：同一场景连续生成时，若之前满意过，系统会优先应用那个配置，提高效率和一致性。

**测试期望**：
- 同一 sceneFingerprint 多次生成，若有满意偏好，优先用它
- 新增新的满意偏好后，下次遇到类似场景能正确匹配

---

### U11. 全局美术规则应用（后端）

**目标**：在生成提示词时应用全局美术规则

**依赖**：U3（规则提取）、U5（融合）

**文件**：
- Modify: `server/services/renderGate.ts` 或 U8 中的 Prompt 融合逻辑

**方法**：

`art-repository/rules/global-rules.md` 中的规则在生成时被 LLM 提取相关部分（或系统预处理），融合到 enrichedPrompt 中：

```
[美术规则]
- 色调倾向于暖色，避免冷冰冰的蓝调
- 光线必须有明确的主光源，避免均匀平面光
```

在 `buildArtDirectionNotes()` 中追加 applicableRules：
```typescript
const rulesSection = applicableRules.length > 0
  ? `\n[美术规则]\n${applicableRules.join("\n")}`
  : "";
```

**模式跟循**：
- 规则本身由用户在 `rules/global-rules.md` 中编写和维护
- 系统只负责提取和融合，不修改规则内容

**测试期望**：
- 生成的 enrichedPrompt 包含规则内容
- 规则能影响最终出图（需要人工视觉验证）

---

## 系统级影响

### 数据流
```
参考库初始化（U1） 
  → 特征缓存（U2）
  → 生成前匹配（U3）
  → 融合 artRecipe + prompt（U5）
  → 生成（现有 generateForMobile）
  → 用户反馈（U6）
  → 反馈解析（U8）
  → 存储偏好/反馈（U7）
  → 下次生成时查询偏好（U10）
```

### 新增表
- `userArtPreferencesLiked`: 记录用户满意的生成配置
- `userArtPreferencesDislked`: 记录用户不满意的反馈和理解

### 修改现有流程
- `DrawThisMomentPanel`: 调用参考匹配，融合 artDirection 和 prompt
- `renderViaGate`: 保持不变（已支持自定义 artDirection）
- `generateForMobile`: 保持不变

### 无破坏性修改
- 所有新功能都是可选的，系统可在 artReference 服务不可用时降级到现有逻辑
- 现有的美术候选流程（6 候选图）保持不变

---

## 开放问题（延迟实现）

- **颜色信号提取的规则完备性**：初期用简单规则 + LLM，后续可积累更多映射（"夜晚"、"晨光"、"阳光"等）
- **反馈理解的准确度**：LLM 理解反馈可能有歧义，后续可加人工审核或细化提示词
- **偏好匹配的召回率**：当前是精确/部分匹配，后续可加向量相似度来提高召回
- **参考库更新后缓存失效**：初期手动重新运行 U1 脚本，后续可加增量更新机制

---

## 风险和缓解

| 风险 | 缓解 |
|------|------|
| Vision API 分析参考图的准确度 | 初期可手工抽样验证 10-15 张参考的 artStyle 识别，确保质量。若有误可手工修正 features-cache.json |
| LLM 理解用户反馈的准确度 | 反馈解析失败时，系统降级为"不满意就重新生成"，不应用反馈的改进逻辑。用户体验不受影响 |
| 性能：参考匹配每次都调用 LLM | 匹配结果可缓存（同 sceneFingerprint 返回缓存结果），减少 LLM 调用 |
| 偏好库爆炸：用户反复满意，记录过多 | 设计时已有 likeCount，相同配置只记一条。初期可以接受偏好库有 10-20 条 |

---

## 后续扩展（不在本计划内）

- [ ] Vision API 自动化更新参考库元数据
- [ ] 按项目/故事级别定制参考库
- [ ] 参考配置导出/分享
- [ ] 用户反馈的自动评分（区分有效反馈 vs 噪音）
- [ ] Web UI 来管理参考库和规则
- [ ] 多用户的偏好库隔离和共享

---

## 部署和验证

### 验证计划
1. **U1-U2**：特征缓存初始化和加载，运行脚本验证缓存生成
2. **U3-U4**：参考匹配 Agent，单元测试 + 集成测试
3. **U5**：前端集成，人工测试生成流程
4. **U6-U8**：反馈交互，人工测试反馈和解析
5. **U7、U10**：偏好库，验证查询和应用

### 部署顺序
1. 先部署 U1-U4（参考库基础设施），确保参考匹配工作
2. 再部署 U5（前端集成），确保生成流程正确应用
3. 再部署 U6-U10（反馈循环），完整的学习闭环

### 回滚策略
- 若参考匹配出问题，front-end 可设置 Feature Flag 禁用参考库调用，降级到原有逻辑
- 若反馈解析失败，不影响生成（反馈被存储但不改变下一轮生成）

