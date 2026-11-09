import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  currentManuscript,
  manuscriptLabel,
  type CreationIntent,
  type ManuscriptKind,
} from "@shared/bookWorkflow";
import { writingModuleTexts } from "@shared/bookWritingStyle";
import { readBookAudio } from "@shared/bookAudioBlock";
import { readBookImage } from "@shared/bookImageBlock";

const button =
  "rounded-md border border-[var(--panel-border)] px-3 py-1.5 text-xs disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]";
export function BookWorkflowControls({
  storyId,
  accountId,
  kind,
  beforeChange,
  onSelect,
  onChanged,
}: {
  storyId: number;
  accountId?: number | null;
  kind?: ManuscriptKind;
  beforeChange: () => Promise<void>;
  onSelect: (kind: ManuscriptKind) => void;
  onChanged: () => Promise<void>;
}) {
  const query = trpc.bookWorkflow.get.useQuery(
    { storyId },
    {
      refetchOnWindowFocus: true,
      refetchInterval: q =>
        q.state.data?.state.conversions.some(
          d =>
            d.status === "generating" &&
            Date.now() - d.createdAt < 15 * 60 * 1000
        )
          ? 5000
          : false,
    }
  );
  const save = trpc.bookWorkflow.save.useMutation(),
    convert = trpc.bookWorkflow.convert.useMutation(),
    adopt = trpc.bookWorkflow.adopt.useMutation(),
    edit = trpc.bookWorkflow.edit.useMutation(),
    restore = trpc.bookWorkflow.restore.useMutation();
  const create = trpc.chapters.create.useMutation();
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [intent, setIntent] = useState<CreationIntent>({
      purpose: "",
      audience: "",
      platform: "",
    }),
    [summary, setSummary] = useState("");
  const storageKey = `dt:manuscript-conversion-review:${accountId ?? "unknown"}:${storyId}`;
  const [texts, setTexts] = useState<{
    id: string;
    revision: number;
    values: string[][];
  } | null>(() => {
    try {
      if (accountId == null) return null;
      const value = JSON.parse(localStorage.getItem(storageKey) || "null");
      return value &&
        typeof value.id === "string" &&
        Number.isInteger(value.revision) &&
        Array.isArray(value.values) &&
        value.values.every(
          (row: unknown) =>
            Array.isArray(row) && row.every(text => typeof text === "string")
        )
        ? value
        : null;
    } catch {
      return null;
    }
  });
  useEffect(() => {
    try {
      if (accountId != null) {
        if (texts) localStorage.setItem(storageKey, JSON.stringify(texts));
        else localStorage.removeItem(storageKey);
      }
    } catch {
      if (texts) setError("预览修改暂未保存到本机，请先点保存预览修改。");
    }
    if (!texts) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [texts, storageKey, accountId]);
  const lock = useRef(false),
    scope = useRef(storyId);
  scope.current = storyId;
  const selected = kind ?? query.data?.preferredKind ?? "text";
  const state = query.data?.state,
    current = state && currentManuscript(state, selected);
  useEffect(() => {
    setIntent(current?.intent ?? { purpose: "", audience: "", platform: "" });
    setSummary("");
  }, [storyId, selected, current?.id]);
  const run = async (task: () => Promise<void>, flush = true) => {
    if (lock.current) return;
    if (flush && texts) {
      setError("请先保存预览里的修改，再切换或更新稿件。");
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      if (flush) await beforeChange();
      if (scope.current !== storyId) return;
      await task();
      if (scope.current === storyId) {
        if (flush) await onChanged();
        await query.refetch();
      }
    } catch (cause) {
      if (scope.current === storyId)
        setError(
          cause instanceof Error ? cause.message : "操作未完成，草稿保留"
        );
    } finally {
      lock.current = false;
      if (scope.current === storyId) setBusy(false);
    }
  };
  const valid = Boolean(
    intent.purpose.trim() && intent.audience.trim() && intent.platform.trim()
  );
  const saveCurrent = async () => {
    const fresh = (await query.refetch()).data;
    if (!fresh) throw new Error("稿件状态暂未读到");
    return save.mutateAsync({
      storyId,
      id: crypto.randomUUID(),
      kind: selected,
      intent,
      summary:
        summary.trim() || (current ? "保存当前稿件修改" : "首次保存作品版本"),
      expectedFingerprint: fresh.drafts[selected].fingerprint,
    });
  };
  const conversions =
    state?.conversions.filter(
      d => d.target === selected || d.source.kind === selected
    ) ?? [];
  return (
    <section
      aria-label="稿件与作品版本"
      className="space-y-2 border-b border-[var(--panel-border)] pb-3"
    >
      <nav aria-label="稿件类型" className="flex flex-wrap items-center gap-2">
        {(["text", "storyboard"] as const).map(value => (
          <button
            key={value}
            className={`${button} ${selected === value ? "bg-[var(--nayin-accent)]/10 font-medium" : ""}`}
            aria-pressed={selected === value}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                onSelect(value);
              })
            }
          >
            {manuscriptLabel(value)} · {value === "text" ? "章／节" : "场／镜"}
          </button>
        ))}
        <span className="text-xs text-muted-foreground">
          {current ? `V${current.number}` : "草稿"}
          {query.data?.drafts[selected].dirty && current ? " · 有新修改" : ""}
        </span>
        <button
          className={button}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          作品版本与转换
        </button>
        {query.data && !query.data.drafts[selected].count && (
          <button
            className={button}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await create.mutateAsync({
                  storyId,
                  kind: selected,
                  title: selected === "text" ? "第 1 章" : "第 1 场",
                  body: "",
                });
              })
            }
          >
            开始写{manuscriptLabel(selected)}
          </button>
        )}
      </nav>
      {query.error && (
        <p role="alert" className="text-sm text-destructive">
          版本记录读取失败，请重试。
          <button className={button} onClick={() => void query.refetch()}>
            重试
          </button>
        </p>
      )}
      {open && (
        <div className="space-y-3 py-2 text-sm">
          {texts && (
            <div role="status" className="space-y-2 rounded border p-2">
              <p>
                有尚未提交的预览修改。若原预览已更新，可先保留以下副本，再放弃本机修改。
              </p>
              <details>
                <summary className="cursor-pointer">
                  查看可复制的本机副本
                </summary>
                <textarea
                  aria-label="本机预览副本"
                  className="w-full rounded border bg-transparent p-2"
                  readOnly
                  rows={6}
                  value={texts.values.map(row => row.join("\n")).join("\n\n")}
                />
              </details>
              <button
                className={button}
                disabled={busy}
                onClick={() => {
                  setTexts(null);
                  setError("");
                }}
              >
                放弃本机预览修改
              </button>
            </div>
          )}
          <p>这次想用它做什么，准备发在哪里？已有用途可以直接沿用。</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {(
              [
                ["purpose", "想表达什么", "例如：介绍新产品的使用场景"],
                ["audience", "给谁看", "例如：朋友圈里的朋友"],
                ["platform", "发在哪里", "例如：朋友圈、短视频平台或自己收藏"],
              ] as const
            ).map(([field, label, placeholder]) => (
              <label key={field} className="space-y-1 text-xs">
                {label}
                <input
                  className="w-full rounded-md border bg-transparent p-2 text-sm"
                  maxLength={
                    field === "purpose"
                      ? 1000
                      : field === "audience"
                        ? 300
                        : 200
                  }
                  value={intent[field]}
                  placeholder={placeholder}
                  onChange={event =>
                    setIntent({ ...intent, [field]: event.target.value })
                  }
                />
              </label>
            ))}
          </div>
          <label className="block space-y-1 text-xs">
            这次要调整什么（可选）
            <textarea
              className="w-full rounded-md border bg-transparent p-2 text-sm"
              maxLength={1000}
              rows={2}
              value={summary}
              onChange={event => setSummary(event.target.value)}
              placeholder="例如：缩短开头，增加产品实际使用的画面"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              className={button}
              disabled={busy || !valid || !query.data?.drafts[selected].count}
              onClick={() =>
                void run(async () => {
                  await saveCurrent();
                })
              }
            >
              {busy ? "处理中…" : "保存为新版本"}
            </button>
            <button
              className={button}
              disabled={busy || !valid || !query.data?.drafts[selected].count}
              onClick={() =>
                void run(async () => {
                  const fresh = (await query.refetch()).data;
                  if (!fresh) throw new Error("请重新读取稿件");
                  const saved =
                    !fresh.drafts[selected].dirty && current
                      ? current
                      : await saveCurrent();
                  await convert.mutateAsync({
                    storyId,
                    id: crypto.randomUUID(),
                    sourceId: saved.id,
                    target: selected === "text" ? "storyboard" : "text",
                    intent,
                    request: summary,
                  });
                })
              }
            >
              保存并转为
              {manuscriptLabel(selected === "text" ? "storyboard" : "text")}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            日常编辑只更新草稿；保存新版本或确认采用时才升级版本号。转换先生成预览，原稿保留。
          </p>
          {[...conversions].reverse().map(draft => (
            <details
              key={draft.id}
              open={draft.status === "review" || draft.status === "generating"}
              className="border-t py-2"
            >
              <summary className="cursor-pointer">
                {manuscriptLabel(draft.source.kind)} V{draft.source.number} →{" "}
                {manuscriptLabel(draft.target)} ·{" "}
                {
                  {
                    generating: "转换中",
                    review: "待确认",
                    failed: "未完成",
                    adopted: "已采用",
                  }[draft.status]
                }
              </summary>
              <p className="py-1 text-xs">
                {draft.intent.purpose} · {draft.intent.audience} ·{" "}
                {draft.intent.platform} · {draft.author.name} ·{" "}
                {new Date(draft.createdAt).toLocaleString()}
              </p>
              {draft.error && <p role="alert">{draft.error}</p>}
              {draft.status === "generating" && (
                <p role="status">
                  正在转换，请等待结果。刷新后可继续查看；长时间未返回时先核对任务，避免重复发起。
                </p>
              )}
              {draft.chapters?.map((chapter, chapterIndex) => (
                <details key={chapterIndex} className="py-1">
                  <summary>{chapter.title}</summary>
                  <div className="space-y-2 py-2">
                    {writingModuleTexts(
                      chapter.blocks.body,
                      chapter.blocks.writingStyle
                    ).map((text, moduleIndex) => {
                      const image = readBookImage(text),
                        audio = readBookAudio(text),
                        row = chapter.blocks.writingStyle?.[moduleIndex];
                      return (
                        <div
                          key={row?.id ?? moduleIndex}
                          className={row?.parentId ? "ml-4" : ""}
                        >
                          {image ? (
                            <img
                              className="max-h-32 max-w-full rounded"
                              src={image.url}
                              alt="保留的原稿图片"
                            />
                          ) : audio ? (
                            <p className="text-xs">保留声音：{audio.title}</p>
                          ) : draft.status === "review" ? (
                            <label className="block text-xs">
                              {row?.format === "scene"
                                ? "场"
                                : row?.format === "shot"
                                  ? "镜"
                                  : "内容"}
                              <textarea
                                className="mt-1 w-full rounded border bg-transparent p-2 text-sm"
                                rows={Math.min(
                                  6,
                                  Math.max(2, text.split("\n").length)
                                )}
                                maxLength={12000}
                                value={
                                  texts?.id === draft.id
                                    ? (texts.values[chapterIndex]?.[
                                        moduleIndex
                                      ] ?? text)
                                    : text
                                }
                                onChange={event => {
                                  if (texts && texts.id !== draft.id) {
                                    setError("请先保存另一份预览的修改");
                                    return;
                                  }
                                  const values = structuredClone(
                                    texts?.id === draft.id
                                      ? texts.values
                                      : draft.chapters!.map(c =>
                                          writingModuleTexts(
                                            c.blocks.body,
                                            c.blocks.writingStyle
                                          )
                                        )
                                  );
                                  values[chapterIndex][moduleIndex] =
                                    event.target.value;
                                  setTexts({
                                    id: draft.id,
                                    revision: texts?.revision ?? draft.revision,
                                    values,
                                  });
                                }}
                              />
                            </label>
                          ) : (
                            <p className="whitespace-pre-wrap">{text}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </details>
              ))}
              {draft.status === "review" && (
                <div className="flex gap-2 pt-2">
                  {texts?.id === draft.id && (
                    <button
                      className={button}
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await edit.mutateAsync({
                            storyId,
                            id: draft.id,
                            revision: texts.revision,
                            texts: texts.values,
                          });
                          setTexts(null);
                        }, false)
                      }
                    >
                      保存预览修改
                    </button>
                  )}
                  <button
                    className={button}
                    disabled={busy || texts !== null}
                    onClick={() =>
                      void run(async () => {
                        await adopt.mutateAsync({
                          storyId,
                          id: draft.id,
                          revision: draft.revision,
                        });
                        onSelect(draft.target);
                      })
                    }
                  >
                    确认采用为{manuscriptLabel(draft.target)}新版本
                  </button>
                </div>
              )}
            </details>
          ))}
          {[...(state?.versions.filter(v => v.kind === selected) ?? [])]
            .reverse()
            .map(version => (
              <details key={version.id} className="border-t py-2">
                <summary className="cursor-pointer">
                  {manuscriptLabel(version.kind)} V{version.number} ·{" "}
                  {version.name}
                  {current?.id === version.id ? " · 当前采用" : " · 历史"}
                </summary>
                <p className="mt-2 text-xs">
                  {new Date(version.createdAt).toLocaleString()} · 发起：
                  {version.author.name} · 编辑：
                  {version.editedBy?.name ?? version.author.name} · 确认：
                  {version.confirmedBy.name}
                  {version.aiAssisted ? " · AI协助" : ""}
                </p>
                <p className="text-xs">
                  用途：{version.intent.purpose} · 给{version.intent.audience} ·{" "}
                  {version.intent.platform}
                </p>
                <p className="text-xs">{version.summary}</p>
                {version.source && (
                  <p className="text-xs">
                    来源：{manuscriptLabel(version.source.kind)} V
                    {version.source.number}
                  </p>
                )}
                {version.chapters.map((chapter, index) => (
                  <details key={index}>
                    <summary>{chapter.title}</summary>
                    <p className="max-h-64 overflow-auto whitespace-pre-wrap py-2 text-xs">
                      {chapter.blocks.body}
                    </p>
                  </details>
                ))}
                <button
                  className={`${button} mt-2`}
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const fresh = (await query.refetch()).data;
                      if (!fresh) throw new Error("请重新读取版本");
                      await restore.mutateAsync({
                        storyId,
                        id: crypto.randomUUID(),
                        versionId: version.id,
                        expectedFingerprint: fresh.drafts[selected].fingerprint,
                      });
                    })
                  }
                >
                  以此建立新版本（保留当前稿）
                </button>
              </details>
            ))}
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
