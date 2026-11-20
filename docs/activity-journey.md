# 网站关键阶段记录

这张表只准备记录开关打开之后的新事件。它不回填历史。注册仍以已验证身份的 `users` 行为准，不从这里推断有没有注册成功。

账号分类（自己的、测试、外部、待确认）不参与过滤。没有记录只表示这个阶段没有被观察到。

本次不改小程序桥，也不新增小程序客户端。`platform` 仍保留 `miniprogram` 这个封闭值，但网站发布不会往小程序路径写事件。

## 默认关闭

未设置 `ACTIVITY_JOURNEY_ENABLED=true` 时，服务端直接丢弃阶段写入，创作、扣费和支付按原结果返回。回滚时把这个变量改回非 `true` 并重启即可停止新写入，不必删表。

## 事件字典

保留 180 天。字段只有 `userId`、`platform`、`eventName`、`result`（`none`、`succeeded`、`failed`、`unknown`）、`failureCategory`、`subjectKind`、`subjectRef`、`occurredAt`。去重键是内部哈希。不存提示词、作品、上传、输入、聊天、邮箱、手机号、openid、完整 URL、查询串、IP、原始错误、停留秒数或任意扩展 JSON。

| 事件 | 谁写入 | 它证明什么 | 它不证明什么 |
| --- | --- | --- | --- |
| `visit.started` | 服务端，新的网站访问心跳 | 一个已登录会话第一次写下这条 `access_sessions` | 不是注册成功，不是登录接口成功，不是开始创作 |
| `creation.entered` | 网站创作页挂载 | 用户打开了桌面创作页或手机创作页 | 不是新建故事，不是生成 |
| `creation.edited` | 服务端，故事正文 CAS 保存成功 | 该故事在这个 UTC 日至少保存过一次正文 | 不是每一次按键，不是生成，不保存正文 |
| `generation.submitted` | 服务端 | 供应商尝试写入了非空任务号，或出图任务首次记下供应商任务号。同一计费操作只记一条 | 不是用户刚点了按钮。没有任务号的 `submitted` 回执不算。同步出图没有这条中间记录 |
| `generation.resolved` | 服务端 | `succeeded`：生成图片行已写入，或视频首次变为 `available` 且有地址或 key，或出图任务首次把候选写入仓库。`failed`：供应商尝试已是 `not_charged_failure` 或 `charged_failure`。`unknown`：提交结果仍不明 | 不是供应商回执 `succeeded`，不是账务 `settled`，也不是又向公网读过文件字节 |
| `result.opened` | 网站点击，服务端核对归属 | 用户在仓库里点击了属于自己、并且已有地址的图片 | 鼠标悬停不算。不是生成成功。聊天和其他播放器还没接 |
| `recharge.opened` | 打开充值弹窗 | 用户点开了充值入口 | 不是下单，不是支付成功 |
| `session.ended` | 浏览器 `pagehide` | 这次访问发出过离开信号 | 没收到就不能推算停留，也不能当成还在页面上。单页内跳转通常不会触发 |

失败类别只有 `not_charged`、`charged`、`submission_unknown`、`unspecified`。

再次使用不是单独事件。它是同一 `userId` 上晚于前一条 `visit.started` 的下一次访问，或下一次 `generation.submitted` / `generation.resolved`。

## 网站覆盖

| 阶段 | 实际插桩 | 缺口 |
| --- | --- | --- |
| 注册 | 不写阶段。用已有用户表 | 不能用 `visit.started` 代替注册数 |
| 登录后访问 | `AccessTracker` 的新访问心跳，排除客户端的访客会话 | 直接调用心跳接口的已登录访客仍会记下 |
| 进入创作 | 桌面或手机创作页挂载 | 只打开首页或其他页面不会有 |
| 未计费编辑 | 故事正文保存成功，每日每故事一条 | 没保存的输入没有 |
| 提交生成 | 有供应商任务号的尝试，或出图任务接受任务号 | 同步出图在同一请求里直接入库，中间没有可证明的提交行 |
| 成功 | 标记过的图片入库、可播放视频、出图任务入库 | 没标记 `recordGenerationResult` 的其他插图不会被算成功 |
| 失败 | 供应商尝试的明确失败或结果不明 | 不复制原始错误 |
| 查看结果 | 仓库图片点击，且图片属于当前用户 | 悬停、聊天画廊、视频播放器未接 |
| 充值入口 | 充值弹窗打开 | 不写订单 |
| 离开 | `pagehide` | 没有信号就没有时长 |

## 漏斗只读查询

不要连接正文、提示词或身份材料，也不要用管理员标签排除账号。

```sql
-- 近 30 天各阶段的账号数。这是到达过该事件的人数，不是同一条作品的先后顺序。
SELECT eventName, result, COUNT(DISTINCT userId) AS accounts
FROM activity_journey_events
WHERE platform = 'web'
  AND occurredAt >= UTC_TIMESTAMP() - INTERVAL 30 DAY
GROUP BY eventName, result
ORDER BY eventName, result;
```

```sql
-- 打开过一张已经入库成功的图片。必须同一用户、同一种类、同一个内部编号。
SELECT COUNT(DISTINCT opened.userId) AS accounts
FROM activity_journey_events opened
JOIN activity_journey_events stored
  ON stored.userId = opened.userId
 AND stored.subjectKind = opened.subjectKind
 AND stored.subjectRef = opened.subjectRef
 AND stored.eventName = 'generation.resolved'
 AND stored.result = 'succeeded'
WHERE opened.platform = 'web'
  AND opened.eventName = 'result.opened'
  AND opened.occurredAt >= UTC_TIMESTAMP() - INTERVAL 30 DAY;
```

```sql
-- 再次使用：同一账号至少有两次网站访问。
SELECT userId, COUNT(*) AS visits
FROM activity_journey_events
WHERE platform = 'web' AND eventName = 'visit.started'
  AND occurredAt >= UTC_TIMESTAMP() - INTERVAL 30 DAY
GROUP BY userId
HAVING COUNT(*) >= 2;
```

管理员接口 `activityJourney.funnel` 与 `activityJourney.account` 只返回聚合或阶段行。普通用户调用被拒绝。

## 采集约束

客户端每分钟 30 条。请求必须是最多 5 个字段的扁平对象，字符串不超过 80。不能带 `userId`、`platform`、`result`、停留秒数或嵌套对象。服务端突发上限是每用户每分钟 500 条，超出只丢弃记录。

缺表、唯一键冲突和开关关闭都返回丢弃，不抛给创作或支付。

## 迁移

`drizzle/0043_activity_journey.sql` 只执行一条 `CREATE TABLE`。含主键、`(userId, dedupeKey)` 唯一键、时间和用户索引，以及指向 `users.id` 的级联外键。没有 `DROP`、`ALTER`、`UPDATE`、`DELETE` 或 `INSERT`。旧代码不读这张表。

建议顺序：先建表，发布应用时保持开关关闭，确认服务正常后再设 `ACTIVITY_JOURNEY_ENABLED=true` 并重启。表还没建时即使打开开关，写入也会被缺表捕获，创作不受影响。

## 回滚

1. 去掉 `ACTIVITY_JOURNEY_ENABLED` 或改成非 `true`，重启。新事件停止。
2. 若要撤掉应用代码，回退这个发布。表可以留下。
3. 不在正向迁移里删除表。只有明确放弃这段新记录时才手工 `DROP TABLE activity_journey_events`。

## 清理

```bash
ACTIVITY_JOURNEY_PRUNE_CONFIRM=yes pnpm exec tsx scripts/prune-activity-journey.ts
```

正式主机还要 `ACTIVITY_JOURNEY_PRUNE_PRODUCTION=I-reviewed-this`。本审查不执行清理，也不连接正式库。

## 不能补的历史

发布前的心跳、账本、供应商尝试和空的出图任务表不能变成这些事件。当时的 `settled` 仍然不是作品成功。没有 `pagehide` 的访问不能补出停留时长。
