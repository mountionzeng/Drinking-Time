import { mutateModuleImageTasks } from "../repositories/bookModuleImageTasks";
const input = JSON.parse(Buffer.from(process.argv[2]!, "base64url").toString("utf8")) as { storyId: number; userId: number; fail?: boolean };
try {
  const result = await mutateModuleImageTasks(input, async (tasks, store) => {
    const task = tasks[0]!;
    if (task.status !== "succeeded") {
      task.candidates = await store([{ imageUrl: "/api/images/same-paid-task.png", imageKey: "same-paid-task.png" }]);
      task.status = "succeeded";
      if (input.fail) throw new Error("simulated process failure before commit");
    }
    return task.candidates;
  });
  console.log("MYSQL_WORKER_RESULT:" + JSON.stringify(result));
  process.exit(0);
} catch {
  console.log("MYSQL_WORKER_RESULT:" + JSON.stringify({ failed: true }));
  process.exit(0);
}
