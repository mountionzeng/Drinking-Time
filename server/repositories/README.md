# 数据持久化模块

`server/db.ts` 只保留旧调用方所需的显式导出。新的持久化实现放在这里，
路由和业务服务优先通过已有的领域 persistence 入口调用，不直接访问共享状态。

| 职责                                                   | 模块                                                                           |
| ------------------------------------------------------ | ------------------------------------------------------------------------------ |
| 连接、本地状态、加载、备份、写盘合并、聚合锁、侧车文件 | `runtime.ts`                                                                   |
| 用户、登录身份、验证码、邀请码、访问统计               | `users.ts`、`accounts.ts`、`invites.ts`、`accessAnalytics.ts`                  |
| 项目、参考资料、分镜、分析、每日来信投影               | `projects.ts`、`references.ts`、`shots.ts`、`analysis.ts`、`emotionLetters.ts` |
| 故事读写与版本校验；删除及访客认领                     | `stories.ts`、`storyLifecycle.ts`                                              |
| 图片、视频、音频资产与导入                             | `images.ts`、`videos.ts`、`audioAssets.ts`                                     |
| 遮罩编辑、抽帧操作回执                                 | `maskedImageOperations.ts`、`frameExtractions.ts`                              |
| 时间线、故事与时间线原子更新、衍生镜头                 | `timelines.ts`、`shotDerivations.ts`                                           |
| 声音方案、方案版本、行操作和本人音色记录               | `soundPlans.ts`                                                                |
| 算力预留、结算与账本                                   | `computeLedger.ts`                                                             |
| 个人记忆事件、来信版本及尝试、理解与隐私操作           | `memoryEvents.ts`、`memoryLetters.ts`、`memoryInsights.ts`                     |
| 编辑历史、素材谱系查询                                 | `editHistory.ts`、`assetLineage.ts`                                            |

`storyValues.ts` 和 `memoryRows.ts` 是纯值转换；`timelineCodec.ts` 负责衔接
既有 `persistence/storyTimelinePersistence.ts` 编解码器，保留字幕、音频等扩展字段。
`testing.ts` 只提供已有测试的 seed 和声音状态 round-trip 辅助。

## 必须保持的边界

- 每个进程只有一个 `runtime.ts` 实例，所有仓库共享连接、内存状态和写盘队列。
- 仓库不能反向导入 `db.ts`，模块依赖不能成环；运行时不依赖任何业务仓库。
- 不把每个仓库改成独立 JSON 文件。主文件、提示词谱系、编辑快照的路径与格式保持兼容。
- 同一个原子操作内的 SQL 必须继续使用同一个 `tx`；不得拆成多次独立提交。
- 本地写入继续经过原有锁、写盘合并、原子替换、备份和测试路径保护。
- `memoryState`、队列与锁属于仓库内部，不向路由或服务导出。
- 新增入口优先扩展已有 persistence 模块；`db.ts` 用于兼容旧代码。
- 需要模拟写入失败的测试应 spy 实际仓库导出，或 mock persistence 入口。
  只 spy `db.ts` 的转发导出不会拦截已经直连仓库的调用方。

运行 `pnpm exec vitest run server/repositories server/db.` 可验证依赖边界、
新旧入口共享状态、故事归属、时间线冲突、持久化失败及本地侧车文件兼容性。
真实 MySQL 验证使用已有的 `pnpm test:mysql-integration`，需要独立的
`TEST_MYSQL_DATABASE_URL`；本地回归通过不代表 MySQL 集成已执行。

## 这次拆分的范围

本轮搬迁保留原函数的参数、返回值、查询和事务语义，没有修改数据库 schema，
不需要迁移或重写 `.webdev` 数据。旧故事、旧 Timeline 和 legacy 声音读取仍保留。

已知历史限制仍存在：部分本地写失败只抛错而不回滚内存；声音方案的 MySQL
版本编号仍使用原来的 `MAX + 1` 分配；`story.body` 仍承载多个领域的 JSON。
这些需要各自的行为修复及验证，不能凭拆文件宣称已解决。
