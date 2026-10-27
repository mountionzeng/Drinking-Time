import {
  recordMemoryActivity,
  listMemorySpace,
  changeMemorySpace,
  readMemoryBook,
  markMemoryBookSeen,
  trashMemoryStory,
  restoreMemoryStory,
  listTrashedMemoryStories,
} from "../repositories/memorySpace";
const input = JSON.parse(Buffer.from(process.argv[2], "base64url").toString());
try {
  if (input.testNow) Date.now = () => input.testNow;
  if (input.startAt)
    await new Promise(resolve =>
      setTimeout(resolve, Math.max(0, input.startAt - Date.now()))
    );
  const result =
    input.action === "trash"
      ? await trashMemoryStory(input.owner, input.storyId)
      : input.action === "restore"
        ? await restoreMemoryStory(input.owner, input.storyId)
        : input.action === "trashList"
          ? await listTrashedMemoryStories(input.owner)
    : input.action === "activity"
      ? await recordMemoryActivity(input.owner, input)
      : input.action === "change"
        ? await changeMemorySpace(input.owner, input.revision, input.operation)
        : input.action === "book"
          ? await readMemoryBook(input.owner, input.storyId)
          : input.action === "seen"
            ? await markMemoryBookSeen(
                input.owner,
                input.storyId,
                input.fingerprint
              )
            : await listMemorySpace(input.owner);
  console.log("MYSQL_WORKER_RESULT:" + JSON.stringify(result));
} catch (error) {
  console.log(
    "MYSQL_WORKER_RESULT:" +
      JSON.stringify({ error: (error as { code?: string }).code ?? "ERROR" })
  );
}
process.exit(0);
