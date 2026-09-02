# 账号迁移只读盘点：三来源汇总

生成时间：2026-09-02T14:15:22.426Z

> 全部通过 `START TRANSACTION READ ONLY` 的 SELECT 采集，未导入、未映射、未改库。
> 本报告**不包含任何自动归属建议**；映射必须由人给出。

## 每来源计数

| 来源 | 已登记迁移 | users | projects | stories | edit_snapshots | invite_codes |
|---|---:|---:|---:|---:|---:|---:|
| `legacy_mysql` | 4 | 4 | 5 | 1 | 29 | 5 |
| `staging_mysql` | 7 | 1 | 1 | 0 | 1 | 2 |
| `local_persist` | — | 63 | 18 | 35 | — | 0 |

## 跨来源邮箱索引

- 出现过的邮箱：3 个
- **单来源内同邮箱多账号（真冲突）：0 个**
- 跨来源出现同一邮箱（映射候选）：1 个

| 邮箱 | 出现位置 | 单来源冲突 |
|---|---|---|
| `1132252560@qq.com` | legacy_mysql#1095 | 否 |
| `947571049@qq.com` | legacy_mysql#1103 | 否 |
| `mountionzeng@gmail.com` | legacy_mysql#1；staging_mysql#1 | 否 |

## 拼写相近的邮箱（同域名，编辑距离 ≤ 2）

**无。** 三个来源里都不存在拼写相近的邮箱对。

特别说明：交接文档提到的 `mountainzeng@gmail.com` **不存在于任何数据源**——它只出现在一张截图里。
因此不存在需要裁决的近似邮箱合并。

## 需要人工映射的账号（持有内容但无法用邮箱证明归属）

| 来源 | user id | 名称 | 项目 | Story | 为什么不能自动决定 |
|---|---:|---|---:|---:|---|
| `legacy_mysql` | 11 | 历史待认领 | 2 | 1 | 没有邮箱：无法证明它属于谁。持有的内容必须由人给出显式映射才能归属。 |
| `local_persist` | 48 | Guest | 18 | 35 | 没有邮箱：无法证明它属于谁。持有的内容必须由人给出显式映射才能归属。 |

## 各来源内容归属一览

### `legacy_mysql`

| user id | 名称 | 邮箱 | 项目 | Story |
|---:|---|---|---:|---:|
| 11 | 历史待认领 | **无** | 2 | 1 |
| 1 | — | mountionzeng@gmail.com | 1 | 0 |
| 1095 | — | 1132252560@qq.com | 1 | 0 |
| 1103 | — | 947571049@qq.com | 1 | 0 |

### `staging_mysql`

| user id | 名称 | 邮箱 | 项目 | Story |
|---:|---|---|---:|---:|
| 1 | — | mountionzeng@gmail.com | 1 | 0 |

### `local_persist`

| user id | 名称 | 邮箱 | 项目 | Story |
|---:|---|---|---:|---:|
| 48 | Guest | **无** | 18 | 35 |

## 需要岱岱裁决的问题

1. 旧库 user 11（`legacy:unclaimed`，名称「历史待认领」，无邮箱）持有 2 个项目、1 个 Story、18 个 edit snapshot。归给谁，还是保持独立？
2. 本地 Guest 48（无邮箱）持有 18 个项目、35 个 Story。归给谁，还是保持独立？
3. `mountionzeng@gmail.com` 在旧库（user 1）和 staging（user 1）各有一个账号，是同一个人的两条记录。合并方向与保留哪一侧的 id？
4. 旧库另外两个邮箱账号（`1132252560@qq.com`、`947571049@qq.com`）各持 1 个项目，是否一并迁入新合并库？

在上述四点得到明确答复之前，导入器不会写入任何归属；`ACCOUNT_AUTO_IDENTITY_RESOLUTION` 保持 `false`。
