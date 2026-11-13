import { storyMailboxRouter } from "../routers/storyMailbox";
import { mailboxContactId } from "../repositories/storyMailbox";
import type { TrpcContext } from "../_core/context";
const input = JSON.parse(Buffer.from(process.argv[2], "base64url").toString());
const caller = storyMailboxRouter.createCaller({
  user: { id: input.userId, name: "Test" },
  req: {},
  res: {},
} as TrpcContext);
try {
  if (input.startAt)
    await new Promise(r =>
      setTimeout(r, Math.max(0, input.startAt - Date.now()))
    );
  let result: unknown;
  const contactId = mailboxContactId(input.userId, input.peerId);
  if (input.action === "preview")
    result = await caller.preview({ storyId: input.storyId });
  else if (input.action === "send")
    result = await caller.send({
      storyId: input.storyId,
      contactId,
      requestId: input.requestId,
      fingerprint: input.fingerprint,
      note: input.note ?? "",
    });
  else if (input.action === "receive")
    result = await caller.receive({ entryId: input.entryId });
  else if (input.action === "refresh")
    result = await caller.refresh({ threadId: input.threadId });
  else if (input.action === "remove")
    result = await caller.removeContact({ contactId });
  else result = await caller.history({ contactId });
  console.log("MYSQL_WORKER_RESULT:" + JSON.stringify(result));
} catch (e) {
  console.log(
    "MYSQL_WORKER_RESULT:" +
      JSON.stringify({
        error: (e as { code?: string }).code ?? String(e),
        message: (e as Error).message,
      })
  );
}
process.exit(0);
