/** Run from the primary checkout. Never run a second persistence writer beside dev. */
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import { execFileSync } from "node:child_process";
const args = process.argv.slice(2);
const value = (flag: string) => args[args.indexOf(flag) + 1];
const directory = path.resolve(value("--package") || ".");
const storyId = Number(value("--story-id")),
  userId = Number(value("--user-id"));
const apply = args.includes("--apply");
if (
  !args.includes("--package") ||
  !Number.isSafeInteger(storyId) ||
  storyId <= 0 ||
  !Number.isSafeInteger(userId) ||
  userId <= 0
)
  throw new Error(
    "Usage: node --import tsx scripts/migrate-chatcut-project.ts --package DIR --story-id ID --user-id ID [--apply]"
  );
const primary = execFileSync("git", ["worktree", "list", "--porcelain"], {
  encoding: "utf8",
})
  .split("\n")[0]
  .replace(/^worktree /, "");
if (path.resolve(primary) !== process.cwd())
  throw new Error("只能在主仓库迁移业务数据");
// env.ts does not override explicit variables. This CLI is local-only.
process.env.DATABASE_URL = "";
process.env.NODE_ENV = "development";
async function portInUse() {
  return new Promise<boolean>(resolve => {
    const socket = net.createConnection({ host: "127.0.0.1", port: 3000 });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", error => {
      if ((error as NodeJS.ErrnoException).code === "ECONNREFUSED")
        resolve(false);
      else throw error;
    });
  });
}
if (apply && (await portInUse()))
  throw new Error(
    "请先停止主仓3000服务，避免两个进程同时写本地数据；迁移后重启。"
  );
const { buildChatCutMigration, loadMigrationFiles, migrateChatCutProject } =
  await import("../server/services/chatCutProjectMigration");
const source = path.join(directory, "source");
const migration = buildChatCutMigration({
  xml: await readFile(path.join(source, "语音旁白生成.xml"), "utf8"),
  srt: await readFile(path.join(source, "语音旁白生成.srt"), "utf8"),
  uiLabels: JSON.parse(
    await readFile(path.join(directory, "chatcut-timeline-ui.json"), "utf8")
  ),
});
const files = await loadMigrationFiles(directory);
const { getStoryById } = await import("../server/repositories/stories");
const { getStoryTimeline } = await import("../server/repositories/timelines");
const { getStoryRevision } = await import("../server/services/storySync");
const story = await getStoryById(storyId, userId),
  timeline = await getStoryTimeline(storyId, userId);
if (!story || !timeline) throw new Error("作品不存在或无权访问");
const report = {
  storyId,
  userId,
  title: story.title,
  revision: getStoryRevision(story.body),
  timelineVersion: timeline.version,
  durationFrames: migration.plan.durationFrames,
  files: [...files.keys()],
  videoCount: migration.plan.videoTracks.flatMap(t => t.clips).length,
  audioCount: migration.plan.audioTracks.flatMap(t => t.clips).length,
  subtitles: migration.subtitles.tracks.map(t => ({
    name: t.name,
    cues: t.cues.length,
  })),
  adjustments: migration.adjustments,
  levels: migration.levels,
};
await writeFile(
  path.join(directory, "migration-plan.json"),
  JSON.stringify({ report, migration }, null, 2)
);
console.log(JSON.stringify(report, null, 2));
if (apply) {
  const backup = path.join(directory, "before-import");
  await mkdir(backup, { recursive: true });
  // Exclusive-create backups: a resumed migration never overwrites the original.
  for (const file of [
    "local-persist.json",
    "prompt-lineage-local.json",
    "edit-snapshots-local.json",
  ]) {
    try {
      await copyFile(
        path.join(process.cwd(), ".webdev", file),
        path.join(backup, file),
        1
      );
    } catch (error) {
      if (
        !["EEXIST", "ENOENT"].includes(
          (error as NodeJS.ErrnoException).code ?? ""
        )
      )
        throw error;
    }
  }
  await writeFile(
    path.join(backup, `story-${getStoryRevision(story.body)}.json`),
    JSON.stringify({ story, timeline }, null, 2)
  );
  const result = await migrateChatCutProject({
    storyId,
    userId,
    migrationId: "chatcut-launch-20261110",
    expectedRevision: getStoryRevision(story.body),
    expectedTimelineVersion: timeline.version,
    migration,
    files,
  });
  await writeFile(
    path.join(directory, "migration-result.json"),
    JSON.stringify(result, null, 2)
  );
  console.log(JSON.stringify(result, null, 2));
}
