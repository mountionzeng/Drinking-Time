import type { StoryMailboxHandoff } from "../../drizzle/schema";
import { normalizePublishingDraftState } from "../../shared/publishingDraft";
import { chapterMediaUrl, isChapterMediaKey } from "../chapterMediaStore";
import { handoffMac } from "../repositories/storyMailboxHandoff";
import { mailboxRecord } from "../repositories/storyMailboxPackage";

const rows = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.map(mailboxRecord) : [];
export function mailboxPublicOrigin() {
  const u = new URL(
    process.env.WECHAT_MAILBOX_PUBLIC_ORIGIN || "https://www.drinkingtime.top"
  );
  if (u.protocol !== "https:" || u.username || u.password || u.pathname !== "/")
    throw new Error("mailbox_origin_invalid");
  return u.origin;
}
function safeUrl(value: unknown) {
  if (typeof value !== "string") return undefined;
  try {
    const u = new URL(value, mailboxPublicOrigin());
    return u.protocol === "https:" && !u.username && !u.password
      ? u.toString()
      : undefined;
  } catch {
    return undefined;
  }
}
export function nativeMailboxMedia(row: StoryMailboxHandoff) {
  const pkg = row.snapshot;
  return [
    ...pkg.videos.map(v => ({
      kind: "video" as const,
      label: `#${v.id}`,
      url: v.videoUrl || "",
      file: pkg.videoFiles[v.videoUrl || ""],
    })),
    ...rows(mailboxRecord(pkg.body.videoWorkflow).versions).flatMap(v =>
      rows(v.exports)
        .filter(e => e.status === "ready")
        .map(e => ({
          kind: "video" as const,
          label: String(v.name || pkg.title),
          url: String(e.videoUrl || ""),
          file: pkg.videoFiles[String(e.videoUrl)],
        }))
    ),
    ...pkg.audio.map(a => ({
      kind: "audio" as const,
      label: a.displayName,
      url: "",
      file: a.storageKey,
      format: a.formatName,
    })),
  ];
}
export function nativeMailboxDocument(row: StoryMailboxHandoff, mine: boolean) {
  const pkg = row.snapshot,
    p = normalizePublishingDraftState(pkg.body.publishing);
  const chapters = pkg.chapters
    .filter(
      c =>
        !c.blocks.manuscriptArchived &&
        (c.blocks.manuscriptKind ?? "text") === "text"
    )
    .map(c => ({ title: c.title, text: c.blocks.body }));
  if (!chapters.length && p.drafts[p.activePlatform]?.content.body)
    chapters.push({
      title: pkg.title,
      text: p.drafts[p.activePlatform]!.content.body,
    });
  const images = [
    ...pkg.images.map(i => safeUrl(i.imageUrl)),
    ...pkg.chapters.flatMap(c =>
      c.blocks.illustrations.map(i =>
        isChapterMediaKey(i.key) ? safeUrl(chapterMediaUrl(i.key)) : undefined
      )
    ),
  ].filter((v): v is string => Boolean(v));
  const expires = Date.now() + 20 * 60 * 1000;
  const media = nativeMailboxMedia(row).flatMap((m, index) => {
    const url = m.file
      ? `${mailboxPublicOrigin()}/api/mailbox-native-media/${row.id}/${index}?e=${expires}&token=${handoffMac(`media:${row.id}:${index}:${expires}:${row.shareHash ?? "private"}`)}`
      : safeUrl(m.url);
    return url ? [{ kind: m.kind, label: m.label, url }] : [];
  });
  return {
    id: row.id,
    title: pkg.title,
    mine,
    chapters,
    images,
    media,
    shared: Boolean(row.shareHash),
    createdAt: row.createdAt.toISOString(),
  };
}
