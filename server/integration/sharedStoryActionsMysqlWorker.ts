import { contributeSharedStory, forkSharedStory } from "../repositories/sharedStoryActions";
import { revokeArtworkShares } from "../repositories/artworkShares";
import { revokeStoryContextShares } from "../repositories/storyContextShares";
const input = JSON.parse(Buffer.from(process.argv[2], "base64url").toString());
try {
  if (input.startAt) await new Promise(resolve => setTimeout(resolve, Math.max(0, input.startAt - Date.now())));
  let result: unknown;
  if (input.action === "fork") result = { storyId: await forkSharedStory(input.kind, input.tokenHash, input.userId) };
  else if (input.action === "revoke") {
    if (input.kind === "story") await revokeStoryContextShares(input.storyId, input.ownerId);
    else await revokeArtworkShares(input.ownerId, input.storyId);
    result = { ok: true };
  } else result = await contributeSharedStory(input.kind, input.tokenHash, { userId: input.userId, authorName: "朋友", operationToken: input.operationToken, content: { title: "作品", body: input.body ?? "协作的新文字", tags: [] } });
  console.log("MYSQL_WORKER_RESULT:" + JSON.stringify(result));
} catch (error) {
  console.log("MYSQL_WORKER_RESULT:" + JSON.stringify({ error: (error as { code?: string }).code ?? String(error) }));
}
process.exit(0);
