# prod storyId 回填手册（阿里云 ECS）

> 故事为唯一单位后，新代码按 `storyId` 取镜头和图片。prod 的 MySQL 存量数据 `storyId` 全是
> null（migration 只加了列），**不回填的话上线后线上镜头表和图片会是空的**。本手册在 ECS 上执行。
>
> ⚠️ 这是碰真实数据、难回退的操作。严格按顺序，dry-run 看清楚再 --write。

## 前提

- 在阿里云 ECS 服务器上、应用目录内（MySQL 在本机 `localhost:3306`，只有这台机器连得上）。
- 已部署含本次改动的代码（schema 有 `shots.storyId` / `generated_images.storyId` 列，迁移 `drizzle/0004_*` 已 apply）。

## 步骤

### 1. 先备份（必做，可回退的唯一保险）

```bash
bash scripts/backup-mysql.sh
```

### 2. 应用 schema 迁移（如果还没 apply）

```bash
DATABASE_URL="mysql://drinking:***@localhost:3306/drinking_time" npm run db:push
```

确认 `shots` 和 `generated_images` 都有 `storyId` 列。

### 3. dry-run 看回填计划（不写任何东西）

```bash
DATABASE_URL="mysql://drinking:***@localhost:3306/drinking_time" \
  npx tsx scripts/backfill-storyid-mysql.ts
```

报告会逐项目列出：每个项目的镜头数、候选故事及其 body.shots 数量、拟归属故事、以及**歧义标注**。
逐项核对——尤其标了"⚠️ 歧义，需裁决"的项目，那是数量并列、脚本不敢自动归的。

### 4. 裁决歧义项目（如有）后落盘

对每个歧义项目，确定它该归哪个故事，用 `--override 项目ID:故事ID`：

```bash
DATABASE_URL="mysql://drinking:***@localhost:3306/drinking_time" \
  npx tsx scripts/backfill-storyid-mysql.ts --write --override 3:17 --override 5:21
```

- 没有歧义就直接 `--write`，无需 --override。
- **只要还有任何歧义项目没被 --override，脚本会拒绝落盘**（防瞎归）。
- 回填只动 `storyId IS NULL` 的行（幂等：重跑不改写已归属的）。
- userId 不一致或故事不存在的行会被跳过、不跨用户污染。

### 5. 验证

```sql
-- 残留未归属（ART-* 候选、孤儿镜头可能正常残留，看数量是否合理）
SELECT count(*) FROM shots WHERE storyId IS NULL;
SELECT count(*) FROM generated_images WHERE storyId IS NULL;
-- 抽查某故事的镜头/图片是否归位
SELECT id, shotNo, storyId FROM shots WHERE storyId = <某故事id>;
```

然后在线上打开一个故事，确认镜头表和图片正常显示、故事间不串。

## 回填逻辑（与 dev 一致）

- 「项目→故事」映射：一个项目的全部 shots 和 generated_images 归到该项目**body.shots 数量最接近**的故事，数量并列则标歧义、需 --override 人工裁决。
- 不用 shotNo 精确匹配（编号体系 "SH01" 字符串 vs 数字不兼容）。
- 纯归属逻辑与 `scripts/backfill-shot-storyid.ts` 共用，已有单测覆盖。

## 出问题怎么办

- 回填归错了：从第 1 步的 `backups/` 用 `mysql < 备份.sql` 还原，重来。
- 上线后镜头/图片空：多半是这步没跑或没跑完，按本手册补跑。
