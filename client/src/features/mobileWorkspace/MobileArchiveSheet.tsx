/**
 * 「存入故事」：把**聊聊整理出的正文**预览后，存进目标故事的可编辑版本。
 *
 * 整理稿是什么，核查后确定了：**就是这个故事的正文本身**。
 * 故事的正文正是发布稿生成（`publishingDraft.generate`）写出来、再由用户编辑的那份，
 * 手机上「聊聊」页顶部一直显示的就是它。所以归档不需要任何新的生成调用。
 *
 * 明确排除的两个错误来源：
 * - **不是**聊聊最近一条回复（那是对话原话，不是整理稿）。
 * - **不是**输入框里还没发出去的字。
 *
 * 也不在这里调 `publishingDraft.generate` 重新整理：它走的是 `initialize` 写入，
 * 会**覆盖该故事现有正文**，而且不返回可搬运的文本。归档是搬运，不该带上覆盖风险。
 *
 * 真实与未接入的分界：
 * - 目标故事：真实（`storyAgent.storyList`，本人名下）。
 * - 目标版本：真实，但**只有「当前可编辑版本」一个**——`publishingDraft.readBody`
 *   只返回该故事当前那份可编辑正文，仓库没有「列出一个故事所有版本」的接口。
 *   成品因此不可能被这个流程覆盖。
 * - 写入：真实，`publishingDraft.saveBody` 带 `baseBodyRevision` 乐观锁。
 */
import { Loader2 } from "lucide-react";
import React, { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import type { MobileStorySummary } from "./MobileStoryPanel";
import { MobileNotConnected, MobileSheet } from "./MobileSheet";

export type ArchiveMode = "append" | "replace";

/**
 * 追加就是「原文 + 空行 + 新段」，替换就是新段本身。
 *
 * 单独抽出来是为了能直接测：真机上试不出「原文有没有被留住」，但这里可以。
 */
export function composeArchivedBody(
  currentBody: string,
  addition: string,
  mode: ArchiveMode
): string {
  const next = addition.trim();
  if (mode === "replace") return next;
  const base = currentBody.replace(/\s+$/, "");
  return base ? `${base}\n\n${next}` : next;
}

type Step = "target" | "preview" | "done";

export function MobileArchiveSheet({
  open,
  stories,
  activeStoryId,
  /** 当前故事的正文——就是聊聊整理出的那份，也是要存走的内容。 */
  sourceBody,
  onOpenChange,
}: {
  open: boolean;
  stories: readonly MobileStorySummary[];
  activeStoryId: number | null;
  sourceBody: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [step, setStep] = useState<Step>("target");
  const [targetId, setTargetId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<ArchiveMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedInto, setSavedInto] = useState<string | null>(null);
  /** 存成功之后就不再让这次预览重复提交——防止重复追加。 */
  const [committed, setCommitted] = useState(false);

  const utils = trpc.useUtils();
  const saveMutation = trpc.publishingDraft.saveBody.useMutation();

  const hasSource = Boolean(sourceBody && sourceBody.trim());

  // 每次打开都从头来。上一次选了别的故事，这次一打开还停在那儿，很容易存错地方。
  useEffect(() => {
    if (!open) return;
    setStep("target");
    // 默认不选当前故事：存到自己身上是空操作，真正的用途是搬到别的故事去
    setTargetId(null);
    setDraft(sourceBody ?? "");
    setMode(null);
    setError(null);
    setSavedInto(null);
    setCommitted(false);
  }, [open, sourceBody]);

  const targetDoc = trpc.publishingDraft.readBody.useQuery(
    { storyId: targetId ?? 0 },
    {
      enabled: open && typeof targetId === "number" && targetId > 0,
      retry: false,
    }
  );

  const targetStory = stories.find(story => story.id === targetId) ?? null;
  const versionLabel = targetDoc.data
    ? `编辑中 · ${targetDoc.data.versionId}`
    : null;

  async function confirm() {
    const document = targetDoc.data;
    if (!document || !mode || typeof targetId !== "number") return;
    if (committed) return;
    const addition = draft.trim();
    if (!addition) {
      setError("要存入的正文是空的。");
      return;
    }
    setError(null);
    try {
      const result = await saveMutation.mutateAsync({
        storyId: targetId,
        versionId: document.versionId,
        platform: document.platform,
        baseBodyRevision: document.bodyRevision,
        body: composeArchivedBody(document.body, addition, mode),
      });
      if (result.status === "conflict") {
        setError(
          "这个版本在别处刚被改过，没有存入。返回重选一次目标再试，你写的内容还在。"
        );
        await targetDoc.refetch();
        return;
      }
      await utils.publishingDraft.readBody.invalidate({ storyId: targetId });
      setCommitted(true);
      setSavedInto(
        [targetStory?.title, versionLabel].filter(Boolean).join(" · ")
      );
      setStep("done");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "存入失败，你写的内容还在。"
      );
    }
  }

  const others = stories.filter(story => story.id !== activeStoryId);

  return (
    <MobileSheet
      open={open}
      title={step === "done" ? "已存入" : "存入故事"}
      description={
        step === "target"
          ? "把聊聊整理出的正文，存进另一个故事的可编辑版本。"
          : step === "preview"
            ? "确认目标，并改成你想留下的样子。"
            : undefined
      }
      onOpenChange={onOpenChange}
      footer={
        step === "target" ? (
          <Button
            type="button"
            className="min-h-12 w-full rounded-xl"
            disabled={!hasSource || !targetDoc.data}
            onClick={() => setStep("preview")}
          >
            下一步：预览正文
          </Button>
        ) : step === "preview" ? (
          <Button
            type="button"
            className="min-h-12 w-full rounded-xl"
            disabled={
              !mode || saveMutation.isPending || !targetDoc.data || committed
            }
            onClick={() => void confirm()}
          >
            {saveMutation.isPending ? (
              <Loader2 aria-hidden="true" className="animate-spin" />
            ) : null}
            {mode === "replace"
              ? "确认替换并存入"
              : mode === "append"
                ? "确认追加并存入"
                : "先选择追加或替换"}
          </Button>
        ) : (
          <Button
            type="button"
            className="min-h-12 w-full rounded-xl"
            onClick={() => onOpenChange(false)}
          >
            返回聊天
          </Button>
        )
      }
    >
      {step === "target" ? (
        <>
          {hasSource ? (
            <div className="rounded-xl bg-muted px-4 py-3">
              <div className="text-[11px] tracking-[0.07em] text-muted-foreground">
                要存走的正文
              </div>
              <p className="mt-1.5 line-clamp-3 text-sm leading-7 text-foreground">
                {sourceBody}
              </p>
              <p className="mt-1.5 text-xs text-muted-foreground">
                这是当前故事的正文，也就是聊聊整理出来、你改过的那份。
              </p>
            </div>
          ) : (
            <MobileNotConnected what="当前故事还没有正文可存。先在「聊聊」页把正文写出来或整理出来，再回来存。" />
          )}

          <div className="mt-5 text-[11px] tracking-[0.07em] text-muted-foreground">
            存到哪个故事
          </div>
          {others.length === 0 ? (
            <p className="mt-2 text-sm leading-7 text-muted-foreground">
              还没有别的故事可以存。
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {others.map(story => (
                <li key={story.id}>
                  <label
                    className={cn(
                      "flex min-h-16 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2",
                      targetId === story.id
                        ? "border-primary bg-muted"
                        : "border-border/70"
                    )}
                  >
                    <input
                      checked={targetId === story.id}
                      className="size-4 accent-[var(--primary)]"
                      name="archive-target"
                      type="radio"
                      onChange={() => setTargetId(story.id)}
                    />
                    <span className="min-w-0 flex-1 text-[15px] text-foreground">
                      {story.title}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}

          {targetId ? (
            <>
              <div className="mt-5 text-[11px] tracking-[0.07em] text-muted-foreground">
                目标版本
              </div>
              <div className="mt-2">
                {targetDoc.isFetching ? (
                  <p className="text-sm text-muted-foreground">正在读取版本…</p>
                ) : targetDoc.isError ? (
                  <p className="text-sm text-destructive">
                    读不到这个故事的正文：{targetDoc.error.message}
                  </p>
                ) : targetDoc.data ? (
                  <p className="rounded-xl bg-muted px-4 py-3 text-sm leading-6">
                    {versionLabel}
                  </p>
                ) : null}
              </div>
              <div className="mt-3">
                <MobileNotConnected what="只能存进当前可编辑的那一份正文。列出成品和历史版本还没有对应接口，所以这里不列——也因此不会覆盖成品。" />
              </div>
            </>
          ) : null}
        </>
      ) : null}

      {step === "preview" ? (
        <>
          <button
            type="button"
            className="min-h-11 text-sm text-muted-foreground"
            onClick={() => setStep("target")}
          >
            ‹ 返回选择
          </button>
          <div className="mt-2 rounded-xl bg-muted px-4 py-3 text-sm leading-7">
            目标故事：
            <strong className="font-medium text-foreground">
              {targetStory?.title ?? "—"}
            </strong>
            <br />
            目标版本：{versionLabel ?? "—"}
          </div>

          <div className="mt-4 text-[11px] tracking-[0.07em] text-muted-foreground">
            真正将要写入的正文 · 可修改
          </div>
          <textarea
            aria-label="要存入的正文"
            className="mt-2 h-48 w-full resize-y rounded-xl border border-border/70 bg-background px-3.5 py-3 text-[15px] leading-7 outline-none"
            value={draft}
            onChange={event => setDraft(event.target.value)}
          />

          <div className="mt-5 text-[11px] tracking-[0.07em] text-muted-foreground">
            怎么存
          </div>
          <div className="mt-2 flex gap-2">
            {(["append", "replace"] as const).map(option => (
              <button
                key={option}
                type="button"
                aria-pressed={mode === option}
                className={cn(
                  "min-h-12 flex-1 rounded-xl border px-3 text-sm",
                  mode === option
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border/70 text-foreground"
                )}
                onClick={() => setMode(option)}
              >
                {option === "append" ? "追加到末尾" : "替换该版本正文"}
              </button>
            ))}
          </div>
          <p
            className={cn(
              "mt-2 text-xs leading-6",
              mode === "replace" ? "text-destructive" : "text-muted-foreground"
            )}
          >
            {mode === "append"
              ? "保留目标故事的原正文，把这段接在末尾。"
              : mode === "replace"
                ? "会把目标版本的原正文整段换掉。请先核对目标和内容。"
                : "两种方式产品还没有拍板，所以没有默认值，请明确选一个。"}
          </p>
          <p className="mt-2 text-xs leading-6 text-muted-foreground">
            原聊天保留；当前故事的正文也不会被改动，这里只是复制过去。
          </p>

          {error ? (
            <p className="mt-4 text-sm leading-6 text-destructive" role="status">
              {error}
            </p>
          ) : null}
        </>
      ) : null}

      {step === "done" ? (
        <div className="py-6 text-center">
          <p className="text-[15px] leading-7 text-foreground">{savedInto}</p>
          <p className="mt-4 text-xs leading-6 text-muted-foreground">
            原聊天与当前故事的正文都保留。
          </p>
        </div>
      ) : null}
    </MobileSheet>
  );
}
