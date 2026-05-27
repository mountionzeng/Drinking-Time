# Drinking Time 数据结构诊断报告

> 最后更新：2026-05-23
> 本文档审查现有数据模型和存储模式，识别脆弱点，并给出具体的加固建议。

---

## 一、现有数据结构总览

### 1.1 数据库表（`drizzle/schema.ts`）

| 表名 | 记录数量级 | 核心用途 |
|------|-----------|---------|
| `users` | 少量 | 用户认证 |
| `projects` | 每用户几个 | 项目容器 |
| `references` | 每项目数十条 | 上传素材 |
| `shots` | 每项目数十条 | 镜头生产数据 |
| `analysis_results` | 每项目 1 条 | AI 环境分析结果 |
| `stories` | 每用户数条 | 故事（JSON blob） |
| `edit_snapshots` | 增长型 | 编辑状态快照 |
| `semantic_annotations` | 增长型 | LLM 推断的用户偏好 |
| `generated_images` | 快速增长 | AI 生成图片记录 |

### 1.2 前端持久化（localStorage）

| Key 格式 | 存储内容 |
|---------|---------|
| `dt:storyAgent:${projectId}` | 对话历史、情感卡片、剧本、镜头列表、角色 |
| `dt:creationAgent:${projectId}` | 对话历史、焦点镜头号 |
| `manus-runtime-user-info` | 用户基本信息缓存 |

### 1.3 服务器内存状态（`db.ts` 内存模式）

`.webdev/local-persist.json` — 完整的数据库镜像，包括所有 9 张表的数据 + 自增 ID 计数器。

---

## 二、脆弱点诊断

### 脆弱点 1：故事数据的"双重存储"问题 ⚠️ 高风险

**现状：** 故事数据存在两个地方：
1. **前端 localStorage**（`dt:storyAgent:${projectId}`）：包含完整的 cards、shots、characters、script
2. **后端 stories 表**（`stories.body` JSON 列）：同样存储 cards、characters、shots

**问题：**
- 两边数据可能不同步。前端编辑后如果 `story.save` 请求失败，localStorage 有最新数据但服务器没有
- 清除浏览器缓存 = 丢失未同步的工作
- 换设备/换浏览器时，只能看到服务器上的旧数据
- 没有冲突检测：如果两个标签页同时编辑同一个项目，互相覆盖

**加固建议：**
1. **明确谁是 Source of Truth**：建议以服务器为准，localStorage 作为写缓冲（write-behind cache）
2. **添加版本号**：在 `stories` 表加 `version int` 字段，每次保存 +1。前端保存时带上当前版本号，服务器端做乐观锁校验
3. **添加自动保存防抖**：前端编辑后 3 秒无操作自动上传到服务器，减少不同步窗口
4. **添加最后同步时间指示器**：让用户知道当前数据是否已保存到服务器

---

### 脆弱点 2：`stories.body` JSON blob 过于松散 ⚠️ 高风险

**现状：** `stories.body` 是一个 `json` 列，存储结构定义在 `StoryBody` TypeScript 类型中，但：
- 数据库层面没有任何校验
- `StoryBody` 类型有 `[key: string]: unknown` 索引签名，任何额外字段都能进来
- 前端直接整 blob 覆盖写入（`updateStory` 是 `Partial<InsertStory>` 覆盖）

**风险：**
- 随着功能增加，blob 会越来越大越来越杂，没有迁移机制
- 错误的数据格式写入后，读取端崩溃
- 无法对 blob 内部字段做查询或索引

**加固建议：**
1. **移除索引签名**：把 `[key: string]: unknown` 从 `StoryBody` 类型中删掉，强制所有新字段显式声明
2. **添加运行时校验**：在 `updateStory` 写入前用 Zod schema 验证 body 结构
3. **添加版本字段**：在 StoryBody 中加 `version: number`，每次结构变更时升版本，读取时做迁移
4. **考虑拆表**：如果 shots 数据需要独立查询（比如跨故事搜索镜头），应该把 `shots` 从 JSON 提升为独立表。当前 `shots` 表（用于 Analysis）和 `stories.body.shots`（用于 StoryAgent）是两套独立数据，语义重叠但互不关联

---

### 脆弱点 3：shots 表和 storyShots 的数据割裂 ⚠️ 中高风险

**现状：** 系统中有两套"镜头"概念：

| 数据源 | 存储位置 | 用途 |
|--------|---------|------|
| `shots` 数据库表 | MySQL / 内存 | Analysis 页面的镜头生产表 |
| `StoryBody.shots` | stories.body JSON 内 | StoryAgent 生成的镜头列表 |
| `storyShots`（前端） | StoryAgentContext（localStorage） | 前端运行时状态 |

**问题：**
- CreationPage 用 `storyShots` 转换成 `BackendShot` 格式给 ShotTable 显示（`CreationPage.tsx:46-95`），这个转换逻辑很脆弱：
  - `id` 用负数（`-1 * (index + 1)`）来区分不是真实数据库记录
  - `sceneNo` 通过 `Math.ceil((index+1)/6)` 计算，随镜头增删会变
  - `status` 用 beat 名称硬编码映射（"收束"→production_ready, "转折"→structured）
- 两套镜头没有关联关系，修改一边不影响另一边

**加固建议：**
1. **短期：统一 ID 体系**：给 `StoryBody.shots` 里的每个 shot 一个稳定的 UUID，不再用数组 index
2. **中期：建立关联**：让 `generated_images.shotNo` 可以关联到 storyShot 的 UUID，而不只是位置编号
3. **长期：合并为一张表**：考虑把 StoryAgent 生成的镜头直接写入 `shots` 表，用 `sourceType` 区分来源。这样所有镜头数据走同一条管道

---

### 脆弱点 4：`generated_images` 的 `shotNo` 是字符串引用 ⚠️ 中风险

**现状：** `generated_images` 表的 `shotNo` 存储类似 "SH02" 的字符串，不是外键。

**问题：**
- 如果镜头重新编号（比如删除了 SH01，其余镜头前移），图片关联就断了
- 没有外键约束，数据库不会阻止无效的 shotNo
- 拖拽重分配（`reassignImage`）只改 `shotNo` 字符串，如果目标 shotNo 不存在也不会报错

**加固建议：**
1. **添加 shotId 字段**：用整数 ID 引用 shots 表的主键，shotNo 保留为显示用
2. **或者**（如果不建 shots 表外键）：至少添加服务端校验，reassign 时验证目标 shotNo 确实存在于当前项目的镜头列表中
3. **添加索引**：给 `(projectId, shotNo)` 加组合索引，加速按镜头号查图片

---

### 脆弱点 5：内存模式的并发安全 ⚠️ 中风险

**现状：** 内存模式下，所有数据在一个全局 `memoryState` 对象中，写操作串行化到 `memoryPersistQueue`。

**问题：**
- 同时处理多个请求时，读-改-写不是原子的：两个请求同时读到相同状态，各自修改后依次写回，后写的覆盖前写的
- `persistMemoryState` 是异步的，但中间没有锁，快速连续的写操作可能导致数据覆盖
- JSON 文件越大（图片记录增长），每次全量序列化+写盘的开销越大

**加固建议：**
1. **对于本地开发这个场景**：当前的串行化队列已经"够用"，但要意识到它不保证一致性
2. **如果内存模式要长期保留**：考虑用 SQLite 替代 JSON 文件，获得真正的事务支持
3. **限制 generatedImages 增长**：添加项目级别的图片上限，或定期清理非 current 的历史图片

---

### 脆弱点 6：缺少外键约束 ⚠️ 中风险

**现状：** 所有表之间的关系都是"逻辑外键"（代码中通过 `where(eq(...))` 查询），数据库表定义中没有 `references()` 外键约束。

**受影响的关系：**
- `projects.userId → users.id`
- `references.projectId → projects.id`
- `shots.projectId → projects.id`
- `stories.userId → users.id`
- `stories.projectId → projects.id`
- `generated_images.projectId → projects.id`
- `generated_images.parentImageId → generated_images.id`
- `edit_snapshots.projectId → projects.id`
- `semantic_annotations.snapshotId → edit_snapshots.id`

**问题：**
- 删除用户/项目后，关联数据成为孤儿记录
- 没有级联删除，数据会无限膨胀

**加固建议：**
1. **添加外键约束**：在 `drizzle/schema.ts` 中使用 `.references(() => ...)` 声明外键
2. **添加级联删除规则**：
   - 删除 project → 级联删除 references、shots、generated_images、edit_snapshots
   - 删除 user → 级联删除 projects、stories
3. **添加孤儿数据清理**：如果不加外键，至少写一个定期清理脚本

---

### 脆弱点 7：前端 localStorage 无大小控制 ⚠️ 低中风险

**现状：** `StoryAgentContext` 把完整的对话历史、所有卡片、完整剧本都存入 localStorage。

**问题：**
- localStorage 有 5-10MB 上限（因浏览器而异）
- 长期使用，对话历史不断增长，可能碰到上限
- 碰到上限后 `setItem` 静默失败或抛异常，导致数据丢失
- 多个项目各自占空间，加速到达上限

**加固建议：**
1. **对话历史裁剪**：只保留最近 N 条消息（如 50 条），更早的压缩为摘要
2. **添加存储大小监控**：写入前检查 `JSON.stringify(state).length`，接近上限时提醒用户
3. **大数据迁移到 IndexedDB**：localStorage 适合小数据，大的 blob 数据（如完整卡片列表）应该迁移到 IndexedDB

---

### 脆弱点 8：`edit_snapshots.state` JSON blob 无限增长 ⚠️ 低中风险

**现状：** 每次编辑快照保存整个项目状态（`ProjectState`）作为 JSON blob。

**问题：**
- 项目越大，每个快照越大
- 快照不断累积，没有清理策略
- 内存模式下所有快照常驻内存

**加固建议：**
1. **快照保留策略**：只保留最近 N 个快照（如 20 个），自动清理更早的
2. **增量存储**：已有 `diff` 字段但似乎没有充分利用，考虑只存 diff，需要时从基准快照 + diff 链重建
3. **压缩**：大型快照先 gzip 再存储

---

## 三、加固优先级建议

按 **影响面 × 修复成本** 排序：

| 优先级 | 脆弱点 | 建议行动 | 预估工作量 |
|--------|--------|---------|-----------|
| **P0** | #2 StoryBody 松散 | 移除索引签名，加 Zod 校验 | 小（1-2小时） |
| **P0** | #1 双重存储 | 明确 source of truth，加版本号 | 中（半天） |
| **P1** | #3 镜头割裂 | 给 storyShots 加 UUID | 小（1-2小时） |
| **P1** | #4 shotNo 字符串引用 | 添加服务端校验 | 小（1小时） |
| **P1** | #7 localStorage 无限增长 | 添加消息裁剪 + 大小监控 | 小（1-2小时） |
| **P2** | #6 缺少外键 | 添加 schema 外键定义 | 中（需要迁移） |
| **P2** | #5 内存并发 | 短期无需改，长期考虑 SQLite | 大 |
| **P3** | #8 快照增长 | 添加保留策略 | 小（1小时） |

---

## 四、未来功能扩展的数据准备

基于你说"功能是一定会加的"，这里列出常见扩展方向对数据结构的要求：

### 4.1 多人协作

**当前问题：** 没有共享模型，所有数据都绑定单个 userId
**需要加的：**
- `project_members` 表（projectId, userId, role）
- stories 表也需要类似的 `story_members` 表（schema 注释已提到这个计划）
- 所有查询从 `where(userId = ?)` 变为 `where(userId in members)`

### 4.2 版本历史 / 撤销

**当前问题：** Story 整 blob 覆盖写入，没有历史版本
**需要加的：**
- `story_versions` 表，或利用已有的 `edit_snapshots` 机制
- 前端撤销栈

### 4.3 模板系统

**当前问题：** 无法保存和复用风格/场景模板
**需要加的：**
- `templates` 表（userId, category, name, body JSON）
- 从 analysisResults 抽取出可复用的风格参数

### 4.4 导出功能

**当前问题：** 数据锁在 JSON blob 里，不好导出
**建议：** 如果要做 PDF/PPT 导出，storyShots 的结构化程度会直接影响导出质量。这也是推荐拆表的原因之一。

---

## 五、一句话总结

你的直觉是对的——当前数据结构最大的风险不是"会崩"，而是 **"数据在多个地方有不同版本的副本，且缺少严格的类型校验和关联约束"**。随着功能增加，这个问题会指数级放大。

最关键的第一步：**收紧 StoryBody 类型 + 明确 localStorage vs 服务器的主次关系**。这两个改动成本低，但能为后续所有功能扩展打下可靠的基础。
