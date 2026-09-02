import mysql from "mysql2/promise";
import { describe, expect, it } from "vitest";

import { withMysqlTestDatabase } from "./mysqlTestHarness";

const describeMysql = process.env.TEST_MYSQL_DATABASE_URL
  ? describe
  : describe.skip;

/** 微元：1 元 = 1_000_000 微元。¥30 = 30_000_000。 */
const YUAN = 1_000_000;

async function createUser(
  connection: mysql.Connection,
  openId: string,
  email: string | null = null
): Promise<number> {
  const [result] = await connection.execute<mysql.ResultSetHeader>(
    "INSERT INTO `users` (`openId`, `email`, `loginMethod`) VALUES (?, ?, 'email')",
    [openId, email]
  );
  return result.insertId;
}

async function expectDuplicateRejected(run: () => Promise<unknown>) {
  await expect(run()).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });
}

describeMysql("统一账号与算力账本 schema（真实 MySQL）", () => {
  it("同一邮箱身份只能解析到一个用户，微信 provider 是独立命名空间", async () => {
    await withMysqlTestDatabase(async database => {
      const connection = await mysql.createConnection(database.databaseUrl);
      try {
        const first = await createUser(connection, "email:one", "a@example.com");
        const second = await createUser(connection, "email:two", "b@example.com");

        await connection.execute(
          "INSERT INTO `account_identities` (`userId`, `provider`, `subject`) VALUES (?, 'email', ?)",
          [first, "a@example.com"]
        );
        // 第二个用户抢同一个标准化邮箱：必须被唯一约束挡下，而不是静默 merge
        await expectDuplicateRejected(() =>
          connection.execute(
            "INSERT INTO `account_identities` (`userId`, `provider`, `subject`) VALUES (?, 'email', ?)",
            [second, "a@example.com"]
          )
        );
        // 同一个字符串在 wechat provider 下是另一条身份，为第二阶段留边界
        await connection.execute(
          "INSERT INTO `account_identities` (`userId`, `provider`, `subject`) VALUES (?, 'wechat', ?)",
          [second, "a@example.com"]
        );
        // 同一用户可以同时持有多条身份
        await connection.execute(
          "INSERT INTO `account_identities` (`userId`, `provider`, `subject`) VALUES (?, 'wechat', ?)",
          [first, "wx-openid-1"]
        );

        const [rows] = await connection.query<mysql.RowDataPacket[]>(
          "SELECT COUNT(*) AS count FROM `account_identities`"
        );
        expect(Number(rows[0].count)).toBe(3);
      } finally {
        await connection.end();
      }
    });
  }, 120_000);

  it("每个用户每种凭据只有一条，且新用户 sessionVersion 默认为 1", async () => {
    await withMysqlTestDatabase(async database => {
      const connection = await mysql.createConnection(database.databaseUrl);
      try {
        const userId = await createUser(connection, "email:pw");

        const [userRows] = await connection.query<mysql.RowDataPacket[]>(
          "SELECT `sessionVersion` FROM `users` WHERE `id` = ?",
          [userId]
        );
        expect(Number(userRows[0].sessionVersion)).toBe(1);

        await connection.execute(
          "INSERT INTO `account_credentials` (`userId`, `kind`, `secret`) VALUES (?, 'password', 'scrypt$v1$…')",
          [userId]
        );
        await expectDuplicateRejected(() =>
          connection.execute(
            "INSERT INTO `account_credentials` (`userId`, `kind`, `secret`) VALUES (?, 'password', 'scrypt$v1$other')",
            [userId]
          )
        );
      } finally {
        await connection.end();
      }
    });
  }, 120_000);

  it("业务幂等键：同一 operationId 只能有一条 operation 和一个 hold", async () => {
    await withMysqlTestDatabase(async database => {
      const connection = await mysql.createConnection(database.databaseUrl);
      try {
        const userId = await createUser(connection, "email:ops");
        const operationId = "op-image-001";

        await connection.execute(
          "INSERT INTO `billing_operations` (`userId`, `operationId`, `operationType`, `requestHash`, `maxCostMinor`) VALUES (?, ?, 'image.generate', 'hash-a', ?)",
          [userId, operationId, 2 * YUAN]
        );
        // 同 id 不同参数必须冲突，不能覆盖原状态
        await expectDuplicateRejected(() =>
          connection.execute(
            "INSERT INTO `billing_operations` (`userId`, `operationId`, `operationType`, `requestHash`, `maxCostMinor`) VALUES (?, ?, 'image.generate', 'hash-b', ?)",
            [userId, operationId, 9 * YUAN]
          )
        );

        await connection.execute(
          "INSERT INTO `credit_holds` (`userId`, `operationId`, `amountMinor`) VALUES (?, ?, ?)",
          [userId, operationId, 2 * YUAN]
        );
        await expectDuplicateRejected(() =>
          connection.execute(
            "INSERT INTO `credit_holds` (`userId`, `operationId`, `amountMinor`) VALUES (?, ?, ?)",
            [userId, operationId, 2 * YUAN]
          )
        );
      } finally {
        await connection.end();
      }
    });
  }, 120_000);

  it("账本幂等键唯一，但不带幂等键的调整可以有多条", async () => {
    await withMysqlTestDatabase(async database => {
      const connection = await mysql.createConnection(database.databaseUrl);
      try {
        const userId = await createUser(connection, "email:ledger");

        await connection.execute(
          "INSERT INTO `credit_ledger_entries` (`userId`, `entryType`, `amountMinor`, `idempotencyKey`) VALUES (?, 'gift', ?, 'gift:first-card')",
          [userId, 30 * YUAN]
        );
        // 重复迁移/重复领卡必须被挡下，不重复赠送
        await expectDuplicateRejected(() =>
          connection.execute(
            "INSERT INTO `credit_ledger_entries` (`userId`, `entryType`, `amountMinor`, `idempotencyKey`) VALUES (?, 'gift', ?, 'gift:first-card')",
            [userId, 30 * YUAN]
          )
        );

        for (const reason of ["人工补偿一", "人工补偿二"]) {
          await connection.execute(
            "INSERT INTO `credit_ledger_entries` (`userId`, `entryType`, `amountMinor`, `reason`) VALUES (?, 'adjustment', ?, ?)",
            [userId, 1 * YUAN, reason]
          );
        }

        const [rows] = await connection.query<mysql.RowDataPacket[]>(
          "SELECT COUNT(*) AS count FROM `credit_ledger_entries` WHERE `userId` = ?",
          [userId]
        );
        expect(Number(rows[0].count)).toBe(3);
      } finally {
        await connection.end();
      }
    });
  }, 120_000);

  it("同一账号最多一个待处理续充申请，终态申请不占名额", async () => {
    await withMysqlTestDatabase(async database => {
      const connection = await mysql.createConnection(database.databaseUrl);
      try {
        const userId = await createUser(connection, "email:recharge");
        const other = await createUser(connection, "email:recharge-2");

        await connection.execute(
          "INSERT INTO `recharge_requests` (`userId`, `requestedAmountMinor`, `status`, `pendingSlot`) VALUES (?, ?, 'pending', 'pending')",
          [userId, 20 * YUAN]
        );
        await expectDuplicateRejected(() =>
          connection.execute(
            "INSERT INTO `recharge_requests` (`userId`, `requestedAmountMinor`, `status`, `pendingSlot`) VALUES (?, ?, 'pending', 'pending')",
            [userId, 50 * YUAN]
          )
        );
        // 另一个账号不受影响
        await connection.execute(
          "INSERT INTO `recharge_requests` (`userId`, `requestedAmountMinor`, `status`, `pendingSlot`) VALUES (?, ?, 'pending', 'pending')",
          [other, 20 * YUAN]
        );

        // 审批完成后释放名额，历史记录仍然留存
        await connection.execute(
          "UPDATE `recharge_requests` SET `status` = 'approved', `pendingSlot` = NULL, `approvedAmountMinor` = ?, `decidedAt` = NOW() WHERE `userId` = ? AND `status` = 'pending'",
          [10 * YUAN, userId]
        );
        await connection.execute(
          "INSERT INTO `recharge_requests` (`userId`, `requestedAmountMinor`, `status`, `pendingSlot`) VALUES (?, ?, 'pending', 'pending')",
          [userId, 30 * YUAN]
        );

        const [rows] = await connection.query<mysql.RowDataPacket[]>(
          "SELECT COUNT(*) AS count FROM `recharge_requests` WHERE `userId` = ?",
          [userId]
        );
        expect(Number(rows[0].count)).toBe(2);
      } finally {
        await connection.end();
      }
    });
  }, 120_000);

  it("同一供应商 task id 不能登记两次，未提交的尝试可以有多条", async () => {
    await withMysqlTestDatabase(async database => {
      const connection = await mysql.createConnection(database.databaseUrl);
      try {
        const userId = await createUser(connection, "email:attempts");
        const [operation] = await connection.execute<mysql.ResultSetHeader>(
          "INSERT INTO `billing_operations` (`userId`, `operationId`, `operationType`, `requestHash`, `maxCostMinor`) VALUES (?, 'op-video-001', 'video.generate', 'hash', ?)",
          [userId, 12 * YUAN]
        );
        const operationRowId = operation.insertId;

        await connection.execute(
          "INSERT INTO `provider_attempts` (`billingOperationId`, `attemptIndex`, `provider`, `providerTaskId`, `status`) VALUES (?, 1, 'seedance', 'task-abc', 'submitted')",
          [operationRowId]
        );
        // 同一次尝试不能重复登记
        await expectDuplicateRejected(() =>
          connection.execute(
            "INSERT INTO `provider_attempts` (`billingOperationId`, `attemptIndex`, `provider`, `providerTaskId`, `status`) VALUES (?, 1, 'seedance', 'task-def', 'submitted')",
            [operationRowId]
          )
        );
        // 同一个供应商 task id 也不能出现在第二条尝试上，否则会被重复计费
        await expectDuplicateRejected(() =>
          connection.execute(
            "INSERT INTO `provider_attempts` (`billingOperationId`, `attemptIndex`, `provider`, `providerTaskId`, `status`) VALUES (?, 2, 'seedance', 'task-abc', 'submitted')",
            [operationRowId]
          )
        );
        // 还没拿到 task id 的尝试（含 submission_unknown）可以并存
        await connection.execute(
          "INSERT INTO `provider_attempts` (`billingOperationId`, `attemptIndex`, `provider`, `status`) VALUES (?, 2, 'seedance', 'submission_unknown')",
          [operationRowId]
        );
        await connection.execute(
          "INSERT INTO `provider_attempts` (`billingOperationId`, `attemptIndex`, `provider`, `status`) VALUES (?, 3, 'seedance', 'prepared')",
          [operationRowId]
        );
      } finally {
        await connection.end();
      }
    });
  }, 120_000);

  it("一张旧邀请码最多转换出一张赠送卡，未转换的卡不占名额", async () => {
    await withMysqlTestDatabase(async database => {
      const connection = await mysql.createConnection(database.databaseUrl);
      try {
        const [invite] = await connection.execute<mysql.ResultSetHeader>(
          "INSERT INTO `invite_codes` (`codeHash`, `label`) VALUES ('legacy-invite-hash', '旧邀请')"
        );
        const inviteId = invite.insertId;

        await connection.execute(
          "INSERT INTO `gift_cards` (`codeHash`, `amountMinor`, `legacyInviteCodeId`) VALUES ('hash-1', ?, ?)",
          [30 * YUAN, inviteId]
        );
        // 重复迁移同一张旧邀请：零重复赠送
        await expectDuplicateRejected(() =>
          connection.execute(
            "INSERT INTO `gift_cards` (`codeHash`, `amountMinor`, `legacyInviteCodeId`) VALUES ('hash-2', ?, ?)",
            [30 * YUAN, inviteId]
          )
        );
        // 全新签发的卡没有来源，可以有任意多张
        await connection.execute(
          "INSERT INTO `gift_cards` (`codeHash`, `amountMinor`) VALUES ('hash-3', ?)",
          [30 * YUAN]
        );
        await connection.execute(
          "INSERT INTO `gift_cards` (`codeHash`, `amountMinor`) VALUES ('hash-4', ?)",
          [30 * YUAN]
        );
      } finally {
        await connection.end();
      }
    });
  }, 120_000);

  it("金额用 bigint 存微元，超过 int 上限也不截断", async () => {
    await withMysqlTestDatabase(async database => {
      const connection = await mysql.createConnection(database.databaseUrl);
      try {
        const userId = await createUser(connection, "email:bigint");
        // 5000 元 = 5_000_000_000 微元，远超 int 的 2^31−1
        const amount = 5_000 * YUAN;
        expect(amount).toBeGreaterThan(2_147_483_647);

        await connection.execute(
          "INSERT INTO `credit_accounts` (`userId`, `balanceMinor`, `lifetimeSpentMinor`) VALUES (?, ?, ?)",
          [userId, amount, amount]
        );
        const [rows] = await connection.query<mysql.RowDataPacket[]>(
          "SELECT `balanceMinor`, `reservedMinor`, `lifetimeSpentMinor` FROM `credit_accounts` WHERE `userId` = ?",
          [userId]
        );
        expect(Number(rows[0].balanceMinor)).toBe(amount);
        expect(Number(rows[0].lifetimeSpentMinor)).toBe(amount);
        expect(Number(rows[0].reservedMinor)).toBe(0);

        // 每个用户只有一行余额投影——它是被锁的那一行
        await expectDuplicateRejected(() =>
          connection.execute(
            "INSERT INTO `credit_accounts` (`userId`) VALUES (?)",
            [userId]
          )
        );
      } finally {
        await connection.end();
      }
    });
  }, 120_000);

  it("同一来源同一批次的导入 receipt 只能有一条", async () => {
    await withMysqlTestDatabase(async database => {
      const connection = await mysql.createConnection(database.databaseUrl);
      try {
        await connection.execute(
          "INSERT INTO `data_migration_receipts` (`sourceKey`, `batchKey`, `sourceHash`, `recordCount`) VALUES ('legacy_mysql', 'users', 'hash-1', 4)"
        );
        await expectDuplicateRejected(() =>
          connection.execute(
            "INSERT INTO `data_migration_receipts` (`sourceKey`, `batchKey`, `sourceHash`, `recordCount`) VALUES ('legacy_mysql', 'users', 'hash-2', 4)"
          )
        );
        // 不同来源的同名批次互不影响
        await connection.execute(
          "INSERT INTO `data_migration_receipts` (`sourceKey`, `batchKey`, `sourceHash`, `recordCount`) VALUES ('local_persist', 'users', 'hash-3', 63)"
        );
      } finally {
        await connection.end();
      }
    });
  }, 120_000);
});
