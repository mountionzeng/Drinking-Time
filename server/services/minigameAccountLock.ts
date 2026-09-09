import mysql from 'mysql2/promise';

/** Shared across PM2 workers. Linking cannot race an already-authorized game write.
 * A dedicated short-lived connection avoids exhausting the business query pool with
 * waiting lock holders. Closing it also releases the lock on any error path. */
export async function withMinigameAccountLock<T>(userId: number, work: () => Promise<T>): Promise<T> {
  const uri = process.env.DATABASE_URL;
  if (!uri) throw new Error('database_required');
  const connection = await mysql.createConnection(uri);
  try {
    const [rows] = await connection.execute<mysql.RowDataPacket[]>(
      "SELECT GET_LOCK(SHA2(CONCAT(DATABASE(), ':minigame-account:', ?), 256), 2) AS acquired", [userId]);
    if (rows[0]?.acquired !== 1)
      throw new Error('account_busy');
    return await work();
  } finally { await connection.end(); }
}
