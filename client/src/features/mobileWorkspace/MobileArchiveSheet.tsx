/**
 * 「存入故事」：把聊聊说的这段，存进某个故事的正文。
 *
 * 三步：选目标故事 → 预览并修改 → 确认存入。
 *
 * 真实与未接入的分界，逐条说清楚：
 *
 * - **目标故事**：真实的，来自 `storyAgent.storyList`（就是本人名下的故事）。
 * - **目标版本**：真实的，但**只有「当前可编辑版本」这一个**。
 *   `publishingDraft.readBody` 只返回该故事当前那份可编辑正文，仓库里没有
 *   「列出一个故事的所有版本」的接口，所以成品／历史版本在这里是列不出来的，
 *   界面明说尚未接入，不编造「版本 1／版本 2」。成品因此也不可能被覆盖。
 * - **写入**：真实的，走既有的 `publishingDraft.saveBody`，带 `baseBodyRevision`
 *   乐观锁；冲突由服务端判定并原样报给用户，不静默改存别处。
 * - **待存的正文**：取聊聊最近说的那段原文。**没有**「自动整理成正文」那一步——
 *   那需要再跑一次模型，文档明确要求不擅自触发生成，所以这里只把原话给出来供
 *   修改，并在界面上说明。
 * - **追加／替换**：产品尚未拍板，所以**不预设默认值**，必须由用户明确选一个
 *   才能提交；两种都只作用于可编辑正文那一层。
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
  sourceText,
  onOpenChange,
}: {
  open: boolean;
  stories: readonly MobileStorySummary[];
  activeStoryId: number | null;
  /** 聊聊最近说的那段；没有就为 null，入口仍在但说明暂无可存的正文。 */
  sourceText: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [step, setStep] = useState<Step>("target");
  const [targetId, setTargetId] = useState<number | null>(activeStoryId);
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<ArchiveMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedInto, setSavedInto] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const saveMutation = trpc.publishingDraft.saveBody.useMutation();

  // 每次打开都从头来，并把目标复位到当前故事——上一次选了别的故事，
  // 这次一打开还停在那儿，很容易存错地方。
  useEffect(() => {
    if (!open) return;
    setStep("target");
    setTargetId(activeStoryId);
    setDraft(sourceText ?? "");
    setMode(null);
    setError(null);
    setSavedInto(null);
  }, [open, activeStoryId, sourceText]);

  const targetDoc = trpc.publishingDraft.readBody.useQuery(
    { storyId: targetId ?? 0 },
    { enabled: open && typeof targetId === "number" && targetId > 0, retry: false }
  );

  const targetStory = stories.find(story => story.id === targetId) ?? null;
  const versionLabel = targetDoc.data
    ? `编辑中 · ${targetDoc.data.versionId}`
    : null;

  async function confirm() {
    const document = targetDoc.data;
    if (!document || !mode || typeof targetId !== "number") return;
    const addition = draft.trim();
    if (!addition) {
      setError("请先填写要存入的正文。");
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
          "这个版本在别处刚被改过，没有存入。请返回重新读取后再试，你写的内容还在。"
        );
        await targetDoc.refetch();
        return;
      }
      await utils.publishingDraft.readBody.invalidate({ storyId: targetId });
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

  return (
    <MobileSheet
      open={open}
      title={step === "done" ? "已存入" : "存入故事"}
      description={
        step === "target"
          ? "选一个故事。只能存进它当前可编辑的正文。"
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
            disabled={!targetDoc.data}
            onClick={() => setStep("preview")}
          >
            下一步：预览正文
          </Button>
        ) : step === "preview" ? (
          <Button
            type="button"
            className="min-h-12 w-full rounded-xl"
            disabled={!mode || saveMutation.isPending || !targetDoc.data}
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
          {sourceText ? null : (
            <div className="mb-4">
              <MobileNotConnected what="聊聊还没有说过可以存的话。先聊几句，再回来存。" />
            </div>
          )}
          <div className="text-[11px] tracking-[0.07em] text-muted-foreground">
            目标故事
          </div>
          <ul className="mt-2 space-y-2">
            {stories.map(story => (
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
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] text-foreground">
                      {story.id === activeStoryId ? "当前故事 · " : ""}
                      {story.title}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {story.id === activeStoryId
                        ? "正在聊的这个"
                        : "以前的故事"}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>

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
            ) : (
              <p className="text-sm text-muted-foreground">请先选一个故事。</p>
            )}
          </div>
          <div className="mt-3">
            <MobileNotConnected what="只能存进当前可编辑的那一份正文。列出成品和历史版本、并选其中一个，还没有对应接口，所以这里不列——也因此不会覆盖成品。" />
          </div>
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
            要存入的正文 · 可修改
          </div>
          <textarea
            aria-label="要存入的正文"
            className="mt-2 h-40 w-full resize-y rounded-xl border border-border/70 bg-background px-3.5 py-3 text-[15px] leading-7 outline-none"
            value={draft}
            onChange={event => setDraft(event.target.value)}
          />
          <p className="mt-2 text-xs leading-6 text-muted-foreground">
            这是聊聊最近说的那段原话。
          </p>
          <div className="mt-2">
            <MobileNotConnected what="「把整段聊天自动整理成正文」还没有做——那要再跑一次模型，本轮不擅自触发生成。所以这里给的是原话，请自行改成想留下的样子。" />
          </div>

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
              ? "保留原正文，把这段接在末尾。"
              : mode === "replace"
                ? "会把所选版本的原正文整段换掉。请先核对目标和内容。"
                : "两种方式产品还没有拍板，所以没有默认值，请明确选一个。"}
          </p>
          <p className="mt-2 text-xs leading-6 text-muted-foreground">
            原聊天保留，不会被移动或删除。
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
          <p className="text-[15px] text-foreground">已存入</p>
          <p className="mt-2 text-sm leading-7 text-muted-foreground">
            {savedInto}
          </p>
          <p className="mt-4 text-xs leading-6 text-muted-foreground">
            原聊天保留。
          </p>
        </div>
      ) : null}
    </MobileSheet>
  );
}
