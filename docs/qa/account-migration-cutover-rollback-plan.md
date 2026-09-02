# 新合并库切换与回滚方案

适用范围：测试站 `https://test.drinkingtime.top`（`/opt/Drinking-Time-mobile-staging`，PM2 `drinking-time-mobile-staging`，`127.0.0.1:3001`）。
**正式站 `/opt/Drinking-Time`（PM2 `drinking-time`，:3000）与正式库 `drinking_time` 不在本方案范围内。**

配套：`account-migration-conflict-report.md`、`account-migration-inventory-all-sources.md`。

---

## 0. 为什么「改回 DATABASE_URL」不是回滚方案

改连接串只解决「指向哪个库」，解决不了下面四件事：

1. **切换后写入的数据会丢。** 用户在新库上创作的内容不在旧库里。直接切回去 = 静默丢掉这段时间的全部创作。这是本方案的核心问题，第 4 节专门处理。
2. **会话与凭据是跨库的。** JWT 里带 `openId` 和 `sessionVersion`，但用户行在新库里是**全新 id**（裁决 3 明确不沿用旧 id）。切回旧库后，同一张 cookie 会解析到旧库里的另一个用户行——`authenticateRequest` 按 `openId` 查，`email:mountionzeng@gmail.com` 在两个库里都存在但 id 不同。**必须在切换与回滚两个方向都撤销全部会话**，否则会出现「同一个人在两次切换后看到不同内容」。
3. **邀请码/赠送卡是一次性凭据。** 新库里领取过的卡，旧库里仍显示未领取。回滚后同一张卡可以被再领一次。
4. **本地降级路径。** `server/db.ts` 的 `getDb()` 在 `DATABASE_URL` 为空时会**静默降级到 `.webdev/local-persist.json`**。生产模式下这条路被堵住了——`server/_core/index.ts:52` 启动时调用 `assertProductionReadiness`，配置不合格进程直接抛错、起不来（PM2 会进入重启循环，是**响亮**的失败）。但这条保护**只在 `NODE_ENV=production` 下生效**；一旦有人为了排查把它改成别的值，静默降级立刻可达。**回滚过程中绝不允许临时降级 `NODE_ENV`。**

---

## 1. 切换前置（全部满足才允许切）

| # | 条件 | 验证方式 |
|---|---|---|
| 1 | 新合并库由**完整 17 条 journaled 迁移链**从零建立 | `__drizzle_migrations` 计数 = 17；`pnpm migration:verify` 通过 |
| 2 | 建库显式指定 `CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci` | `information_schema.SCHEMATA` 核对（旧库与 staging 规则不一致，见冲突报告第 7 节） |
| 3 | 三来源**冻结写入**后重新取哈希，与导入时使用的快照一致 | 冻结前后哈希相同；本地需停掉所有 dev server |
| 4 | 导入 receipt 齐全，重跑导入零新增 | `data_migration_receipts` 每来源每批次一条；第二次运行 counts 不变 |
| 5 | 逐表计数、内容哈希、owner、外键、跨账号隔离全部通过 | 验收脚本输出 |
| 6 | 新库已做**逻辑备份**，且备份能恢复到临时库并再次通过第 5 项 | 恢复演练留证据 |
| 7 | 旧库与旧 staging 已做逻辑备份并置为**只读保留** | dump 文件 + sha256 |
| 8 | `.env` 已具备 `OTP_DIGEST_SECRET`（≥32 字符、非占位） | 否则 `assertProductionReadiness` 会让进程起不来 |
| 9 | 维护窗口已约定，用户知情 | —— |

> 第 8 项是 U4 引入的新硬性前置。**在加上这个变量之前部署，测试站会直接起不来。**

---

## 2. 切换步骤

```
1. 公告 + 进入维护窗口
2. 停止写入：pm2 stop drinking-time-mobile-staging
   （nginx 保持运行，返回维护页；不要动 nginx 配置本身）
3. 重新采集三来源哈希，与导入所用快照比对 —— 任一不一致立即中止
4. 备份新库（逻辑 dump + sha256），备份当前 staging 库
5. 修改 /opt/Drinking-Time-mobile-staging/.env 的 DATABASE_URL 指向新合并库
   同时确认 OTP_DIGEST_SECRET 已存在
6. pm2 start drinking-time-mobile-staging
7. 核验：/healthz 200、/readyz 200（readyz 会实际连库）
8. 撤销全部会话：把新库 users.sessionVersion 统一 +1
   （切换方向也要做，理由见第 0 节第 2 点）
9. 真实登录 smoke：手机 + 电脑各一次，确认看到同一批内容
10. 观察窗口内不删除任何旧源
```

**每一步 mutation 前重新核验目录、PM2 应用名、端口、数据库名**，四项有一项对不上就停。

---

## 3. 回滚触发条件

出现任一条即回滚，不做「再看看」：

- `/readyz` 非 200，或 PM2 进入重启循环
- 登录失败，或登录后看到的账号不是自己的
- 任一表的计数或内容哈希与切换前记录不符
- 出现跨账号内容泄露（A 账号能读到 B 账号的 Story）
- 余额或账本出现负数、重复扣费、或与预占不一致
- 邀请码/赠送卡出现「同一张被领取两次」

---

## 4. 回滚步骤（含切换后新写入的处理）

**这是本方案最关键的部分：回滚不是把连接串改回去就完事。**

```
1. 立即 pm2 stop drinking-time-mobile-staging（先止血，防止继续写新库）
2. 对新库做一次完整逻辑 dump —— 哪怕要放弃它，也必须先留证据
   这份 dump 是「切换后新写入内容」的唯一载体，命名为 rollback-forward-writes-<时间戳>.sql
3. 判断新写入的规模：
   SELECT COUNT(*) FROM stories WHERE createdAt >= <切换时刻>;
   以及 projects / edit_snapshots / credit_ledger_entries 同理
4. 分两种情况：
   4a. 零新写入（维护窗口内失败，用户还没进来）
       → 直接把 .env 的 DATABASE_URL 改回原 staging 库，pm2 start，回到第 5 步
   4b. 有新写入
       → **不要直接切回**。切回等于丢掉这些内容。
       → 先停在维护页，把 rollback-forward-writes dump 交给岱岱，
         由岱岱决定：(i) 接受丢失并切回，(ii) 修好问题后继续留在新库，
         (iii) 把这批新写入按显式映射补回旧库。
       → 在岱岱明确选择之前，保持停机，不要自作主张选一条。
5. 切回后撤销全部会话：旧 staging 库 users.sessionVersion 统一 +1
   否则用户手里的 cookie 会解析到错误的用户行
6. 核验 /healthz、/readyz、真实登录一次
7. 邀请码/赠送卡对账：检查新库里已领取、旧库里仍未领取的卡，
   手工在旧库把它们置为过期，避免同一张卡被领第二次
8. 写事故记录：触发条件、rollback dump 路径、放弃或补回的决定、下次改什么
```

**恢复演练是切换前置第 6 项，必须在真的切换之前跑过一次**：把新库备份恢复到一个临时库，跑完整验收脚本，确认通过。没演练过的备份不算备份。

---

## 5. 观察窗口与旧源保留

- 切换后至少保留 **7 天** 观察窗口。
- 观察窗口内：旧库 `drinking_time`、旧 staging 库、本地 `.webdev/local-persist.json` 及两个 sidecar **一律只读保留，不删除、不覆盖、不清理**。
- `/root/invite-repair-20260902/inviteAccess.ts.orig` 永久保留（与本方案无关，但同属「不要顺手清理」清单）。
- 观察窗口结束、岱岱明确确认后，才讨论旧源的归档方式。

---

## 6. 已知的监控缺口

- **nginx 不对 `/readyz` 做健康门禁**（`drinking-time-mobile-staging.conf` 里零引用）。含义：进程能启动但数据库在运行中变得不可达时，nginx 仍会把流量送进来，用户看到的是请求报错而不是维护页。切换当天应人工盯 `/readyz`，或先补上健康检查再切。
- 没有自动的「计数/哈希漂移」告警。切换后的一致性只能靠人工跑验收脚本。

这两点都不阻塞切换，但要在切换当天有人盯着。
