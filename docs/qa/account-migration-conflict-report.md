# 账号迁移冲突报告（只读采集，2026-09-02）

采集方式：SSH 到测试站 ECS，全部通过 `mysql -u root` 的 `START TRANSACTION READ ONLY` 执行 SELECT。
**未创建数据库账号、未部署脚本、未导入、未映射、未改库、未部署、未改环境。**

配套文档：`account-migration-inventory-all-sources.md`（计数与归属）、`account-migration-cutover-rollback-plan.md`（切库与回滚）。

---

## 1. 岱岱已给出的暂定裁决

| # | 裁决 | 对导入器的含义 |
|---|---|---|
| 1 | 旧库 user 11 作为**独立待认领账号**迁入，不绑定邮箱 | 建新用户，`account_identities` 不写任何 email 身份 |
| 2 | 本地 Guest 48 作为**另一个独立待认领账号**迁入，不与 user 11 合并 | 建第二个新用户，两者之间不建立任何关联 |
| 3 | `mountionzeng@gmail.com` 的旧库与 staging 记录映射到**全新统一账号 ID**，不沿用任何一侧的数字 ID | 新建 userId，两侧内容都重挂到它；依赖与账务无冲突后才允许合并 |
| 4 | 两个 QQ 邮箱账号一并迁入但**各自独立**，未经邮箱验证不自动激活 | 建两个新用户，`account_identities.verifiedAt` 留空，`credit_accounts.accessEnabledAt` 留空 |

裁决 3 的「无冲突才允许合并」由下面第 5、6 节的检查支撑。

---

## 2. 旧库第 29 条快照的归属

**全部 29 条都有归属，零孤儿。**

| projectId | 归属 userId | 快照数 |
|---:|---:|---:|
| 2 | 11（历史待认领） | 18 |
| 3 | 1（mountionzeng@gmail.com） | 10 |
| 4 | 1095（1132252560@qq.com） | 1 |
| | **合计** | **29** |

`edit_snapshots` 表**没有 `userId` 列**，归属只能经 `projectId → projects.userId` 推导。交接文档里「mountionzeng 有 10 个 edit snapshot」只是 user 1 那一片；余下 19 条属于另外两个账号。悬挂 `projectId` 的快照：**0 条**。

---

## 3. 逐表计数与内容哈希

哈希算法：每行对业务列做 `SHA2(CONCAT_WS(CHAR(31), …), 256)`，再按 `id` 升序把行哈希拼接后再取一次 SHA-256。
**刻意排除** `updatedAt`、`lastSignedIn` —— 它们随正常使用变化，纳入会让「导入前后一致」永远无法成立。

### 旧库 `drinking_time`

| 表 | 行数 | 内容 SHA-256 |
|---|---:|---|
| `users` | 4 | `dc950d78f96c6ce642ed01ac29df9155a62ef17f7523948ceed131b4a11f14d7` |
| `projects` | 5 | `6aeb64b64c9305a32bbdb948f8e699b21183740038f7e027289879f2ab4a7ed9` |
| `stories` | 1 | `ab96a688aabb68201c51e4e06b2bb35122ec1f58897547de18a0d6315c962c18` |
| `edit_snapshots` | 29 | `2efcc5b01f4681dd317e2755d755c7d97be3ede6451b5014ee2e5dd8fc7acc51` |
| `invite_codes` | 5 | `58bca8af5d8ffe844fb68ffcaee478414010b33e09e95a3927fabd169818ae70` |

其余表均为 0 行：`analysis_results`、`emotion_analysis_profiles`、`emotion_daily_letters`、`generated_images`、`image_signals`、`references`、`semantic_annotations`、`shots`。另有 `email_otps` 8 行、`access_sessions` 5 行（见第 4 节）。

### 测试库 `drinking_time_mobile_staging`

| 表 | 行数 | 内容 SHA-256 |
|---|---:|---|
| `users` | 1 | `7e40c9ce8c1b421a874bb334e35feef4074a613b824d7cf842604de8efc4cf87` |
| `projects` | 1 | `f6577ca92c50437685ce9aa57eba3c1b11e494ec705f5c9ba1e36ca44bbf63bf` |
| `stories` | 0 | （空） |
| `edit_snapshots` | 1 | `485b51b6032aba4c1ec058f61e2ddb850083bd8e65287305bb2486db36d6775e` |
| `invite_codes` | 2 | `89f05d12d8f15e89feaec0cf896c7fb0f79d619a64f133f5c7d581fc711ff112` |

### 本地 `.webdev/local-persist.json`

文件 sha256 `1ba00cecf0c7e2144e1f3f38d8c5e658c7a36d69264a2001c654ed9ddfd98ff7`；
sidecar `prompt-lineage-local.json` sha256 `0fe575af98fa5f5ea3da4d2ca7f0951b33a8c712b52b62de7f3c084f76700a6d`（9,758,451 字节）；
sidecar `edit-snapshots-local.json` sha256 `9991dfb38cface36b22e85fb18d96f3a40323ae64e11ed6303adf5ee8da7b70a`（34,760,374 字节）。
逐集合计数与内容摘要见 `account-migration-inventory-local.md`。

> **注意**：本地文件是活的。上一次采集期间就有别的会话在共享主仓跑 dev server，把它改写过一次。真正导入前必须冻结写入并重新取哈希，否则这里的值只是历史观察。

---

## 4. 身份凭据冲突

| 检查 | 结果 |
|---|---|
| 旧库 `email_otps` | 8 行，其中 2 行已使用，**8 行全部已过期** |
| 旧库 invite_codes 的 `redeemedByEmail` 在 users 表找不到对应账号 | **0 条** |
| 旧库 invite_codes 已领取但 `redeemedByUserId` 为空 | **0 条** |
| 两库之间 `invite_codes.codeHash` 碰撞 | **0 条** |
| 任一来源存在 `account_identities` / `account_credentials` 表 | **否**（0 张） |

**`email_otps` 存的是明文验证码，且旧库这 8 条全部过期。** 它们不得迁入新库——U4 的 `account_verification_challenges` 只存带独立 secret 的 HMAC 摘要，明文码没有任何迁移价值，只有泄露风险。导入器应显式跳过该表并在 receipt 里记录「按设计不迁移」。

`access_sessions`（旧库 5 行）同理：会话是短期凭据，切库后应让用户重新登录，不迁移。

---

## 5. 外键完整性

### 旧库 `drinking_time`

| 检查 | 悬挂条数 |
|---|---:|
| `projects.userId → users.id` | 0 |
| `stories.userId → users.id` | 0 |
| `stories.projectId → projects.id` | 0 |
| `edit_snapshots.projectId → projects.id` | 0 |
| `invite_codes.redeemedByUserId → users.id` | 0 |
| `access_sessions.userId → users.id` | 0 |

### 测试库 `drinking_time_mobile_staging`

| 检查 | 悬挂条数 |
|---|---:|
| `projects.userId → users.id` | 0 |
| `edit_snapshots.projectId → projects.id` | 0 |

**两个远端来源都没有悬挂外键。** 裁决 3 要求的「完整依赖无冲突」在远端侧成立；本地来源的外键校验需在冻结写入后随导入 dry-run 一并产出。

---

## 6. 余额与账务冲突

**零冲突，因为账务数据尚不存在。**

三个来源中都没有 `credit_accounts`、`credit_ledger_entries`、`credit_holds`、`billing_operations`、`provider_attempts`、`gift_cards`、`recharge_requests` 任何一张表（本地 JSON 里那五个键是 U6 改动后由运行中的服务写入的**空数组**）。

含义：

- 合并不会遇到「两侧余额如何相加」的问题——所有账号在新库里都从零余额开始。
- 裁决 3 的「账务无冲突后才允许合并」**当前自动成立**，但这个结论有时效：一旦新库上线并产生账本条目，再做任何账号合并都必须重新评估，因为账本是 append-only、不能靠改旧条目来搬账。
- 建议把「账号合并必须在产生任何账本条目之前完成」写成硬约束。合并两个已有消费历史的账号，要么伪造账本、要么丢失审计，两条都不可接受。

---

## 7. 一个必须在建库时处理的差异：排序规则不一致

| 数据库 | 字符集 | 排序规则 |
|---|---|---|
| `drinking_time` | utf8mb4 | **utf8mb4_unicode_ci** |
| `drinking_time_mobile_staging` | utf8mb4 | **utf8mb4_0900_ai_ci** |

跨库比较 `codeHash` 时直接触发 `ERROR 1267 Illegal mix of collations`，只能显式 `COLLATE` 才能比。

这不只是查询不便：**排序规则决定唯一索引的等价语义**。`account_identities` 的 `(provider, subject)` 唯一约束、`invite_codes.codeHash` 唯一约束在两种规则下对「哪些值算相同」的判断可能不同。新合并库必须显式指定一种规则并在建库语句里固定下来，不能依赖服务器默认值——否则同一份迁移在不同 MySQL 版本上会得到不同的唯一性行为。

现有的一次性测试库 harness（`server/integration/mysqlTestHarness.ts`）建库时已显式使用 `CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`，新合并库应保持一致。

---

## 8. 仍然阻塞导入的事项

1. 本地来源尚未冻结写入，哈希只是历史观察。
2. 裁决 3 的「保留哪一侧内容」在两侧都只有 1 个项目、0 个 Story 的情况下需要明确：是两个项目都迁入新账号，还是只保留其一。
3. 新合并库尚未创建（需要先跑完整 17 条迁移链）。
4. 导入器与验收脚本尚未编写。
