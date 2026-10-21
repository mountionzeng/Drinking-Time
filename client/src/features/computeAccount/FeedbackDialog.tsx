import React, { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useUiText } from "@/features/uiLanguage/UiLanguage";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { feedbackCategoryLabels, feedbackStatusLabels } from "@shared/feedback";

type Category = keyof typeof feedbackCategoryLabels;
const field =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";
const button =
  "min-h-10 rounded-lg px-3 py-2 text-sm text-primary disabled:opacity-40";
export function FeedbackDialog() {
  const t = useUiText();
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [writing, setWriting] = useState(false);
  const [filter, setFilter] = useState<Category | "">("");
  const [offset, setOffset] = useState(0);
  const [category, setCategory] = useState<Category>("suggestion");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tags, setTags] = useState("");
  const [message, setMessage] = useState("");
  const token = useRef(crypto.randomUUID());
  const lock = useRef(false);
  const list = trpc.feedback.list.useQuery(
    { category: filter || undefined, offset },
    { enabled: open, retry: false }
  );
  const submit = trpc.feedback.submit.useMutation({ retry: false });
  async function send() {
    if (lock.current) return;
    lock.current = true;
    setMessage("");
    try {
      await submit.mutateAsync({
        id: token.current,
        category,
        title,
        content,
        tags: tags
          .split(/[,，]/)
          .map(tag => tag.trim())
          .filter(Boolean),
        page:
          location.pathname === "/m"
            ? "/m"
            : location.pathname === "/editing"
              ? "/editing"
              : "/other",
      });
      token.current = crypto.randomUUID();
      setTitle("");
      setContent("");
      setTags("");
      setWriting(false);
      setOffset(0);
      setFilter("");
      setMessage(t("反馈已发布，谢谢你帮我们变得更好。"));
      await utils.feedback.list.invalidate();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : t("提交失败，请重试。")
      );
    } finally {
      lock.current = false;
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (!submit.isPending) setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring rounded-sm"
        >
          {t("赚算力")}
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("赚算力")}</DialogTitle>
          <DialogDescription>
            {t(
              "说说哪里不好用，或分享你喜欢的地方。反馈被采用后，送你 5 算力。"
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between gap-2">
          <select
            aria-label={t("反馈分类")}
            className={field + " max-w-48"}
            value={filter}
            onChange={event => {
              setFilter(event.target.value as Category | "");
              setOffset(0);
            }}
          >
            <option value="">{t("全部反馈")}</option>
            {Object.entries(feedbackCategoryLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {t(label)}
              </option>
            ))}
          </select>
          <button
            className={button}
            onClick={() => setWriting(value => !value)}
          >
            {t(writing ? "收起" : "写反馈")}
          </button>
        </div>
        {writing && (
          <form
            className="space-y-3 border-y border-border py-4"
            onSubmit={event => {
              event.preventDefault();
              void send();
            }}
          >
            <p className="text-xs text-muted-foreground">
              {t("发布后其他用户也能看到，请勿填写邮箱、密码或私人故事。")}
            </p>
            <label className="block text-sm">
              {t("反馈类型")}
              <select
                className={field}
                value={category}
                onChange={event => setCategory(event.target.value as Category)}
                disabled={submit.isPending}
              >
                {Object.entries(feedbackCategoryLabels).map(([key, label]) => (
                  <option key={key} value={key}>
                    {t(label)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              {t("标题")}
              <input
                required
                minLength={2}
                maxLength={120}
                className={field}
                value={title}
                onChange={event => setTitle(event.target.value)}
                disabled={submit.isPending}
              />
            </label>
            <label className="block text-sm">
              {t("具体说说")}
              <textarea
                required
                minLength={5}
                maxLength={4000}
                rows={4}
                className={field}
                placeholder={t(
                  category === "bug"
                    ? "你做了什么？哪里出错？原本希望发生什么？"
                    : "你的想法、建议或喜欢的地方…"
                )}
                value={content}
                onChange={event => setContent(event.target.value)}
                disabled={submit.isPending}
              />
            </label>
            <label className="block text-sm">
              {t("标签（最多5个，用逗号分隔）")}
              <input
                className={field}
                maxLength={104}
                placeholder={t("例如：手机端，聊天，图片")}
                value={tags}
                onChange={event => setTags(event.target.value)}
                disabled={submit.isPending}
              />
            </label>
            <button
              type="submit"
              className={button + " bg-primary text-primary-foreground"}
              disabled={submit.isPending}
            >
              {t(submit.isPending ? "正在提交…" : "发布反馈")}
            </button>
          </form>
        )}
        {message && (
          <p role="status" className="text-sm">
            {message}
          </p>
        )}
        {list.isPending && <p role="status">{t("正在加载…")}</p>}
        {list.isError && (
          <p role="alert">
            {t("反馈加载失败。")}
            <button className={button} onClick={() => void list.refetch()}>
              {t("重试")}
            </button>
          </p>
        )}
        {list.data?.posts.length === 0 && (
          <p className="py-6 text-center text-muted-foreground">
            {t("还没有反馈，来写第一条吧。")}
          </p>
        )}
        {list.data?.posts.map(post => (
          <article
            key={post.id}
            className="border-b border-border py-3 space-y-2"
          >
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span>{t(feedbackCategoryLabels[post.category])}</span>
              <span>{t(feedbackStatusLabels[post.status])}</span>
              {post.isOwn && <span>{t("我的反馈")}</span>}
            </div>
            <h3 className="font-medium break-words">{post.title}</h3>
            <p className="whitespace-pre-wrap break-words text-sm leading-6">
              {post.content}
            </p>
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              {post.tags.map(tag => (
                <span key={tag}>#{tag}</span>
              ))}
              <time>{new Date(post.createdAt).toLocaleDateString()}</time>
            </div>
            {post.reply && (
              <p className="rounded-lg bg-muted p-3 text-sm whitespace-pre-wrap break-words">
                {t("团队回复")}: {post.reply}
              </p>
            )}
            {list.data.canReview && post.status !== "adopted" && (
              <FeedbackReview
                id={post.id}
                reply={post.reply ?? ""}
                adopting={post.status === "adopting"}
              />
            )}
          </article>
        ))}
        <div className="flex justify-between">
          <button
            className={button}
            disabled={!offset}
            onClick={() => setOffset(Math.max(0, offset - 20))}
          >
            {t("上一页")}
          </button>
          <button
            className={button}
            disabled={!list.data?.hasMore}
            onClick={() => setOffset(offset + 20)}
          >
            {t("下一页")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
function FeedbackReview({
  id,
  reply: initial,
  adopting,
}: {
  id: string;
  reply: string;
  adopting: boolean;
}) {
  const t = useUiText();
  const utils = trpc.useUtils();
  const [reply, setReply] = useState(initial);
  const [error, setError] = useState("");
  const review = trpc.feedback.review.useMutation({ retry: false });
  async function run(action: "adopt" | "review" | "close") {
    setError("");
    try {
      await review.mutateAsync({ id, reply, action });
      await Promise.all([
        utils.feedback.list.invalidate(),
        utils.computeAccount.balance.invalidate(),
        utils.computeAccount.statement.invalidate(),
      ]);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t("操作失败，请重试。")
      );
    }
  }
  return (
    <details className="text-sm">
      <summary className="cursor-pointer py-2 text-primary">
        {t("管理这条反馈")}
      </summary>
      <textarea
        aria-label={t("团队回复")}
        className={field}
        rows={2}
        maxLength={2000}
        value={reply}
        onChange={event => setReply(event.target.value)}
        disabled={adopting || review.isPending}
      />
      <div className="flex flex-wrap gap-1">
        {!adopting && (
          <>
            <button
              className={button}
              disabled={review.isPending}
              onClick={() => void run("review")}
            >
              {t("标记处理中")}
            </button>
            <button
              className={button}
              disabled={review.isPending || !reply.trim()}
              onClick={() => void run("close")}
            >
              {t("回复并完成")}
            </button>
          </>
        )}
        <button
          className={button}
          disabled={review.isPending}
          onClick={() => void run("adopt")}
        >
          {t(adopting ? "继续发放奖励" : "采用并赠送 5 算力")}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </details>
  );
}
