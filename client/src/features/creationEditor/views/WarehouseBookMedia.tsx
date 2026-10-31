import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { bookAudioText } from "@shared/bookAudioBlock";
import {
  INSERT_WAREHOUSE_BOOK,
  type WarehouseBookInsert,
} from "@/features/publishingAlbum/warehouseBookInsert";
import { toast } from "sonner";
export function WarehouseBookMedia({
  storyId,
  kind,
}: {
  storyId: number;
  kind: "music" | "text";
}) {
  const [offset, setOffset] = useState(0);
  const [audioKind,setAudioKind]=useState<"music"|"narration">("music");
  const music = trpc.timelineMedia.audioAssetLibrary.useQuery(
    { storyId },
    { enabled: kind === "music", refetchOnMount: "always" }
  );
  const text = trpc.memoryWarehouse.forStory.useQuery(
    { storyId, offset },
    { enabled: kind === "text", refetchOnMount: "always" }
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
    <section aria-label={kind === "music" ? "音乐仓库" : "文字仓库"}>
      {kind==='music'&&<div className="mb-2 flex gap-3 text-xs">{([['music','音乐'],['narration','有声书']] as const).map(([value,label])=><button key={value} aria-pressed={audioKind===value} className={audioKind===value?'font-semibold text-primary':'text-muted-foreground'} onClick={()=>setAudioKind(value)}>{label}</button>)}</div>}
      {query.isLoading && <p role="status">正在读取素材…</p>}
      {query.error && (
        <p role="alert">
          读取失败，
          <button onClick={() => void query.refetch()}>重新读取</button>
        </p>
      )}
      {kind === "music" ? (
        <div className="flex gap-3 overflow-x-auto">
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
                  插入书中
                </button>
              </article>
            ))}
          {music.data && !music.data.some(a => a.mediaKind === audioKind) && (
            <p className="text-xs text-muted-foreground">
              生成或导入的音乐会保存在这里。
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="flex gap-3 overflow-x-auto">
            {text.data?.cards.map(c => (
              <article key={c.id} className="w-64 shrink-0 rounded border p-2">
                <p className="text-xs text-muted-foreground">
                  {c.title} · {c.origin === "assistant" ? "AI生成" : "文字素材"}
                </p>
                <p className="max-h-24 overflow-y-auto whitespace-pre-wrap text-sm">
                  {c.content}
                </p>
                <button
                  className="text-xs underline"
                  onClick={() => insert(c.content)}
                >
                  插入书中
                </button>
              </article>
            ))}
            {text.data && !text.data.cards.length && (
              <p className="text-xs text-muted-foreground">
                生成的文字会保存在这里。
              </p>
            )}
          </div>
          <div className="mt-2 flex gap-3 text-xs">
            {offset > 0 && (
              <button onClick={() => setOffset(Math.max(0, offset - 50))}>
                上一页
              </button>
            )}
            {text.data?.nextOffset != null && (
              <button onClick={() => setOffset(text.data!.nextOffset!)}>
                下一页
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
