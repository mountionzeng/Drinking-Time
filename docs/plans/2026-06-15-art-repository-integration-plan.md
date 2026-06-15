---
name: 美术参考库系统集成计划
description: 将参考库（参考图片 + 规则）集成到生成流程，确保每次出图都符合用户审美
origin: docs/brainstorms/（新功能探索）
created: 2026-06-15
status: planning
---

# 美术参考库系统集成计划

## 问题背景

用户已建立一个包含 99 张精选参考图片和美术规则的参考库。目前需要将这个库集成到生成流程中，使得**每次生成图片都能自动从参考库中提取相关的美术指导，确保出图质量一致**。

## 成功标准

- [ ] 特征缓存初始化完成（99 张参考图分析完毕）
- [ ] 生成流程能从参考库动态提取指导
- [ ] 用户描述能匹配相关参考图
- [ ] 美术规则正确融合到生成提示词中

---

## Phase B：Vision 特征缓存初始化

### B1. 参考库 Vision 分析

**目标**：用 vision API 分析所有 99 张参考图，提取**可泛化的美术特征**，存入缓存。

**不用打标签！** Vision 会自动理解图片。

**特征缓存文件**：`art-repository/features-cache.json`

**缓存结构**：

```json
{
  "03594f4458acbae0dd26d5f300a29752.jpg": {
    "visualDescription": "温暖的侧光照亮了人物，光线从右上方进入，营造了层次感。背景是柔和的暖色调...",
    "dominantColors": ["金色", "褐色", "米色"],
    "lightingCharacter": "侧光，主光源清晰，有补光",
    "mood": ["安静", "思考", "温暖"],
    "composition": "人物中景，对焦清晰，背景虚化",
    "materials": ["木质", "布料", "皮肤纹理"],
    "cameraAngle": "略微俯视",
    "analysisDate": "2026-06-15"
  },
  ...（99 张图）
}
```

**特征字段说明**：
- `visualDescription`: 对整张图的自然语言描述
- `dominantColors`: 主要色彩（**关键匹配维度**，权重最高）
  - 包含色名、色温（暖/冷）、明度（亮/暗）
  - 示例：`["金色(暖亮)", "褐色(暖中)", "米色(暖浅)"]`
- `colorTone`: 整体色调（暖色/冷色/中性）
- `lightingCharacter`: 光线特性
- `mood`: 情感基调（多个）
- `composition`: 构图信息
- `materials`: 质感/材质
- `cameraAngle`: 镜头角度

**实现**：
- 批量调用 vision API（可以用 Claude 的视觉能力）
- 一次性分析完毕，存入缓存
- 后续参考库更新 → 增量分析新图 → 更新缓存

### B2. 美术规则库（可选优化）

**当前状态**：`rules/global-rules.md` 是自由形式的 Markdown

**改进方向**（可选）：
- 不强制结构化（保持自由书写）
- 系统在生成时用 LLM 直接从规则文本中提取适用规则
- 或者保持结构化便于解析

**建议**：保持结构化（方便系统提取），但内容可以自由：

```markdown
# 全局美术规则库

## 色彩与光线
- 色调倾向于暖色，避免冷冰冰的蓝调
- 光线必须有明确的主光源，避免均匀平面光
- 避免过度饱和的色彩

## 构图与主体
- ...
```

---

## Phase C：生成流程集成

### C1. 核心流程设计

**触发点**：用户点击"把这一刻画出来"（DrawThisMomentPanel）

**流程**：

```
用户触发生成
    ↓
[步骤 1] 收集上下文
  - 当前镜头描述（shotNo、subject、action、mood 等）
  - 用户的意图（如果有上传的参考图）
  - 故事背景（如果有锁定的 artRecipe）
    ↓
[步骤 2] 动态参考匹配（新 Agent）
  用户描述 + 上下文
    ↓
  能匹配上参考库 → 提取相关参考的视觉特征
  匹配不上 → 从缓存中提取可泛化的特征
    ↓
  返回：top-3 相关参考 + 提取的特征 + 适用规则
    ↓
[步骤 3] 融合成 ArtDirection
  - 参考库特征 + 故事锁定配方 + 全局规则
  - 融合到 artRecipe
    ↓
[步骤 4] 融合 Prompt
  - 原始 prompt + 美术规则 + 参考特征描述
    ↓
[步骤 5] 调用 generateForMobile
  - 现有流程（generateForMobile + renderViaGate）
  - 注入融合后的 artDirection + 富化后的 prompt
    ↓
出图
```

### C2. 实现细节

#### C2a. 特征缓存加载

**职责**：在系统启动时加载特征缓存，供后续匹配使用

**实现**：
- 启动时读取 `art-repository/features-cache.json`
- 存入内存或 Redis（后续可加缓存）

**代码位置（计划）**：
- `server/services/artRepository.ts` （新文件）
- 导出 `loadFeaturesCache()` 和 `getFeaturesCache()` 函数

#### C2b. 动态参考匹配 Agent（新）

**职责**：根据用户描述和上下文，从特征缓存中找出最匹配的参考

**输入**：
```typescript
{
  shotNo: string;
  subject: string;        // 人物、场景描述
  action: string;
  mood: string;
  userDescription?: string;  // 用户补充的描述
  userReferenceImage?: string; // 用户上传的参考图
  storyContext?: string;
}
```

**处理流程**：
1. 从用户描述中**提取颜色信号**
   - 识别时间信息（夜晚 → 深色、暗色）、场景（阳光 → 金色、暖色）等
   - 显式颜色描述（"蓝色"、"暖色"等）
2. 如果有 userReferenceImage → 分析用户的参考图
3. **多维匹配**：
   - **颜色匹配（权重 50%）**：用户的颜色信号 vs 参考的 dominantColors
   - 情感匹配（权重 30%）：用户 mood vs 参考 mood
   - 其他匹配（权重 20%）：构图、光线等
4. 返回 top-3 匹配的参考 + 提取的指导

**输出**：
```typescript
{
  topReferences: {
    filename: string;
    confidence: number;       // 0-1
    visualDescription: string; // 为什么选这张
    matchReasoning: string;
  }[];
  extractedGuidance: {
    dominantColors?: string[];
    lightingCharacter?: string;
    moodTones?: string[];
    composition?: string;
    materials?: string[];
  };
  applicableRules: string[]; // 适用规则列表
}
```

**实现方式**：

1. **颜色信号提取**（关键）
   ```typescript
   const colorSignals = extractColorSignals(userDescription);
   // 输入："夜晚，冷色调，房间里一个人"
   // 输出：{ timeSignal: "夜晚" → ["深蓝", "深紫", "暗色"],
   //        explicitColors: ["冷色"],
   //        colorTone: "cold" }
   ```

2. **多维匹配**
   ```typescript
   const matchScore = (userContext, reference) => {
     return {
       colorScore: matchColors(colorSignals, reference.dominantColors), // 权重 50%
       moodScore: matchMood(userContext.mood, reference.mood),          // 权重 30%
       lightingScore: matchLighting(...),                                // 权重 15%
       compositionScore: matchComposition(...),                          // 权重 5%
     };
   };
   ```

3. **排序返回**
   - 按综合得分排序，返回 top-3 参考
   - 同时返回匹配的原因（"因为颜色匹配"、"情感匹配"等）

**代码位置（计划）**：
- `server/services/artReferenceAgent.ts` （新文件）
- 导出 `matchArtReferences(shotContext, featuresCache)` 函数

#### C2c. ArtDirection 融合

**融合策略**：
```typescript
const finalArtDirection = {
  // 1. 故事的锁定 artRecipe（最高优先级）
  ...storyArtRecipe,
  
  // 2. 参考库的指导（补充）
  ...enrichWithReferences(extractedGuidance, storyArtRecipe),
  
  // 3. 全局默认（降级）
  ...DEFAULT_ART_RECIPE_DNA,
};
```

**代码位置（计划）**：
- `shared/artDirection.ts` 添加 `enrichWithReferences()` 函数

#### C2d. Prompt 融合

**将参考特征和规则融合到最终 prompt**：

```typescript
const artDirectionNotes = `
[参考特征]
- 色调: ${extractedGuidance.dominantColors?.join(', ')}
- 光线: ${extractedGuidance.lightingCharacter}
- 情感: ${extractedGuidance.moodTones?.join(', ')}
- 质感: ${extractedGuidance.materials?.join(', ')}

[美术规则]
${applicableRules.join('；')}
`;

const enrichedPrompt = `${originalPrompt}\n\n${artDirectionNotes}`;
```

#### C2e. 与 DrawThisMomentPanel 的集成

**修改流程**：

```typescript
// 1. 动态匹配参考
const referenceMatch = await trpc.artReference.match.query({
  shotNo,
  subject,
  action,
  mood,
  userDescription,
  userReferenceImage, // 可选：用户上传的参考
});

// 2. 融合 artRecipe
const finalRecipe = enrichWithReferences(
  referenceMatch.extractedGuidance,
  storyArtRecipe
);

// 3. 融合 prompt
const artNotes = buildArtDirectionNotes(
  referenceMatch.extractedGuidance,
  referenceMatch.applicableRules
);
const enrichedPrompt = `${prompt}\n\n${artNotes}`;

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

---

## 实现单元分解

### Unit U1：特征缓存初始化脚本
- **目标**：用 vision API 分析 99 张参考图，生成特征缓存
- **文件**：
  - `art-repository/features-cache.json` （生成）
  - `scripts/initArtReferencesCache.ts` （新）
- **输入**：99 张参考图
- **输出**：特征缓存 JSON（includes visualDescription, colors, lighting, mood, etc）
- **验证**：缓存文件生成，包含所有 99 张图的特征
- **执行方式**：一次性脚本（`pnpm run init:art-cache`）

### Unit U2：特征缓存加载器（后端）
- **目标**：系统启动时加载缓存，供后续使用
- **文件**：
  - `server/services/artRepository.ts` （新）
- **导出**：`loadFeaturesCache()`, `getFeaturesCache()`
- **验证**：缓存在启动时正确加载

### Unit U3：动态参考匹配 Agent（后端）
- **目标**：实现参考匹配逻辑
- **文件**：
  - `server/services/artReferenceAgent.ts` （新）
  - `shared/artDirection.ts` （添加 `enrichWithReferences()` 函数）
- **输入**：用户上下文（shotNo, subject, action, mood 等）
- **输出**：匹配的参考 + 提取的特征 + 适用规则
- **验证**：给定镜头描述能匹配相关参考

### Unit U4：后端 API 路由
- **目标**：暴露 `artReference.match` 端点
- **文件**：
  - `server/trpc/routers/artReference.ts` （新）
  - `server/trpc/root.ts` （注册路由）
- **验证**：客户端能调用，返回正确的格式

### Unit U5：前端集成（DrawThisMomentPanel）
- **目标**：在生成前调用参考匹配，融合指导
- **文件**：`client/src/features/storyAgent/views/DrawThisMomentPanel.tsx`
- **修改**：添加 `trpc.artReference.match` 调用，融合 prompt 和 artDirection
- **验证**：生成时自动应用参考库指导，prompt 中包含美术说明

### Unit U6：可视化参考（可选后续）
- **目标**：在生成卡片上展示匹配的参考图
- **文件**：`client/src/features/storyAgent/views/ImageCard.tsx`
- **验证**：用户能看到"应用的参考图"

---

## 技术决策

### 1. 颜色匹配的核心地位
- **颜色权重 50%**（最高），因为：
  - 颜色是最直观的视觉特征
  - 用户描述中经常包含颜色线索（"夜晚"→深色，"阳光"→金色）
  - 颜色匹配能快速定位到相关的参考库段落
- **配套**：需要在特征缓存中详细记录 `dominantColors` 和 `colorTone`

### 2. 参考库的读取位置
- **方案 A**：后端启动时加载到内存（推荐）
- **方案 B**：每次生成都读文件（备选）
- **推荐**：方案 A，特征缓存是只读的，启动时加载到内存

### 3. LLM 用于颜色信号提取
- 用 LLM 从用户描述中提取颜色信号（时间→色调，显式颜色等）
- 简单的规则匹配可处理标准映射（"夜晚"→暗色，"晨光"→金色）

### 4. 参考图的显示
- **第一版**：后台应用，不展示（专注质量）
- **第二版**：在生成卡片上展示匹配的参考（"参考自..."）

---

## 依赖和风险

### 依赖
- [ ] 参考库初始化完成（元数据填充至少 20 张）
- [ ] 规则库至少有 3-5 条核心规则

### 风险
- **R1**：LLM 匹配质量
  - 如果 LLM 匹配错参考，可能适得其反
  - **缓解**：初期可手动验证前几次的匹配结果

- **R2**：规则冲突
  - 全局规则可能与故事级 artRecipe 冲突
  - **缓解**：清晰的优先级定义（见上）

- **R3**：性能
  - 每次生成都要调用 LLM 进行参考检索
  - **缓解**：可在后期加缓存（同 shotContext → 同结果）

---

## 时间线（估算）

| 单元 | 工作量 | 依赖 |
|------|--------|------|
| U1（特征缓存初始化） | 2-3h | 无 |
| U2（缓存加载器） | 1h | U1 |
| U3（参考匹配 Agent） | 3h | U2 |
| U4（API 路由） | 1h | U3 |
| U5（前端集成） | 2h | U4 |
| U6（可视化）| 2h（可选） | U5 |
| **总计** | ~9-11h | - |

**关键路径**：U1 → U2 → U3 → U4 → U5

---

## 后续扩展

- [ ] 自动化元数据填充（vision API）
- [ ] 向量嵌入 + 更高效的检索
- [ ] 用户反馈循环（标记生成结果的好坏，优化规则）
- [ ] 故事级别的参考库覆盖（允许特定故事自定义规则）

