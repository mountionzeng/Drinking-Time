import { Loader2 } from "lucide-react";
import type { FinishedProductVersion } from "@shared/finishedProductVersion";

export function PublishingVersionControls({
  versions,
  purpose,
  busy,
  canSaveText,
  canSaveImage,
  canSaveVideo,
  onPurposeChange,
  onSaveText,
  onSaveImage,
  onSaveVideo,
  onComplete,
  onAbandon,
}: {
  versions: FinishedProductVersion[];
  purpose: string;
  busy: boolean;
  canSaveText: boolean;
  canSaveImage: boolean;
  canSaveVideo: boolean;
  onPurposeChange: (purpose: string) => void;
  onSaveText: () => void;
  onSaveImage: () => void;
  onSaveVideo: () => void;
  onComplete: () => void;
  onAbandon: () => void;
}) {
  const editing = versions.find(version => version.status === "editing");

  return (
    <section
      className="mt-3 max-w-3xl space-y-2"
      aria-label="成品版本"
      data-testid="finished-product-version-table"
    >
      <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--panel-border)" }}>
        <table className="w-full min-w-[36rem] text-left text-[11px]">
          <thead className="bg-muted/35 text-muted-foreground">
            <tr>
              <th className="px-2 py-2 font-medium">成品版本</th>
              <th className="px-2 py-2 font-medium">文字</th>
              <th className="px-2 py-2 font-medium">图像</th>
              <th className="px-2 py-2 font-medium">视频</th>
              <th className="px-2 py-2 font-medium">修改目的</th>
            </tr>
          </thead>
          <tbody>
            {versions.map(version => (
              <tr key={version.id} className="border-t" style={{ borderColor: "var(--panel-border)" }}>
                <td className="whitespace-nowrap px-2 py-2 font-medium">
                  {version.status === "completed" ? `V${version.sequence}` : "新"}
                </td>
                <td className="whitespace-nowrap px-2 py-2">Text {version.textVersionId.toUpperCase()}</td>
                <td className="whitespace-nowrap px-2 py-2">
                  {version.status === "editing"
                    ? version.images.length > 0 ? "Image 新" : "—"
                    : version.imageVersion ? `Image V${version.imageVersion}` : "—"}
                </td>
                <td className="whitespace-nowrap px-2 py-2">
                  {version.status === "editing"
                    ? version.videos.length > 0 ? "Video 新" : "—"
                    : version.videoVersion ? `Video V${version.videoVersion}` : "—"}
                </td>
                <td className="px-2 py-2">{version.purpose}</td>
              </tr>
            ))}
            {versions.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-2 py-3 text-muted-foreground">
                  还没有成品版本。写下一句修改目的，再明确保存文字、图像或视频。
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={purpose}
          onChange={event => onPurposeChange(event.target.value)}
          disabled={busy}
          maxLength={160}
          placeholder="这次为什么要更新？"
          aria-label="修改目的"
          className="h-8 min-w-52 flex-1 rounded-md border bg-background px-2 text-xs outline-none"
          style={{ borderColor: "var(--panel-border)" }}
        />
        <button
          type="button"
          onClick={onSaveText}
          disabled={busy || !canSaveText || !purpose.trim()}
          className="h-8 rounded-md border px-2.5 text-[11px] font-medium disabled:opacity-45"
          style={{ borderColor: "var(--panel-border)" }}
        >
          {busy ? <Loader2 className="mr-1 inline h-3 w-3 animate-spin" /> : null}
          保存文字新版
        </button>
        <button
          type="button"
          onClick={onSaveImage}
          disabled={busy || !canSaveImage || !purpose.trim()}
          className="h-8 rounded-md border px-2.5 text-[11px] font-medium disabled:opacity-45"
          style={{ borderColor: "var(--panel-border)" }}
        >
          保存图像新版
        </button>
        <button
          type="button"
          onClick={onSaveVideo}
          disabled={busy || !canSaveVideo || !purpose.trim()}
          className="h-8 rounded-md border px-2.5 text-[11px] font-medium disabled:opacity-45"
          style={{ borderColor: "var(--panel-border)" }}
        >
          保存视频新版
        </button>
        {editing ? (
          <>
            <button
              type="button"
              onClick={onComplete}
              disabled={busy}
              className="h-8 rounded-md bg-[var(--nayin-accent)] px-2.5 text-[11px] font-medium text-background disabled:opacity-45"
            >
              完成版本
            </button>
            <button
              type="button"
              onClick={onAbandon}
              disabled={busy}
              className="h-8 px-2 text-[11px] text-muted-foreground disabled:opacity-45"
            >
              放弃
            </button>
          </>
        ) : null}
      </div>
    </section>
  );
}
