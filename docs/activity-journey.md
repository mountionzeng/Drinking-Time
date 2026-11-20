# 关键操作阶段记录

这张表从部署之后记录新发生的阶段。它不回填历史，也不能用账务里的 `settled` 代替作品成功。

账号分类（自己的、测试、外部、待确认）不参与过滤。没有记录只表示这个阶段没有被观察到，不表示用户没做。

## 边界

| 表面 | 在这个仓库里能观察到什么 |
| --- | --- |
| 网站 | 登录后的新访问、进入创作页、已保存的未计费正文、本仓供应商提交和归一化失败、明确入库的图片、变为可播放的视频、打开充值入口、离开页面、打开仓库里已有图片 |
| 微信小程序服务端 | 已签名的 `/stories` 访问、读取某个故事、算力预占被接受。结算成功不算作品成功 |
| 仓库内 `miniprogram/` | 只是 mock 壳，不连接真实账号，本变更不把它算作小程序使用 |
| 独立小程序仓库 | 浏览、未计费编辑、退出、查看只存在于那边的作品，要等那边调用已签名的 `/api/shiguang/activity`。本变更不修改那个仓库，也不宣称已经覆盖 |

微信登录方式不等于小程序。平台只来自网站会话或已签名的小程序桥。

## 事件字典

保留 180 天。字段只有 `userId`、`platform`（`web` 或 `miniprogram`）、`eventName`、`result`（`none`、`succeeded`、`failed`、`unknown`）、`failureCategory`、`subjectKind`、`subjectRef`、`occurredAt`。去重键是内部哈希，不存提示词、作品、上传图、页面输入、聊天、邮箱、手机号、openid、完整 URL、查询串、IP、原始错误或任意扩展 JSON。

| 事件 | 谁写入 | 精确含义 | 去重 |
| --- | --- | --- | --- |
| `account.entered` | 服务端 | 网站：一条新的登录访问心跳首次写下。小程序：已签名桥成功列出故事，每 30 分钟最多一条 | 网站按访问号；小程序按用户和时间桶 |
| `creation.entered` | 网站客户端，或小程序读故事的服务端 | 网站：创作页挂载，表示进入创作，不表示已经修改。小程序：桥成功读出该用户的一个故事 | 客户端自行去重后再由服务端按用户和键哈希；小程序按故事和时间桶 |
| `creation.edited` | 仅服务端 | 网站故事正文 CAS 保存成功。这是未计费编辑的服务器证据。同一故事每个 UTC 日一条。没保存的输入不记 | 故事编号加 UTC 日 |
| `creation.edit_started` | 客户端或已签名小程序桥 | 对方声称开始了一次未计费编辑。没有正文。不能当成已经保存 | 调用方去重键 |
| `generation.submitted` | 服务端 | 本仓供应商尝试进入 `submitted` 或 `task_known`，或小程序预占首次被接受。小程序这条只表示本仓接受了预占，不表示外部供应商已经收到请求 | 同一计费操作只记一条，重试不新增 |
| `generation.resolved` | 服务端 | `succeeded` 只在图片以生成结果入库，或视频首次变为 `available` 且有地址或 key，或出图任务首次把候选写入仓库时出现。`failed` 来自供应商 `not_charged_failure` / `charged_failure`，类别为 `not_charged` 或 `charged`。任务表上的失败没有安全类别时记 `unspecified`。`unknown` 只表示提交结果不明。供应商回执 `succeeded` 和账务 `settled` 都不产生这条成功 | 同一操作的同一种失败或未知结果只记一条；每张已入库图片、每个可播放视频各一条 |
| `result.opened` | 客户端，服务端核对 | 用户打开了属于自己、并且已经持久化的图片，或状态为 `available` 且有地址或 key 的视频。别人的、不存在的、还不可播放的都不记。客户端不能自己声明成功 | 调用方去重键 |
| `recharge.opened` | 客户端 | 打开了充值入口。不是订单，不是支付成功 | 每次打开可以是新键；频繁点击会被限流 |
| `session.ended` | 客户端 | 浏览器发出 `pagehide`，或小程序桥明确报告离开。没收到就不记，不能据此计算停留，也不能把缺席解释成仍在线。单页内跳转通常不会触发 | 每个访问号一条 |

失败类别只有 `not_charged`、`charged`、`submission_unknown`、`unspecified`。

## 漏斗只读查询

下面的语句只读 `activity_journey_events`。不要连接故事正文、提示词或身份材料。不要用管理员标签把账号排除在外。

```sql
-- 近 30 天，每个平台到达过各阶段的账号数。一个账号只计一次。
SELECT platform, eventName, result, COUNT(DISTINCT userId) AS accounts
FROM activity_journey_events
WHERE occurredAt >= UTC_TIMESTAMP() - INTERVAL 30 DAY
GROUP BY platform, eventName, result
ORDER BY platform, eventName, result;
```

```sql
-- 同一个账号在网站和小程序的阶段时间线。:userId 是内部编号。
SELECT occurredAt, platform, eventName, result, failureCategory, subjectKind, subjectRef
FROM activity_journey_events
WHERE userId = :userId
  AND occurredAt >= UTC_TIMESTAMP() - INTERVAL 30 DAY
ORDER BY occurredAt;
```

```sql
-- 生成漏斗：提交过、服务端确认成功、服务端确认失败、之后又打开过结果。
-- 成功只认 generation.resolved 且 result = succeeded。
SELECT platform,
  COUNT(DISTINCT IF(eventName = 'generation.submitted', userId, NULL)) AS submitted_accounts,
  COUNT(DISTINCT IF(eventName = 'generation.resolved' AND result = 'succeeded', userId, NULL)) AS succeeded_accounts,
  COUNT(DISTINCT IF(eventName = 'generation.resolved' AND result = 'failed', userId, NULL)) AS failed_accounts,
  COUNT(DISTINCT IF(eventName = 'result.opened', userId, NULL)) AS opened_result_accounts
FROM activity_journey_events
WHERE occurredAt >= UTC_TIMESTAMP() - INTERVAL 30 DAY
GROUP BY platform;
```

管理员接口 `activityJourney.funnel` 和 `activityJourney.account` 也只返回这些聚合或阶段行。普通用户不能读。

## 不能当成事实的东西

- `billing_operations.status = settled`、`provider_attempts.status = succeeded`：可能是扣费或供应商回执，不是作品已入库。
- `access_sessions`：主要是网站心跳。`getAccessOverview` 仍只统计有邮箱的用户，微信无邮箱账号会从那张旧名单漏掉。新表不按邮箱过滤，也不修改那张旧名单的含义。
- 小程序里没有打到本仓的浏览、编辑和退出：没有事件。
- 同步出图里尚未显式标记 `recordGenerationResult` 的保存点，以及不经过「可播放视频」或出图任务入库的结果，不会出现 `generation.resolved/succeeded`。已标记的包括手机草稿、正式候选、局部修复，以及创作代理里两次确认拿到图片之后的入库。
- 历史不会补写。部署前的 30 天身份、零调用和算力消耗仍然只能用当时的账本和任务表解释。

## 采集失败

写入放在独立的捕获里。表还没建、唯一键冲突、突发超过每用户每分钟 500 条，都只丢弃阶段记录。图片入库、正文保存、预占和结算仍按原来的结果返回。网页上报失败被界面忽略。

客户端接口每用户每分钟 30 条。请求体是封闭结构，最大只接受小的 JSON。不能带 `userId` 或 `platform`。小程序上报必须走已有的桥签名、时间窗和一次性 nonce，身份由 `shiguang:` 主体解析。

## 上线顺序

1. 审阅 `drizzle/0043_activity_journey.sql`。它只建表和索引。不要在这次审查里对正式库执行。
2. 先执行这条迁移，再发布应用。旧应用不读新表。若应用先发布，缺表时新事件会被丢弃，创作和支付不受影响；补上表之后才开始有记录。
3. 发布后用只读查询看新事件是否出现。不要用它解释发布前的账号。
4. 小程序客户端行为要另一次在独立仓库里接入 `/api/shiguang/activity`，接入前不要宣称小程序浏览、编辑和退出已经完整。

## 回滚

回滚应用即可停止新写入。留下数据表。不要用向下迁移删除正式数据，除非明确决定放弃这段新记录；删除语句不在正向迁移里。回滚不恢复历史空白，因为那些记录本来就没有。

## 清理

超过 180 天的行由下面的命令分批删除。默认拒绝看起来像正式库的主机。本审查不执行它。

```bash
ACTIVITY_JOURNEY_PRUNE_CONFIRM=yes pnpm exec tsx scripts/prune-activity-journey.ts
```

正式主机还要额外设置 `ACTIVITY_JOURNEY_PRUNE_PRODUCTION=I-reviewed-this`。命令只删除这张表里过期的行。
