import { useUiText } from "@/features/uiLanguage/UiLanguage";
import type {
  VideoMediaKind,
  VideoMediaVersionList,
} from "@shared/videoMediaVersions";

export type VideoMediaVersionBinding = {
  history: VideoMediaVersionList | undefined;
  pending: boolean;
  onRestore: (kind: VideoMediaKind, versionId: string) => Promise<void>;
};

/** Compact track-local history; the server restores the saved media slice. */
export function VideoMediaVersionSelect({
  kind,
  binding,
}: {
  kind: VideoMediaKind;
  binding?: VideoMediaVersionBinding;
}) {
  const ui = useUiText();
  const entries =
    binding?.history?.entries.filter(entry => entry.kind === kind) ?? [];
  if (!binding || entries.length === 0) return null;
  const current = binding.history?.current[kind];
  const describe = (entry: (typeof entries)[number]) =>
    [
      entry.label,
      new Date(entry.createdAt).toLocaleString(),
      entry.authorName ??
        (entry.authorUserId
          ? ui("用户 {0}", [entry.authorUserId])
          : ui("编辑者未记录")),
      ui(entry.intent),
    ].join(" · ");
  return (
    <select
      aria-label={ui(kind === "subtitles" ? "字幕版本" : "声音版本")}
      data-testid={`media-version-${kind}`}
      title={
        entries.find(entry => entry.id === current)
          ? describe(entries.find(entry => entry.id === current)!)
          : ui("版本")
      }
      value={current ?? ""}
      disabled={binding.pending}
      onChange={event => void binding.onRestore(kind, event.target.value)}
      className="h-5 w-[66px] shrink-0 rounded-sm border border-border bg-background px-0.5 text-[10px] font-normal text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
    >
      {!current ? (
        <option value="" disabled>
          {ui("版本")}
        </option>
      ) : null}
      {[...entries].reverse().map(entry => (
        <option key={entry.id} value={entry.id}>
          {entry.id === current ? entry.label : describe(entry)}
        </option>
      ))}
    </select>
  );
}
