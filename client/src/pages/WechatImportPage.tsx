import { useUiText as useDesktopUiText } from "@/features/uiLanguage/UiLanguage";
import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { rootWorkspacePath } from "@/features/mobileWorkspace/mobileWorkspaceEntry";
import { readMobileReturnPath } from "@/features/auth/mobileReturnPath";
import type { WechatStoryRef } from "@shared/wechatBookImport";

export type WechatImportRow = WechatStoryRef & {
  title: string;
  updatedAt: string;
  importedStoryId: number | null;
};
const keyOf = (row: WechatStoryRef) =>
  `${row.storyId}:${row.revisionId}:${row.version}`;
const button =
  "rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40";
export function WechatImportView({
  rows,
  selected,
  onSelect,
  onImport,
  onRetry,
  onMore,
  loading,
  busy,
  error,
  hasMore,
  results,
  continueHref,
}: {
  rows: WechatImportRow[];
  selected: Set<string>;
  onSelect: (key: string) => void;
  onImport: () => void;
  onRetry: () => void;
  onMore: () => void;
  loading: boolean;
  busy: boolean;
  error?: string;
  hasMore: boolean;
  results: Array<{ title: string; storyId: number; warnings: string[] }>;
  continueHref: string;
}) {
  const _ui = useDesktopUiText();
  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-5 py-10 text-foreground sm:px-8 sm:py-16">
      <p className="mb-3 text-xs tracking-widest text-muted-foreground">
        {_ui("拾光 · 微信与网页")}</p>
      <h1 className="font-serif text-3xl leading-tight">{_ui("把微信故事带到网页")}</h1>
      <p className="mt-4 max-w-xl text-sm leading-7 text-muted-foreground">
        {_ui("选择你想继续写的故事，每章会成为书里的可折叠标题。导入会新建网页书稿，微信原稿和现有网页内容都会保留。")}</p>
      <p className="mt-2 text-xs leading-6 text-muted-foreground">
        {_ui("同一版本重复导入只打开已有书稿；微信后续更新需重新选择，并另存一份。照片、封面和字号会尽量保留；仅存于微信本机的图片会显示原位置提示，分页与底图会重新排布。")}</p>
      {loading && (
        <p role="status" className="py-8 text-sm">
          {_ui("正在查看这个微信账号的故事…")}</p>
      )}
      {error && (
        <div
          role="alert"
          className="my-6 rounded-lg border border-border p-4 text-sm leading-6"
        >
          {error}
          <button
            type="button"
            disabled={busy || loading}
            onClick={onRetry}
            className={`${button} ml-3`}
          >
            {_ui("重试读取")}</button>
        </div>
      )}
      {!loading && !error && !rows.length && (
        <p className="py-10 text-sm text-muted-foreground">
          {_ui("这个微信账号暂无可导入的故事。你可以先在微信里保存一份书稿。")}</p>
      )}
      <ul className="my-7 divide-y divide-border border-y border-border">
        {rows.map(row => (
          <li key={keyOf(row)} className="flex items-center gap-4 py-5">
            <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-4">
              <input
                type="checkbox"
                aria-label={_ui("选择 {0}", [row.title])}
                className="h-5 w-5 shrink-0 accent-current"
                checked={selected.has(keyOf(row))}
                disabled={busy || Boolean(row.importedStoryId)}
                onChange={() => onSelect(keyOf(row))}
              />
              <span className="min-w-0">
                <span className="block break-words text-base">{row.title}</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {_ui("微信版本")}{" "}{row.version}
                  {row.updatedAt ? ` · ${row.updatedAt.slice(0, 10)}` : ""}
                </span>
              </span>
            </label>
            {row.importedStoryId && (
              <a
                className="shrink-0 text-xs underline"
                href={`/editing?storyId=${row.importedStoryId}`}
              >
                {_ui("已导入 · 打开")}</a>
            )}
          </li>
        ))}
      </ul>
      {hasMore && (
        <button
          className={button}
          type="button"
          onClick={onMore}
          disabled={busy || loading}
        >
          {_ui("查看更多故事")}</button>
      )}
      <div className="flex flex-wrap items-center gap-4">
        <button
          className={`${button} bg-foreground text-background hover:bg-foreground/90`}
          type="button"
          onClick={onImport}
          disabled={busy || loading || !selected.size}
        >
          {busy
            ? _ui("正在导入，请稍候…")
            : _ui("导入所选{0}", [selected.size ? `（${selected.size}）` : ""])}
        </button>
        {!busy && (
          <a
            href={continueHref}
            className="rounded px-2 py-2 text-sm underline underline-offset-4"
          >
            {results.length ? _ui("继续写网页故事") : _ui("暂不导入，继续使用网页")}
          </a>
        )}
      </div>
      {!!results.length && (
        <section aria-live="polite" className="mt-8 space-y-4">
          <h2 className="text-base font-medium">{_ui("已保存到网页")}</h2>
          {results.map(result => (
            <div
              key={result.storyId}
              className="rounded-lg border border-border p-4"
            >
              <a
                className="text-sm underline"
                href={`/editing?storyId=${result.storyId}`}
              >
                {_ui("打开《")}{result.title}》
              </a>
              {result.warnings.map(w => (
                <p
                  key={w}
                  className="mt-2 text-xs leading-6 text-muted-foreground"
                >
                  {w}
                </p>
              ))}
            </div>
          ))}
        </section>
      )}
    </main>
  );
}

export default function WechatImportPage() {
  const [cursor, setCursor] = useState(0),
    [previous, setPrevious] = useState<WechatImportRow[]>([]),
    [selected, setSelected] = useState(new Set<string>());
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string>(),
    [results, setResults] = useState<
      Array<{
        sourceKey: string;
        title: string;
        storyId: number;
        warnings: string[];
      }>
    >([]);
  const query = trpc.wechatBookImport.list.useQuery(
    { cursor },
    { retry: false, refetchOnWindowFocus: false }
  );
  const mutation = trpc.wechatBookImport.import.useMutation();
  const imported = new Map(
    results.map(result => [result.sourceKey, result.storyId])
  );
  const rows = [
    ...new Map(
      [...previous, ...(query.data?.stories ?? [])].map(row => [
        row.storyId,
        row,
      ])
    ).values(),
  ].map(row => ({
    ...row,
    importedStoryId: imported.get(keyOf(row)) ?? row.importedStoryId,
  }));
  const returnPath = readMobileReturnPath(window.location.search);
  async function importSelected() {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      for (const row of rows.filter(row => selected.has(keyOf(row)))) {
        const result = await mutation.mutateAsync({
          storyId: row.storyId,
          revisionId: row.revisionId,
          version: row.version,
        });
        setResults(list => [
          ...list.filter(r => r.storyId !== result.storyId),
          { ...result, title: row.title, sourceKey: keyOf(row) },
        ]);
        setSelected(list => {
          const next = new Set(list);
          next.delete(keyOf(row));
          return next;
        });
      }
      await query.refetch();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "导入未完成，请重试；已保存的故事仍保留。"
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <WechatImportView
      rows={rows}
      selected={selected}
      onSelect={key =>
        setSelected(list => {
          const next = new Set(list);
          next.has(key) ? next.delete(key) : next.add(key);
          return next;
        })
      }
      onImport={() => void importSelected()}
      onRetry={() => {
        setError(undefined);
        setPrevious([]);
        setSelected(new Set());
        if (cursor === 0) void query.refetch();
        else setCursor(0);
      }}
      onMore={() => {
        if (query.data?.nextCursor != null) {
          setPrevious(rows);
          setCursor(query.data.nextCursor);
        }
      }}
      loading={query.isFetching}
      busy={busy}
      error={error || query.error?.message}
      hasMore={query.data?.nextCursor != null}
      results={results}
      continueHref={
        returnPath && returnPath !== "/wechat-import"
          ? returnPath
          : rootWorkspacePath()
      }
    />
  );
}
