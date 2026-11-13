import { TRPCError } from "@trpc/server";
import { chapterPackageLines } from "../../shared/chapterPackage";
import {
  emptyPublishingDraftState,
  normalizePublishingDraftState,
  upsertPublishingPlatformDraft,
} from "../../shared/publishingDraft";
import type {
  MailboxPart,
  MailboxSelection,
} from "../../shared/storyMailboxSelection";
import {
  mailboxDigest,
  mailboxRecord,
  type MailboxPackage,
} from "./storyMailboxPackage";

const items = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.map(mailboxRecord) : [];
const liveChapters = (pkg: MailboxPackage) =>
  pkg.chapters.filter(
    c =>
      !c.blocks.manuscriptArchived &&
      (c.blocks.manuscriptKind ?? "text") === "text"
  );
const paragraphKey = (id: number, block: string) => `paragraph:${id}:${block}`;
function lineBindings(c: MailboxPackage["chapters"][number]) {
  const lines = chapterPackageLines(c.blocks.body);
  return lines.map((text, index) => {
    const id = c.blocks.blockIds[index];
    return {
      text,
      id:
        id && c.blocks.blockIds.filter(k => k === id).length === 1
          ? id
          : `legacy-${mailboxDigest(text)}`,
    };
  });
}
const illustrationKey = (id: number, key: string) =>
  `illustration:${id}:${mailboxDigest(key)}`;
const exportKey = (version: unknown, id: unknown) =>
  `export:${mailboxDigest([version, id])}`;

export function mailboxParts(pkg: MailboxPackage): MailboxPart[] {
  const out: MailboxPart[] = [];
  const chapters = liveChapters(pkg);
  for (const c of chapters) {
    for (const line of lineBindings(c))
      out.push({
        key: paragraphKey(c.id, line.id),
        kind: "text",
        group: c.title,
        label: line.text,
      });
    for (const illustration of c.blocks.illustrations)
      out.push({
        key: illustrationKey(c.id, illustration.key),
        kind: "image",
        group: c.title,
        label: illustration.caption || c.title,
      });
  }
  if (!chapters.length) {
    const p = normalizePublishingDraftState(pkg.body.publishing);
    for (const line of chapterPackageLines(
      p.drafts[p.activePlatform]?.content.body ?? ""
    ))
      out.push({
        key: `legacy:${mailboxDigest(line)}`,
        kind: "text",
        group: pkg.title,
        label: line,
      });
  }
  for (const image of pkg.images)
    out.push({
      key: `image:${image.id}`,
      kind: "image",
      group: image.shotNo || pkg.title,
      label: `#${image.id}`,
    });
  for (const video of pkg.videos)
    out.push({
      key: `video:${video.id}`,
      kind: "video",
      group: video.stableShotId || pkg.title,
      label: `#${video.id}`,
    });
  for (const audio of pkg.audio)
    out.push({
      key: `audio:${audio.id}`,
      kind: "audio",
      group: pkg.title,
      label: audio.displayName || `#${audio.id}`,
    });
  for (const v of items(mailboxRecord(pkg.body.videoWorkflow).versions))
    for (const e of items(v.exports))
      if (e.status === "ready" && e.videoUrl)
        out.push({
          key: exportKey(v.id, e.id),
          kind: "video",
          group: String(v.name || pkg.title),
          label: String(e.id),
        });
  return [...new Map(out.map(p => [p.key, p])).values()];
}

/** Rebuild from an allowlist. Never filter a whole-story body/history in place. */
export function selectMailboxPackage(
  pkg: MailboxPackage,
  selection?: MailboxSelection,
  strict = true
): MailboxPackage {
  if (!selection) return pkg;
  const available = new Set(mailboxParts(pkg).map(p => p.key));
  const keys = [...new Set(selection.keys)].sort();
  if (strict && keys.some(k => !available.has(k)))
    throw new TRPCError({
      code: "CONFLICT",
      message: "所选内容已变化，请重新选择",
    });
  const selected = new Set(keys);
  const chapters = liveChapters(pkg).flatMap(c => {
    const chosen = lineBindings(c).filter(line =>
      selected.has(paragraphKey(c.id, line.id))
    );
    const blockIds = chosen.map(line => line.id);
    const illustrations = c.blocks.illustrations
      .filter(i => selected.has(illustrationKey(c.id, i.key)))
      .map(i => ({
        key: i.key,
        after: null,
        ...(i.caption ? { caption: i.caption } : {}),
      }));
    if (!blockIds.length && !illustrations.length) return [];
    return [
      {
        ...c,
        layout: null,
        blocks: {
          body: chosen.map(line => line.text).join("\n\n"),
          blockIds,
          containsAiText: c.blocks.containsAiText,
          settings: null,
          coverKey: null,
          bodyTextureKey: null,
          images: Object.fromEntries(
            illustrations.flatMap(i =>
              c.blocks.images[i.key] ? [[i.key, c.blocks.images[i.key]]] : []
            )
          ),
          illustrations,
        },
      },
    ];
  });
  const p = normalizePublishingDraftState(pkg.body.publishing);
  const text = liveChapters(pkg).length
    ? chapters.map(c => c.blocks.body).join("\n\n")
    : chapterPackageLines(p.drafts[p.activePlatform]?.content.body ?? "")
        .filter(line => selected.has(`legacy:${mailboxDigest(line)}`))
        .join("\n\n");
  const images = pkg.images
    .filter(i => selected.has(`image:${i.id}`))
    .map(i => ({ ...i, parentImageId: null }));
  const videos = pkg.videos
    .filter(v => selected.has(`video:${v.id}`))
    .map(v => ({ ...v, sourceImageId: null }));
  const audio = pkg.audio.filter(a => selected.has(`audio:${a.id}`));
  const versions = items(
    mailboxRecord(pkg.body.videoWorkflow).versions
  ).flatMap(v => {
    const exports = items(v.exports).filter(e =>
      selected.has(exportKey(v.id, e.id))
    );
    if (!exports.length) return [];
    return [
      {
        id: v.id,
        number: v.number,
        createdAt: v.createdAt,
        name: v.name,
        intent: v.intent,
        summary: "",
        author: v.author,
        confirmedBy: v.confirmedBy,
        shots: [],
        material: {},
        exports,
      },
    ];
  });
  const body = {
    publishing: upsertPublishingPlatformDraft(emptyPublishingDraftState(0), {
      platform: p.activePlatform,
      content: { title: pkg.title, body: text, tags: [] },
      now: 0,
    }),
    bookWorkflow: {
      schemaVersion: 1,
      revision: 0,
      current: {},
      conversions: [],
      versions: [],
    },
    videoWorkflow: { schemaVersion: 1, versions },
  };
  const inventory = {
    chapters: chapters.length || Number(Boolean(text)),
    images:
      images.length +
      chapters.reduce((n, c) => n + c.blocks.illustrations.length, 0),
    videos: videos.length,
    audio: audio.length,
    timelineItems: 0,
    bookVersions: 0,
    chapterVersions: 0,
    videoVersions: versions.length,
    exports: versions.reduce((n, v) => n + v.exports.length, 0),
  };
  const data = {
    schemaVersion: 1 as const,
    title: pkg.title,
    body,
    chapters,
    chapterVersions: [],
    images,
    imageDecisions: pkg.imageDecisions.filter(d =>
      images.some(i => i.id === d.imageId)
    ),
    videos,
    ranges: [],
    selections: [],
    audio,
    timeline: null,
    videoFiles: {},
    selection: { version: 1 as const, keys },
    inventory,
  };
  // Hide changes outside the fixed selection, including whole-chapter revision timestamps.
  const stable = JSON.parse(
    JSON.stringify(data, (key, value) =>
      ["createdAt", "updatedAt", "version", "storageKey", "userId"].includes(
        key
      )
        ? undefined
        : value
    )
  );
  return { ...data, fingerprint: mailboxDigest(stable) };
}

/** A received subset is a new independent document with newly mapped asset/chapter ids. */
export function receivedMailboxSelection(
  pkg: MailboxPackage
): MailboxSelection {
  return {
    version: 1,
    keys: mailboxParts(pkg)
      .map(p => p.key)
      .sort(),
  };
}
