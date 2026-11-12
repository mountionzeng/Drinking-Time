import { WarehouseFiles } from "./WarehouseFiles";
import { useUiText as useDesktopUiText } from "@/features/uiLanguage/UiLanguage";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { bookAudioText } from "@shared/bookAudioBlock";
import {
  INSERT_WAREHOUSE_BOOK,
  type WarehouseBookInsert,
} from "@/features/publishingAlbum/warehouseBookInsert";
import { toast } from "sonner";
import { isPersistedStoryId } from "@shared/persistedStoryId";
export function WarehouseBookMedia({
  storyId,
  kind,
  leading,
}: {
  storyId: number;
  kind: "music" | "text";
  leading?: import("react").ReactNode;
}) {
  const _ui = useDesktopUiText();
  const [offset, setOffset] = useState(0);
  const [audioKind,setAudioKind]=useState<"music"|"narration">("music");
  const music = trpc.timelineMedia.audioAssetLibrary.useQuery(
    { storyId },
    { enabled: kind === "music" && isPersistedStoryId(storyId), refetchOnMount: "always" }
  );
  const text = trpc.memoryWarehouse.forStory.useQuery(
    { storyId, offset },
    { enabled: kind === "text" && isPersistedStoryId(storyId), refetchOnMount: "always" }
  );
  function insert(content: string) {
    const detail: WarehouseBookInsert = { storyId, text: content };
    window.dispatchEvent(new CustomEvent(INSERT_WAREHOUSE_BOOK, { detail }));
    if (!detail.accepted)
      toast.error("请先在“书”中打开可编辑的正文，再插入素材");
    else toast.success("已插入书中");
  }
  const query = kind === "music" ? music : text;
  return (
    <section aria-label={kind === "music" ? _ui("音乐仓库") : _ui("文字仓库")}>
      {kind==='music'&&<div className="mb-2 flex gap-3 text-xs">{([['music','音乐'],['narration','有声书']] as const).map(([value,label])=><button key={value} aria-pressed={audioKind===value} className={audioKind===value?'font-semibold text-primary':'text-muted-foreground'} onClick={()=>setAudioKind(value)}>{_ui(label)}</button>)}</div>}
      {query.isLoading && <p role="status">{_ui("正在读取素材…")}</p>}
      {query.error && (
        <p role="alert">
          {_ui("读取失败，")}<button onClick={() => void query.refetch()}>{_ui("重新读取")}</button>
        </p>
      )}
      {kind === "music" ? (
        <div className="flex gap-3 overflow-x-auto">
          {leading}
          {music.data
            ?.filter(a => a.mediaKind === audioKind)
            .map(a => (
              <article key={a.id} className="w-64 shrink-0 rounded border p-2">
                <p className="truncate text-xs" title={a.displayName}>
                  {a.displayName}
                </p>
                <audio
                  controls
                  preload="none"
                  src={a.audioUrl}
                  className="my-2 h-9 w-full"
                />
                <button
                  className="text-xs underline"
                  onClick={() =>
                    insert(bookAudioText(storyId, a.id, a.displayName,audioKind))
                  }
                >
                  {_ui("插入书中")}</button>
              </article>
            ))}
          {music.data && !music.data.some(a => a.mediaKind === audioKind) && !leading && (
            <p className="text-xs text-muted-foreground">
              {_ui("生成或导入的音乐会保存在这里。")}</p>
          )}
        </div>
      ) : (
        <>
          <WarehouseFiles storyId={storyId}/>
          <div className="flex gap-3 overflow-x-auto">
            {text.data?.cards.map(c => (
              <article key={c.id} className="w-64 shrink-0 rounded border p-2">
                <p className="text-xs text-muted-foreground">
                  {c.title} · {c.origin === "assistant" ? _ui("AI生成") : _ui("文字素材")}
                </p>
                <p className="max-h-24 overflow-y-auto whitespace-pre-wrap text-sm">
                  {c.content}
                </p>
                <button
                  className="text-xs underline"
                  onClick={() => insert(c.content)}
                >
                  {_ui("插入书中")}</button>
              </article>
            ))}
            {text.data && !text.data.cards.length && (
              <p className="text-xs text-muted-foreground">
                {_ui("生成的文字会保存在这里。")}</p>
            )}
          </div>
          <div className="mt-2 flex gap-3 text-xs">
            {offset > 0 && (
              <button onClick={() => setOffset(Math.max(0, offset - 50))}>
                {_ui("上一页")}</button>
            )}
            {text.data?.nextOffset != null && (
              <button onClick={() => setOffset(text.data!.nextOffset!)}>
                {_ui("下一页")}</button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
