import {
  createMailboxHandoff,
  confirmMailboxHandoff,
  listNativeMailbox,
  readNativeMailbox,
  shareNativeMailbox,
} from "../repositories/storyMailboxHandoff";
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
  if (input.action === "handoff")
    result = await createMailboxHandoff(input.userId, {
      storyId: input.storyId,
      selection: input.selection,
      fingerprint: input.fingerprint,
      requestId: input.requestId,
    });
  else if (input.action === "nativeConfirm")
    result = await confirmMailboxHandoff(input.subject, input.code);
  else if (input.action === "nativeList")
    result = await listNativeMailbox(input.subject);
  else if (input.action === "nativeRead")
    result = await readNativeMailbox(input.subject, input.id, input.token);
  else if (input.action === "nativeShare")
    result = await shareNativeMailbox(input.subject, input.id, input.revoke);
  else if (input.action === "preview")
    result = await caller.preview({
      storyId: input.storyId,
      selection: input.selection,
    });
  else if (input.action === "send")
    result = await caller.send({
      storyId: input.storyId,
      contactId,
      requestId: input.requestId,
      fingerprint: input.fingerprint,
      note: input.note ?? "",
      selection: input.selection,
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
