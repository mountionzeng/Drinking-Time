import { useEffect, useState } from "react";
import { listLegacyStoryDrafts } from "../legacyStoryRecovery";

export function LegacyStoryRecovery({
  userId,
  onImport,
}: {
  userId: number;
  onImport: (key: string) => boolean;
}) {
  const [drafts, setDrafts] = useState<Array<{ key: string; savedAt: number }>>(
    []
  );
  const [selected, setSelected] = useState("");
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    try {
      setDrafts(listLegacyStoryDrafts(window.localStorage));
    } catch {
      setDrafts([]);
    }
    setSelected("");
    setDismissed(false);
  }, [userId]);
  if (dismissed || drafts.length === 0) return null;
  return (
    <aside
      className="border-b border-border bg-background px-4 py-3 text-sm"
      aria-label="本机旧草稿"
    >
      <p>此浏览器保留了旧草稿，尚未归属当前账号。不会自动导入。</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <select
          aria-label="选择本机旧草稿"
          className="rounded border border-border bg-background p-1"
          value={selected}
          onChange={event => setSelected(event.target.value)}
        >
          <option value="">选择要恢复的草稿</option>
          {drafts.map((draft, index) => (
            <option key={draft.key} value={draft.key}>
              旧草稿 {index + 1}
              {draft.savedAt
                ? ` · ${new Date(draft.savedAt).toLocaleDateString()}`
                : ""}
            </option>
          ))}
        </select>
        <button
          className="underline disabled:opacity-40"
          disabled={!selected}
          onClick={() => {
            if (
              !window.confirm(
                "仅当这份本机旧草稿属于你时继续。确认后会在当前账号创建一份新故事；原缓存保留，不会覆盖已有云端故事。"
              )
            )
              return;
            if (onImport(selected)) {
              setDrafts(items => items.filter(item => item.key !== selected));
              setSelected("");
            }
          }}
        >
          确认归属并导入
        </button>
        <button
          className="text-muted-foreground"
          onClick={() => setDismissed(true)}
        >
          暂不导入
        </button>
      </div>
    </aside>
  );
}
