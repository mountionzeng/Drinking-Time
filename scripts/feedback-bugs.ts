import "dotenv/config";
import mysql from "mysql2/promise";

// Deliberately no local-storage or DATABASE_URL fallback: an unavailable
// production queue must never be mistaken for an empty queue.
const url = process.env.FEEDBACK_DATABASE_URL;
if (!url) {
  console.error("未配置生产只读 FEEDBACK_DATABASE_URL，无法检查线上反馈。");
  process.exitCode = 1;
} else {
  let connection: mysql.Connection | undefined;
  try {
    connection = await mysql.createConnection(url);
    await connection.query("SET TRANSACTION READ ONLY");
    await connection.beginTransaction();
    const [rows] = await connection.query(
      "SELECT id, title, content, tags, page, status, reply, createdAt, updatedAt FROM feedback_posts WHERE category = 'bug' AND status IN ('open', 'reviewing') ORDER BY createdAt ASC, id ASC"
    );
    await connection.commit();
    console.log(
      JSON.stringify(
        { source: "configured-production-feedback", posts: rows },
        null,
        2
      )
    );
  } catch {
    console.error(
      "线上反馈读取失败：请检查只读连接配置及反馈表迁移；本次不能判断是否有新反馈。"
    );
    process.exitCode = 1;
  } finally {
    await connection?.end();
  }
}
