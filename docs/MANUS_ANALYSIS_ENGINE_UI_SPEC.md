# Drinking Time - Analysis Engine UI Spec (For Manus)

## 1. 结论

是的，先有一份结构化文档会明显更方便 Manus 制作界面。  
原因：Manus 更擅长按明确规格执行，而不是从模糊描述里猜。

---

## 2. 本次目标

在 `Analysis Engine` 做一个可交付的界面原型，核心能力：

1. 用户拖入碎片素材（图、文、PDF、剧本、brief）。
2. 系统自动按“天”整理时间轴。
3. NLP 自动拆成“场景/镜头产出表”。
4. 通过 `readiness + deadline + autoRender` 决定可否进入渲染。
5. 灵感型条目进入 `idea_pool`，不强制产出。

---

## 3. 页面结构

单页 `/analysis`，桌面端采用上下双区：

1. 上半区：导入 + 时间轴 + 分析摘要
2. 下半区：场景/镜头产出表（核心生产调度区）

建议三栏布局（上半区）：

- 左：Drop Zone（拖拽导入）
- 中：Timeline（按天分桶）
- 右：Template Draft Summary（情绪/光照/空间/镜头语言）

下半区为宽表格 + 批量操作条。

---

## 4. 视觉与风格

方向：专业制作工具，不是营销页。

- 背景：深色中高对比（避免纯黑）。
- 面板：半透明深色卡片 + 清晰边框层级。
- 字体：中文优先 `PingFang SC`，英文回退 `Avenir Next`。
- 状态色固定：
  - `idea_pool`: gray
  - `requirement_pool`: slate blue
  - `structured`: blue
  - `production_ready`: green
  - `queued`: cyan
  - `rendered`: deep green
  - `blocked`: red

---

## 5. 关键组件

## 5.1 Drop Zone

空状态文案：

- Title: `Drop your references here`
- Desc: `把图片、视频、PDF、剧本片段、brief 或笔记直接拖进来。系统会自动整理。`

标签：

- `Images` `Scripts` `Storyboards` `Briefs` `Notes`

行为：

- 拖入后进入 `building` 状态。
- 显示进度步骤：识别类型 -> 提取日期 -> 时间轴归组 -> NLP 拆镜头。

## 5.2 Timeline

按天分桶：

- 例如 `2026-03-26`, `2026-03-27`, `Undated`

每条素材卡片字段：

- `title`
- `sourceType`
- `dateBucket`
- `importance` (1-5)
- `finalWeight`（可选）

卡片交互：

- 改日期
- 改重要度
- Pin
- Exclude

## 5.3 Shot Production Table

列（MVP）：

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

行内动作：

- `Open Blueprint`
- `Render Now`（仅 `production_ready`）
- `Set Deadline`
- `Move To Idea Pool`
- `Mark Blocked`

批量动作：

- `Set Deadline`
- `Set Priority`
- `Enable AutoRender`
- `Disable AutoRender`
- `Queue Ready Shots`
- `Export Shot List`

---

## 6. 状态机

`ShotProductionRow.status`:

- `idea_pool`
- `requirement_pool`
- `structured`
- `production_ready`
- `queued`
- `rendered`
- `blocked`

自动渲染触发条件：

- `status === production_ready`
- `readinessScore >= 0.75`
- `autoRender === true`
- `blockingIssues` 为空

---

## 7. 死线机制

必须显示 `deadline` 和倒计时：

- `D-5`
- `D-1`
- `Overdue +2`

默认排序：`deadline asc`（无死线排最后）。

队列优先级建议：

1. `deadline`
2. `priority`
3. `readinessScore`

---

## 8. 数据结构（前端）

```ts
type ReferenceFragment = {
  id: string;
  title: string;
  sourceType: "image" | "video" | "script" | "storyboard" | "brief" | "note";
  dateBucket?: string; // YYYY-MM-DD or "Undated"
  importance: 1 | 2 | 3 | 4 | 5;
  finalWeight?: number;
  excluded?: boolean;
  pinned?: boolean;
};

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

---

## 9. API 协议（MVP）

```http
POST /api/analysis/intake
POST /api/analysis/timeline-map
POST /api/analysis/shot-decompose
POST /api/analysis/queue-ready-shots
POST /api/generate/first-pass
GET  /api/analysis/:sessionId
```

说明：

- `intake`: 收素材并返回上传结果
- `timeline-map`: 生成按天桶
- `shot-decompose`: NLP 输出 `ShotProductionRow[]`
- `queue-ready-shots`: 批量入队
- `first-pass`: 对单条或批量可产出镜头触发渲染

---

## 10. 响应式要求

桌面端：

- 保持“上半区三栏 + 下半区宽表”。

移动端：

- 时间轴保留，表格改卡片列表。
- 每卡显示：`Scene/Shot`, `Status`, `Readiness`, `Deadline`, `AutoRender`, 主操作按钮。

---

## 11. 验收标准

1. 可拖入多类型素材并显示在时间轴。
2. 至少能展示 5 条镜头产出行数据。
3. 状态色、readiness 进度条、deadline 倒计时正常显示。
4. `Render Now` 仅在 `production_ready` 启用。
5. `Queue Ready Shots` 仅把满足条件的行改为 `queued`。
6. `idea_pool` 条目不会被自动渲染。
7. 桌面端和移动端都可用。

---

## 12. 直接给 Manus 的执行指令

请基于本文件生成一个 `/analysis` 前端页面原型，要求：

1. 按第 3 节实现布局。
2. 按第 5 节实现组件和交互。
3. 用第 8 节的数据结构写 mock 数据和渲染逻辑。
4. 用第 6/7 节实现状态与队列逻辑（前端模拟即可）。
5. 满足第 11 节验收标准。

输出：

- 一个可本地运行的页面。
- 一个 README，说明如何启动和演示关键交互。
