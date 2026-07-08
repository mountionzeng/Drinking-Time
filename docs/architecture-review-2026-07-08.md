# 架构诊断：为什么"加一个小功能总是触发别处的 bug"

> 写作背景：2026-07-08 一天内连续处理了镜头表滚雪球（6758 镜头/322MB 响应/启动 OOM）、
> 故事反复另存副本、草稿 -1 无限重试 400、拖拽后滚动失控、媒体路由 401 等一串故障。
> 这些 bug 表面互不相干，底下是同一批结构性原因。本文把"症状 → 根因"对应起来，
> 并给出**不推倒重来**的渐进式修法。基于 commit e598a3d 时的代码。

---

## 一句话诊断

**这个项目的病不在 agent 层、不在 UI 层，而在数据层：`story.body` 是一个无 schema 的
巨型 JSON 黑箱，同一个事实存了四五份，靠命名约定和猜测式合并保持同步。**
每加一个功能都要碰这个黑箱，而黑箱不会在你违反别人的假设时报错——它等到运行时、
在另一个功能里、以数据损坏的形式爆炸。

---

## 症状 → 根因对照表（全部来自 07-08 实际故障）

| 当天的 bug | 直接原因 | 背后的结构性问题 |
|---|---|---|
| 镜头表滚雪球到 6758 条 | `mergeStaleStoryBody` 把身份没对上的镜头整表追加，重编号后永远对不上 | **R1 无 schema 黑箱** + **R2 身份不稳定** |
| 故事被反复另存成新副本 | 保存失败→清 remoteStoryId→下次整篇新建；服务端对查不到的 id 静默新建 | **R3 手搓的分布式状态机** |
| 草稿 -1 打服务端 400 无限重试 | 五个查询的 `enabled` 都要"记得"判 `> 0` | **R4 哨兵值当类型用** |
| getStoryProjection 322MB/75秒 | 读取时全量重建 lineage 并整棵返回 | **R5 读路径带写副作用 + 无上限** |
| 启动 OOM"打不开" | lineage 383MB 全量加载 + 每次事务 structuredClone 整个 store | **R5** + 文件级持久化 O(全量) |
| 拖 take 后滚动冲到底 | 子元素 stopPropagation 拦掉了容器上负责"停止循环"的 onDrop | **R6 隐形契约**（靠事件冒泡约定协作） |
| 视频 401（tRPC 却正常） | 鉴权逻辑在 context.ts 和 mediaRouteAuth.ts 各写一份 | **R6 同一职责两处实现** |
| 故事散落 63 个访客账号 | 每个浏览器隐式建新用户 | 身份从来不是显式模型 |

---

## 五个根因，按杠杆排序

### R1｜`story.body` 是无 schema 的巨型黑箱（最大根因）

`body: Record<string, unknown>` 里塞着 cards、shots、messages、visualCanvasItems、
visualPreference、imageProvider、artDirection、confirmedIntent、variants……
**客户端整包回传，服务端整包覆盖或猜测式合并**（`prepareStoryBody` / `mergeStaleStoryBody`）。
至少 6 个 server 文件直接改写它。

为什么这导致"加功能→别处爆雷"：任何功能往 body 里加字段/改结构，都在隐式修改
其他所有功能的输入，而没有任何一层会报错。合并逻辑猜不出"这次回传是新增还是重放"，
只能靠启发式——今天的滚雪球就是启发式猜错的代价。

### R2｜"镜头"这个概念存了 4+ 份，身份靠 5 种别名互认

同一个镜头同时活在：`body.shots`（黑箱内）、顶层 `shots` 表、prompt-lineage 的
nodes/bindings（按维度拆开）、videoTakes 的 `stableShotId` 引用、edit-snapshots 的整状态快照。
`shared/shotIdentity.ts` 里 `shotIdentityAliasesForNumber` 要为一个镜头号生成
**五种别名**（`genji-sXX` / `legacy-shXX` / `legacy-shXX-shot` / `shot-XX` / `shXX`）
才能让各处互相认得——这就是"身份从未被定义为唯一事实"的铁证。
身份一旦从 shotNo 派生，重编号就等于换身份，滚雪球由此而来。

### R3｜持久化是手搓的分布式状态机，失败路径靠猜

客户端在 3040 行的 `StoryAgentContext` 里自管 remoteStoryId、serverRevision、
saveStatus、保存队列、失败降级；服务端 storySave 对"带 id 查不到"静默降级新建。
两边的降级启发式一组合：瞬时网络错误 → 数据分叉（一小时复制十几篇故事）。

### R4｜不变量靠约定，不靠类型

草稿故事 = `-1`、身份格式 = 字符串约定、"activeId 必须 > 0 才能发请求" = 每个
调用点自觉——违反这些约定编译期零反馈，运行时在别的模块里爆。

### R5｜派生数据在读路径上重建、无上限返回

`getStoryProjection` 先跑迁移（写！）再整棵返回；lineage store 每次事务
structuredClone 整个 state、每次落盘重写整个 JSON。数据一膨胀，读、写、启动全部同归于尽。

### R6｜巨石文件让"不相关的功能"物理上相关

`db.ts` 4187 行（所有实体的 CRUD）、`StoryAgentContext.tsx` 3040 行（拉数据+状态机+
聊天编排+持久化）、`StoryCardsBoard.tsx` 2460 行、`CreationEditorContext.tsx` 1857 行。
改 A 功能必须打开 B、C 功能共存的文件，事件冒泡/闭包/共享 ref 构成的隐形契约一碰就断。

---

## 值得肯定的部分（不要动它们）

- `server/routers/` 已按域拆分；services 层的 agent 分工有文档（agent-architecture-map.md）。
- `renderGate` 作为出图唯一必经点——这正是"单一写路径"的正确范式，应该推广到数据层。
- 737 个测试、10 秒跑完；docs/solutions 的事故沉淀文化。
- `storyOperations` 表已存在——意图级操作的基础设施已经埋了一半。

---

## 渐进式修法（按优先级，每步独立可交付）

### P0：立契约（一周内可完成，杠杆最大）

1. **给 `story.body` 定 zod schema**（放 `shared/storyBody.ts`），在所有边界 parse：
   storySave 入口、prepareStoryBody 出口、迁移 seed。先覆盖 shots/cards 两个数组。
   目的不是一次定死结构，而是让"违反假设"从静默漂移变成当场报错。
2. **镜头身份唯一化**：新镜头一律 `nanoid` 一次性发放身份，永不从 shotNo 派生；
   写一个一次性脚本把存量五种别名归一；`shotIdentityMatchKeys` 进入弃用倒计时。
3. **StoryId 品牌类型 + 草稿用 null**：`type StoryId = number & { __brand: 'StoryId' }`，
   草稿态用 `null` 表达而不是 `-1`——编译器会替你找出所有漏判的调用点。

### P1：收窄写路径（把 renderGate 范式搬到数据层）

4. **`body.shots` 单写者**：建一个 `storyShots` service，客户端只发意图级操作
   （insert/move/update/delete/replaceAll + expectedVersion），不再整 blob 回传让服务端猜。
   `storyOperations` 表就是为此准备的。滚雪球这类 bug 从机制上消失。
5. **把 messages（聊天记录）搬出 body**：追加型数据没有合并语义冲突，单独存立刻减小
   黑箱体积和合并面。

### P2：拆巨石（机械劳动，随做随收益）

6. **从 StoryAgentContext 抽出"持久化状态机"**：save 队列/revision/重试逻辑独立成
   `useStoryPersistence` 模块单测覆盖（今天的另存副本 bug 就藏在这里面）。
7. **db.ts 按实体拆文件**：stories/images/videoTakes/…各一个文件，纯搬运不改逻辑。

### P3：读写分离 + 防再爆

8. **getStoryProjection 去掉读时迁移**（迁移挪到写入时/启动时一次性做），
   返回只给 heads，历史修订走已有的 `listRevisionHistory` 分页。
9. **三个 .webdev 数据文件加体积告警**（>50MB 报警并指出最大贡献者）。
10. **给合并逻辑加性质测试**：`merge(merge(x, y), y)` 的镜头数必须稳定——
    这一条测试当初就能拦住滚雪球。

### 不建议做的事

- **不要现在换数据库/上重型框架**。问题在契约缺失，不在存储介质；换了 MySQL
  黑箱照样是黑箱。等 P0/P1 落地、写路径收窄后，迁移反而变得简单。
- **不要一次性大重构**。上面每一步都独立可交付、可验证，按顺序做即可。

---

## 怎么让这份诊断别过期

每修一个"加功能引发的连环 bug"，先对照本表：如果根因不在 R1-R6 里，把新根因补进来；
如果在，说明对应的 P 级修法该提优先级了。P0 三项全部落地后，本文档使命完成，可归档。
