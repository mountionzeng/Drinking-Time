import type { ManuscriptVersion } from "../../shared/bookWorkflow";
import { manuscriptFingerprint } from "./manuscriptSnapshot";
import { readTextDraftHistory } from "../../shared/textDraftHistory";
import { normalizePublishingDraftState } from "../../shared/publishingDraft";
const mailboxRecord = (v: unknown) =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};
/** Preserve completed older text versions as ordinary manuscript versions, without prompts or chats. */
export function mailboxLegacyManuscripts(body: unknown): ManuscriptVersion[] {
  const source = mailboxRecord(body),
    versions: ManuscriptVersion[] = [];
  function add(
    id: string,
    title: string,
    text: string,
    at: number,
    name: string
  ) {
    if (!text.trim()) return;
    const chapters = [
      {
        title,
        blocks: {
          body: text,
          blockIds: [],
          containsAiText: false,
          settings: null,
          coverKey: null,
          bodyTextureKey: null,
          images: {},
          illustrations: [],
        },
        layout: null,
      },
    ];
    versions.push({
      id,
      kind: "text",
      number: versions.length + 1,
      name: title,
      createdAt: at,
      intent: { purpose: title, audience: "", platform: "" },
      author: { userId: 0, name },
      confirmedBy: { userId: 0, name },
      aiAssisted: false,
      summary: "",
      chapters,
      fingerprint: manuscriptFingerprint(chapters),
    });
  }
  for (const version of readTextDraftHistory(source.textDraftHistory)
    .versions) {
    const content = version.adoption?.content ?? version.generated;
    if (version.status === "ready" && content)
      add(
        `received-text-${version.id}`,
        content.title,
        content.body,
        version.completedAt ?? version.createdAt,
        version.contribution?.authorName ?? ""
      );
  }
  const publishing = normalizePublishingDraftState(source.publishing);
  for (const version of publishing.versions ?? []) {
    const draft = version.drafts[version.activePlatform];
    if (draft)
      add(
        `received-publishing-${version.versionId}`,
        draft.content.title,
        draft.content.body,
        draft.updatedAt,
        ""
      );
  }
  return versions;
}
