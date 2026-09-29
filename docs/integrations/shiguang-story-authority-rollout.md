# 拾光权威故事电脑端发布与回滚

这条链路默认关闭。预览二维码、前端页面可见或云函数已部署，都不代表可以开启真实权威读写。

## 上线顺序

1. 先在电脑服务数据库应用完整 Drizzle journal；至少确认 `0024_familiar_miek` 和 `0025_dry_sunset_bain` 已执行。
2. 验证 `shiguang_story_access_bindings` 的用户/故事唯一约束、授权编号唯一约束、用户状态索引及用户外键；验证 `shiguang_bridge_nonces` 的主键和过期索引。
3. 在事务中执行一次测试绑定，并用两个独立服务实例同时领取同一个 nonce；只能有一个实例成功。清除测试数据。
4. 部署电脑服务代码，但保持 `SHIGUANG_STORY_AUTHORITY_ENABLED=false`。此时旧快照入口仍可工作，`storyAccess` 请求必须明确返回未配置且不能落库。
5. 在拾光 CloudBase 为 `storyDesktopAccess` 配置 HTTPS 路由，确认路径、超时和访问日志；不要把共享密钥放入浏览器、小程序包或仓库。
6. 在两端配置同一条至少 32 字符的强随机权威密钥和准确 HTTPS 地址，先启用电脑端 `SHIGUANG_STORY_AUTHORITY_ENABLED`，验证健康检查及配置检查通过。
7. 最后启用小程序侧的权威电脑接续生产者。使用测试故事完成短码绑定、读取、保存、版本推进、撤权和重放拒绝，再开放给真实用户。

## Go / No-Go 检查

```sql
SELECT COUNT(*) FROM __drizzle_migrations;
SHOW CREATE TABLE shiguang_story_access_bindings;
SHOW CREATE TABLE shiguang_bridge_nonces;
SELECT status, COUNT(*) FROM shiguang_story_access_bindings GROUP BY status;
SELECT COUNT(*) FROM shiguang_bridge_nonces WHERE expiresAt <= NOW();
```

必须同时满足：迁移数为 26；两张表及约束完整；过期 nonce 可被后续请求清理；未配置权威侧时不会写入绑定；同一签名请求跨实例只能成功一次。

## 回滚顺序

1. 先关闭小程序侧权威电脑接续生产者，确认不再发送 `storyAccess`。
2. 再关闭电脑端 `SHIGUANG_STORY_AUTHORITY_ENABLED`，保留旧快照入口。
3. 然后才回滚电脑服务代码。
4. `0024`、`0025` 都是向后兼容的增量表，代码回滚时保留，不删除绑定或 nonce 表。
5. 若确实必须删除绑定表，先导出全部绑定列并准备恢复或重新绑定方案；没有备份不得执行删除。

任何阶段出现桥接 503、重复 nonce 成功、跨账号绑定、保存后版本未推进或撤权后仍可读取，都判定 No-Go，并按上述反向顺序关闭开关。

## 迁移中断后的恢复

`0022_story_sound_director` 包含多条 MySQL DDL。MySQL 会分别提交这些语句，而 Drizzle 只在整份文件完成后才登记迁移记录。因此一旦中断，**不要直接再次运行迁移命令**：它可能因已经创建的表或约束而停在第一条语句。

1. 保持应用停在已知健康版本，先备份正式库和现有 `__drizzle_migrations`。
2. 记录 `SHOW TABLES`、`SHOW CREATE TABLE stories`，以及五张 `story_sound_*` / `story_voice_*` 表的 `SHOW CREATE TABLE` 输出；对照 `0022` 的表、唯一约束、外键和索引，判定执行停在哪一条。
3. 仅用经过核对的 SQL 补齐缺少的对象，或从备份恢复到迁移前；不得删除已有用户故事、账户、余额或已成功创建的声音记录来“重跑”。
4. 确认 0022 的每一条 DDL 均已生效后，受控补写/恢复 Drizzle ledger 的 0022 记录，或在临时克隆库完整演练后再执行。随后才运行 0023–0025，并复查迁移数为 26。

本次正式发布会在迁移前备份，并在锁内检查迁移数仍为 22；任何 DDL 或验证失败都停止服务切换、保留备份和现场输出，不继续重试。
