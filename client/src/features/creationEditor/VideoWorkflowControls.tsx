import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import type { CreationIntent } from "@shared/bookWorkflow";
import { BookVideoStartButton } from "@/features/bookVideo/BookVideoStartButton";
const button =
  "rounded-md border px-3 py-1.5 text-xs disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]";
export function VideoWorkflowControls({
  storyId,
  disabled,
}: {
  storyId: number;
  disabled: boolean;
}) {
  const query = trpc.videoWorkflow.get.useQuery(
    { storyId },
    {
      enabled: !disabled,
      refetchOnWindowFocus: true,
      refetchInterval: q =>
        q.state.data?.state.versions.some(v =>
          v.exports.some(
            e =>
              e.status === "rendering" &&
              Date.now() - e.createdAt < 30 * 60 * 1000
          )
        )
          ? 5000
          : false,
    }
  );
  const save = trpc.videoWorkflow.save.useMutation(),
    exportVersion = trpc.videoWorkflow.export.useMutation();
  const [intent, setIntent] = useState<CreationIntent>({
      purpose: "",
      audience: "",
      platform: "",
    }),
    [summary, setSummary] = useState("");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [aspect, setAspect] = useState<"16:9" | "9:16" | "1:1">("16:9");
  const lock = useRef(false),
    scope = useRef(storyId);
  scope.current = storyId;
  const defaults =
    query.data?.intent ?? query.data?.state.versions.at(-1)?.intent;
  useEffect(() => {
    if (defaults) setIntent(defaults);
  }, [storyId, defaults?.purpose, defaults?.audience, defaults?.platform]);
  async function run(action: () => Promise<unknown>) {
    if (lock.current || disabled) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
      if (scope.current === storyId) await query.refetch();
    } catch (cause) {
      if (scope.current === storyId)
        setError(
          cause instanceof Error ? cause.message : "操作未完成，版本保留"
        );
    } finally {
      lock.current = false;
      if (scope.current === storyId) setBusy(false);
    }
  }
  return (
    <section aria-label="视频作品版本" className="space-y-3 border-b pb-3">
      <p className="font-medium">视频作品版本</p>
      {query.data?.bookUpdated && (
        <div
          role="status"
          className="space-y-2 rounded border border-[var(--nayin-accent)] p-2"
        >
          <p>书稿已有新版本。当前视频继续保留，可用新版分镜规划另一个视频。</p>
          <BookVideoStartButton storyId={storyId} />
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {query.data?.source
          ? `当前方案来源：分镜版 V${query.data.source.number}`
          : "旧视频尚未记录来源分镜版本，保存时会如实保留这一状态。"}
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        {(
          [
            ["purpose", "制作意图"],
            ["audience", "给谁看"],
            ["platform", "发布平台"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="text-xs">
            {label}
            <input
              className="mt-1 w-full rounded border bg-transparent p-2"
              value={intent[key]}
              maxLength={
                key === "purpose" ? 1000 : key === "audience" ? 300 : 200
              }
              onChange={event =>
                setIntent({ ...intent, [key]: event.target.value })
              }
            />
          </label>
        ))}
      </div>
      <label className="block text-xs">
        这次改了什么
        <input
          className="mt-1 w-full rounded border bg-transparent p-2"
          value={summary}
          maxLength={1000}
          placeholder="例如：缩短前两镜，调整字幕和配乐"
          onChange={event => setSummary(event.target.value)}
        />
      </label>
      <button
        className={button}
        disabled={
          disabled ||
          busy ||
          !intent.purpose.trim() ||
          !intent.audience.trim() ||
          !intent.platform.trim() ||
          !summary.trim()
        }
        onClick={() =>
          void run(() =>
            save.mutateAsync({
              storyId,
              id: crypto.randomUUID(),
              intent,
              summary,
            })
          )
        }
      >
        {busy ? "处理中…" : "确认保存视频新版本"}
      </button>
      <p className="text-xs text-muted-foreground">
        保存当前剪辑、素材、字幕和音轨；后续编辑不改动已保存版本。分镜方案确认与成片版本分别记录。
      </p>
      {query.isLoading && <p role="status">正在读取视频版本…</p>}
      {query.error && (
        <p role="alert">
          版本记录暂未读到。
          <button className={button} onClick={() => void query.refetch()}>
            重试
          </button>
        </p>
      )}
      {[...(query.data?.state.versions ?? [])].reverse().map(version => (
        <details key={version.id} className="border-t py-2">
          <summary className="cursor-pointer">
            视频版 V{version.number} · {version.name} ·{" "}
            {new Date(version.createdAt).toLocaleString()}
          </summary>
          <p className="mt-2 text-xs">
            编辑：{version.author.name} · 确认：{version.confirmedBy.name}
          </p>
          <p className="text-xs">
            {version.intent.purpose} · {version.intent.audience} ·{" "}
            {version.intent.platform}
          </p>
          <p className="text-xs">{version.summary}</p>
          <p className="text-xs">
            来源：
            {version.textSource
              ? `文字版 V${version.textSource.number} → `
              : ""}
            {version.manuscriptSource
              ? `分镜版 V${version.manuscriptSource.number}`
              : "旧版未记录"}{" "}
            · {version.material.timeline.items.length} 个镜头／片段
          </p>
          <details className="my-2">
            <summary className="cursor-pointer text-xs">
              查看当时的镜头与素材
            </summary>
            {version.shots.map((shot, index) => (
              <p
                className="whitespace-pre-wrap border-t py-1 text-xs"
                key={index}
              >
                {index + 1}. {String(shot.subject ?? "")} ·{" "}
                {String(shot.action ?? "")}
              </p>
            ))}
          </details>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs">
              导出尺寸比例{" "}
              <select
                aria-label="导出尺寸比例"
                className="rounded border bg-transparent p-1"
                value={aspect}
                onChange={event =>
                  setAspect(event.target.value as typeof aspect)
                }
              >
                <option value="16:9">横屏 16:9</option>
                <option value="9:16">竖屏 9:16</option>
                <option value="1:1">方形 1:1</option>
              </select>
            </label>
            <button
              className={button}
              disabled={busy || disabled}
              onClick={() =>
                void run(() =>
                  exportVersion.mutateAsync({
                    storyId,
                    id: version.id,
                    exportId: crypto.randomUUID(),
                    aspectRatio: aspect,
                  })
                )
              }
            >
              导出此版本
            </button>
          </div>
          {version.exports.map(record => (
            <div key={record.id} className="mt-2 text-xs">
              {new Date(record.createdAt).toLocaleString()} ·{" "}
              {record.actor.name} · {record.aspectRatio} ·{" "}
              {record.status === "ready"
                ? `${record.durationSec}秒`
                : record.status === "rendering"
                  ? "导出中"
                  : "导出失败"}
              {record.videoUrl && (
                <div>
                  <video
                    className="mt-1 max-h-64 max-w-full"
                    controls
                    preload="none"
                    src={record.videoUrl}
                  />
                  <a className="underline" href={record.videoUrl} download>
                    下载此版本成品
                  </a>
                </div>
              )}
              {record.error && <p role="alert">{record.error}</p>}
            </div>
          ))}
        </details>
      ))}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
