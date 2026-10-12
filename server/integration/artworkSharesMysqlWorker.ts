import { saveArtworkShare, readArtworkShare, revokeArtworkShares } from "../repositories/artworkShares";

const input = JSON.parse(Buffer.from(process.argv[2], "base64url").toString());
try {
  if (input.startAt) await new Promise(resolve => setTimeout(resolve, Math.max(0, input.startAt - Date.now())));
  let result: unknown = { ok: true };
  if (input.action === "save") await saveArtworkShare({
    tokenHash: input.tokenHash, fingerprint: input.fingerprint ?? "f".repeat(64),
    userId: input.userId, storyId: input.storyId, createdAt: new Date(), revokedAt: null,
    snapshot: { title: "分享验收 🌿", author: { name: "测试作者" }, pages: [{ dataUrl: "data:image/webp;base64,AAAA", width: 1, height: 1 }] },
  });
  else if (input.action === "read") result = await readArtworkShare(input.tokenHash);
  else if (input.action === "revoke") await revokeArtworkShares(input.userId, input.storyId);
  else throw new Error("Unknown action");
  console.log(`MYSQL_WORKER_RESULT:${JSON.stringify(result)}`);
  process.exit(0);
} catch (error) {
  console.log(`MYSQL_WORKER_RESULT:${JSON.stringify({ error: (error as { code?: string }).code ?? String(error) })}`);
  process.exit(0);
}
