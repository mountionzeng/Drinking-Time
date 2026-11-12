import { trpc } from "@/lib/trpc";
import { useUiLanguage } from "@/features/uiLanguage/UiLanguage";
import {
  warehouseFileDownloadUrl,
  WAREHOUSE_FILE_CHAT_EVENT,
} from "@shared/warehouseFiles";

export function WarehouseFiles({ storyId }: { storyId: number }) {
  const { language } = useUiLanguage();
  const files = trpc.creationAgent.warehouseFiles.useQuery(
    { storyId },
    { refetchOnMount: "always" }
  );
  if (files.error)
    return (
      <p role="alert">
        {language === "zh"
          ? "文件读取失败，刷新后重试 / Could not load files"
          : "Could not load files"}
      </p>
    );
  return (
    <div
      className="mb-2 flex gap-3 overflow-x-auto"
      aria-label={
        language === "zh" ? "文件仓库 / File warehouse" : "File warehouse"
      }
    >
      {files.data?.map(file => (
        <article key={file.id} className="w-56 shrink-0 rounded border p-2">
          <button
            type="button"
            className="block w-full text-left text-xs font-medium hover:text-primary"
            aria-label={`${language === "zh" ? "在聊聊中查看 / View in chat" : "View in chat"} ${file.name}`}
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent(WAREHOUSE_FILE_CHAT_EVENT, {
                  detail: { storyId, fileId: file.id, name: file.name },
                })
              )
            }
          >
            <span className="block truncate" title={file.name}>
              {file.name}
            </span>
            <span className="mt-1 block font-normal text-muted-foreground">
              {file.extension.toUpperCase() || "FILE"} ·{" "}
              {(file.bytes / 1024).toFixed(1)} KB · #{file.id}
            </span>
          </button>
          <p className="my-1 line-clamp-2 text-[10px] text-muted-foreground">
            {language === "zh"
              ? file.extractionNote
              : file.extractionNote.split(" / ").slice(1).join(" / ") ||
                file.extractionNote}
          </p>
          {file.extractedText && (
            <details className="my-1 text-[11px]">
              <summary>
                {language === "zh"
                  ? "本地预览 / Local preview"
                  : "Local preview"}
              </summary>
              <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-all">
                {file.extractedText.slice(0, 3000)}
                {file.extractedText.length > 3000 ? "…" : ""}
              </pre>
            </details>
          )}
          <a
            className="text-[11px] text-primary underline"
            href={warehouseFileDownloadUrl(storyId, file.id)}
            download={file.name}
          >
            {language === "zh" ? "下载原件 / Download" : "Download original"}
          </a>
        </article>
      ))}
    </div>
  );
}
