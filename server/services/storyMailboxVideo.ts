import { randomUUID } from "node:crypto";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { TRPCError } from "@trpc/server";
import { localVideoDir } from "./videoMedia";
import type { MailboxPackage } from "../repositories/storyMailboxPackage";
const takePattern = /^\/api\/videos\/take-(\d+)\.(mp4|webm|mov)$/;
const exportPattern = /^\/api\/videos\/export-(\d+)-(\d+)\.mp4$/;
export function mailboxVideoUrls(pkg: MailboxPackage) {
  const urls = new Set<string>();
  function walk(value: unknown) {
    if (typeof value === "string" && value.startsWith("/api/videos/"))
      urls.add(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object")
      Object.values(value).forEach(walk);
  }
  walk([pkg.body, pkg.timeline, pkg.videos, pkg.chapters, pkg.chapterVersions]);
  return [...urls];
}
function validSource(pkg: MailboxPackage, url: string, storyId: number) {
  const take = takePattern.exec(url),
    exp = exportPattern.exec(url);
  if (
    take &&
    pkg.videos.some(
      v =>
        v.id === Number(take[1]) &&
        v.videoKey === url.slice("/api/videos/".length)
    )
  )
    return;
  if (exp && Number(exp[1]) === storyId) return;
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: "故事中有不可传递的视频引用",
  });
}
export async function retainMailboxVideos(
  pkg: MailboxPackage,
  storyId: number,
  staged: string[],
  prior?: MailboxPackage
) {
  const copy = structuredClone(pkg);
  copy.videoFiles = {};
  for (const url of mailboxVideoUrls(pkg)) {
    validSource(pkg, url, storyId);
    if (prior?.videoFiles[url]) {
      copy.videoFiles[url] = prior.videoFiles[url];
      continue;
    }
    await mkdir(localVideoDir(), { recursive: true });
    const file = `mailbox-${randomUUID()}${path.extname(url)}`;
    await copyFile(
      path.join(localVideoDir(), path.basename(url)),
      path.join(localVideoDir(), file),
      constants.COPYFILE_EXCL
    );
    staged.push(file);
    copy.videoFiles[url] = file;
  }
  return copy;
}
export async function copyMailboxVideos(
  pkg: MailboxPackage,
  takes: Map<number, number>,
  storyId: number,
  staged: string[]
) {
  const urls = new Map<string, string>();
  for (const [source, retained] of Object.entries(pkg.videoFiles)) {
    if (!/^mailbox-[a-f0-9-]+\.(mp4|webm|mov)$/.test(retained))
      throw new Error("Invalid retained mailbox video");
    const take = takePattern.exec(source),
      exp = exportPattern.exec(source);
    const id = take ? takes.get(Number(take[1])) : null;
    const target =
      take && id
        ? `take-${id}.${take[2]}`
        : exp
          ? `export-${storyId}-${exp[2]}.mp4`
          : null;
    if (!target) throw new Error("Missing received video identity");
    await copyFile(
      path.join(localVideoDir(), retained),
      path.join(localVideoDir(), target),
      constants.COPYFILE_EXCL
    );
    staged.push(target);
    urls.set(source, `/api/videos/${target}`);
    urls.set(path.basename(source), target);
  }
  return urls;
}
export async function discardMailboxVideos(files: string[]) {
  await Promise.all(
    files.map(file =>
      rm(path.join(localVideoDir(), path.basename(file)), {
        force: true,
      }).catch(() => {})
    )
  );
}
