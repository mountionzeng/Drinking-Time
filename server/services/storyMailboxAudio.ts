import { copyFile, chmod, rm } from "node:fs/promises";
import { constants } from "node:fs";
import {
  ensureManagedAudioDirs,
  mintAudioStorageKey,
  resolveManagedAudioPath,
} from "./audioMedia";
import type { MailboxPackage } from "../repositories/storyMailboxPackage";
/** Envelopes own retained bytes. Deleting a sender's story cannot break an unopened letter. */
export async function retainMailboxAudio(
  pkg: MailboxPackage,
  staged: string[],
  prior?: MailboxPackage
) {
  const copy = structuredClone(pkg);
  if (copy.audio.length) await ensureManagedAudioDirs();
  for (const asset of copy.audio) {
    const retained = prior?.audio.find(
      a => a.id === asset.id && a.checksum && a.checksum === asset.checksum
    );
    if (retained) {
      asset.storageKey = retained.storageKey;
      continue;
    }
    const key = mintAudioStorageKey();
    await copyFile(
      resolveManagedAudioPath(asset.storageKey),
      resolveManagedAudioPath(key),
      constants.COPYFILE_EXCL
    );
    staged.push(key);
    await chmod(resolveManagedAudioPath(key), 0o600);
    asset.storageKey = key;
  }
  return copy;
}
export async function discardMailboxAudio(keys: string[]) {
  await Promise.all(
    keys.map(key =>
      rm(resolveManagedAudioPath(key), { force: true }).catch(() => {})
    )
  );
}
