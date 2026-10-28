import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { listLegacyStoryDrafts, OPEN_LEGACY_RECOVERY } from "../legacyStoryRecovery";

function readDrafts() {
  try { return listLegacyStoryDrafts(window.localStorage); }
  catch { return []; }
}

/** Only mounted inside the account menu; never displays a startup banner. */
export function LegacyStoryRecoveryEntry({ onOpen }: { onOpen(): void }) {
  const [available] = useState(() => readDrafts().length > 0);
  if (!available) return null;
  return <button type="button" className="flex w-full px-2.5 py-2 text-left text-xs text-muted-foreground hover:bg-muted"
    onClick={() => { onOpen(); window.dispatchEvent(new Event(OPEN_LEGACY_RECOVERY)); }}>找回本机旧内容</button>;
}

export function LegacyStoryRecovery({ userId, onImport }: { userId: number; onImport(key: string): boolean }) {
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<ReturnType<typeof listLegacyStoryDrafts>>([]);
  const [selected, setSelected] = useState("");
  useEffect(() => {
    setOpen(false); setDrafts([]); setSelected("");
    const show = () => { setDrafts(readDrafts()); setSelected(""); setOpen(true); };
    window.addEventListener(OPEN_LEGACY_RECOVERY, show);
    return () => window.removeEventListener(OPEN_LEGACY_RECOVERY, show);
  }, [userId]);
  const draft = drafts.find(item => item.key === selected);
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogContent className="max-h-[85vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>找回本机旧内容</DialogTitle>
        <DialogDescription>这是旧版网页曾存在这个浏览器里的内容，可能包含未上传的文字或对话。它不是新消息，也不需要日常处理。关闭后不会再次自动提醒。</DialogDescription>
      </DialogHeader>
      {drafts.length === 0 ? <p className="text-sm">没有找到可恢复的旧内容，你可以直接关闭。</p> : <>
        <p className="text-xs text-muted-foreground">旧版没有记录所属账号。请先看内容，只恢复你认得的；恢复会复制成一份独立故事，不覆盖现在的文章。</p>
        <select aria-label="选择本机旧内容" className="w-full rounded border bg-background p-2" value={selected} onChange={event => setSelected(event.target.value)}>
          <option value="">选择一份内容查看</option>
          {drafts.map(item => <option key={item.key} value={item.key}>{item.title}{item.savedAt ? ` · ${new Date(item.savedAt).toLocaleDateString()}` : ''}</option>)}
        </select>
        {draft && <section aria-label="旧内容预览" className="space-y-2 rounded border p-3">
          <h3 className="font-medium">{draft.title}</h3>
          <p className="whitespace-pre-wrap break-words text-sm">{draft.preview}</p>
          <button className="rounded border px-3 py-2 text-sm" onClick={() => {
            if (!window.confirm('这份内容属于你吗？确认后复制成独立故事，原记录保留，不覆盖已有文章。')) return;
            if (onImport(draft.key)) { setDrafts(readDrafts()); setSelected(''); }
          }}>这是我的内容，恢复副本</button>
        </section>}
      </>}
    </DialogContent>
  </Dialog>;
}
