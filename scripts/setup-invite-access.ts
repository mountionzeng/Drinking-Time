import mysql from "mysql2/promise";

import { ENV } from "../server/_core/env";

async function main() {
  if (!ENV.databaseUrl.trim()) {
    throw new Error("缺少 DATABASE_URL，无法创建线上邀请码表。");
  }

  const connection = await mysql.createConnection(ENV.databaseUrl);
  try {
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS invite_codes (
        id int AUTO_INCREMENT NOT NULL,
        codeHash varchar(64) NOT NULL,
        label varchar(255),
        redeemedByEmail varchar(320),
        redeemedByUserId int,
        expiresAt timestamp NULL,
        redeemedAt timestamp NULL,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT invite_codes_id PRIMARY KEY(id),
        CONSTRAINT invite_codes_code_hash_unique UNIQUE(codeHash),
        KEY invite_codes_redeemed_email_index (redeemedByEmail),
        CONSTRAINT invite_codes_redeemedByUserId_users_id_fk
          FOREIGN KEY (redeemedByUserId) REFERENCES users(id)
          ON DELETE SET NULL ON UPDATE NO ACTION
      )
    `);
    console.log("邀请码表已准备好，可以生成内测邀请码。");
  } finally {
    await connection.end();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
