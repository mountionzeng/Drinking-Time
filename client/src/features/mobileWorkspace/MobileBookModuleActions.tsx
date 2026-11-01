import { useState } from "react";
import { useBookModuleActions } from "@/features/publishingAlbum/bookModuleActions";
import type { LayoutModuleContext } from "@shared/layoutModuleContext";

export function MobileBookModuleActions({ module, disabled, onAction }: {
  module: LayoutModuleContext;
  disabled: boolean;
  onAction?: () => void;
}) {
  const session = useBookModuleActions(state => state.session);
  const [choosing, setChoosing] = useState(false);
  const [ids, setIds] = useState<string[]>([]);
  const [error, setError] = useState("");
  if (!session || session.scope !== module.scope || session.storyId !== module.storyId ||
    module.kind !== "text" || !session.modules.some(item => item.id === module.moduleId)) return null;
  const selected = ids.filter(id => session.modules.some(item => item.id === id));
  function act(run: () => void) {
    try { run(); setError(""); setChoosing(false); onAction?.(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "模块已变化，请重新选择。"); }
  }
  return <div className="mx-4 mb-2 shrink-0 rounded-xl bg-muted/50 px-3 py-1" aria-label="当前模块操作">
    <div className="flex flex-wrap gap-x-4 text-sm text-primary">
      <button type="button" className="min-h-11" disabled={disabled || (module.selection?.count ?? 1) > 1} onClick={() => act(() => session.convert(module.moduleId, "image"))}>生成图片</button>
      <button type="button" className="min-h-11" disabled={disabled || (module.selection?.count ?? 1) > 1} onClick={() => act(() => session.convert(module.moduleId, "music"))}>生成音乐</button>
      <button type="button" className="min-h-11" disabled={disabled || session.modules.length < 2} onClick={() => {
        setIds(module.selection?.ids ?? [module.moduleId]); setChoosing(!choosing); setError("");
      }}>合并模块</button>
    </div>
    {(module.selection?.count ?? 1) > 1 && <p className="text-xs text-muted-foreground">先合并所选文字，再生成图片或音乐。</p>}
    {choosing && <div aria-label="选择要合并的文字模块">
      <p className="py-1 text-xs text-muted-foreground">勾选要合并的文字，按文章顺序保留换行。</p>
      <div className="max-h-48 overflow-y-auto overscroll-contain">
        {session.modules.map((item, index) => <label key={item.id} className="flex min-h-11 items-start gap-2 py-2 text-sm">
          <input type="checkbox" className="mt-1" checked={selected.includes(item.id)} disabled={disabled} onChange={event => setIds(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))} />
          <span className="line-clamp-2">{index + 1}. {item.text || "空白模块"}</span>
        </label>)}
      </div>
      <button type="button" className="min-h-11 text-sm text-primary disabled:opacity-50" disabled={disabled || selected.length < 2} onClick={() => act(() => session.merge(selected))}>合并所选 {selected.length} 个模块</button>
    </div>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>;
}
