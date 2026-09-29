import type {
  TextDraftContent,
  TextDraftVersion,
} from "@shared/textDraftHistory";

/** A selected candidate is a basis, never implicit evidence of adoption. */
export function resolveTextDraftBasis(input: {
  selected?: TextDraftVersion;
  latest?: TextDraftVersion;
  edited: TextDraftContent | null;
  buffer?: TextDraftContent;
  published?: TextDraftContent;
}): { parentId: string | null; basis: TextDraftContent | null } {
  const version =
    input.selected?.status === "ready" ? input.selected : input.latest;
  if (input.buffer)
    return { parentId: version?.id ?? null, basis: input.buffer };
  // Once adopted, subsequent edits in the publishing editor are authoritative.
  if (version?.adoption && version.id === input.latest?.id && input.published) {
    return { parentId: version.id, basis: input.published };
  }
  if (version)
    return {
      parentId: version.id,
      basis:
        (input.selected?.id === version.id ? input.edited : null) ??
        version.adoption?.content ??
        version.generated ??
        null,
    };
  return { parentId: null, basis: input.published ?? null };
}
