import { ArrowLeft, BookOpenText, Loader2, LogOut, Waves } from "lucide-react";
import type { StorySoundDirectorController } from "./useStorySoundDirector";

const CATEGORY_LABEL = {
  global: "整体方向",
  dialogue: "人物对白",
  narration: "旁白",
  music: "配乐",
  ambience: "环境声",
  sfx: "音效",
} as const;

export function SoundDirectorQuestionCard({
  director,
}: {
  director: StorySoundDirectorController;
}) {
  const { session } = director;
  if (!director.active || !session || !session.question) return null;
  const { question, interview } = session;
  const current = Math.min(
    (interview?.currentStepIndex ?? 0) + 1,
    interview?.questions.length ?? 1
  );
  const total = interview?.questions.length ?? 1;

  return (
    <article
      aria-labelledby={`sound-question-${question.id}`}
      className="w-[96%] overflow-hidden rounded-lg border bg-card text-foreground shadow-sm"
      style={{ borderColor: "var(--nayin-accent-dim)" }}
      data-testid="sound-director-question"
    >
      <header
        className="flex items-start gap-2 border-b px-3 py-2.5"
        style={{ borderColor: "var(--panel-border)" }}
      >
        <span className="mt-0.5 rounded-full bg-[var(--nayin-glow)] p-1.5 text-nayin-bright">
          <Waves className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
            <span>声音导演</span>
            <span>·</span>
            <span>{CATEGORY_LABEL[question.category]}</span>
            <span className="ml-auto normal-case">
              {current}/{total}
            </span>
          </div>
          <div
            className="mt-1 h-1 overflow-hidden rounded-full bg-muted"
            aria-hidden="true"
          >
            <div
              className="h-full rounded-full bg-[var(--nayin-accent)] transition-[width] duration-300"
              style={{ width: `${Math.max(6, (current / total) * 100)}%` }}
            />
          </div>
        </div>
      </header>
      <div className="px-3 py-3">
        <h3
          id={`sound-question-${question.id}`}
          className="text-[12.5px] font-semibold leading-relaxed"
        >
          {question.prompt}
        </h3>
        <p className="mt-1 flex items-start gap-1.5 text-[10px] leading-relaxed text-muted-foreground">
          <BookOpenText className="mt-0.5 h-3 w-3 shrink-0" />
          {question.why}
        </p>
        {question.sourceText ? (
          <blockquote className="mt-2 border-l-2 border-[var(--nayin-accent-dim)] pl-2 text-[10px] leading-relaxed text-muted-foreground">
            依据：{question.sourceText}
          </blockquote>
        ) : null}
        <div
          className="mt-2.5 grid gap-1.5"
          role="group"
          aria-label="声音问题选项"
        >
          {question.options.map(option => (
            <button
              key={option.id}
              type="button"
              disabled={director.pending}
              onClick={() => void director.answer({ optionId: option.id })}
              className="rounded-md border border-border px-2.5 py-2 text-left text-[10.5px] leading-relaxed transition hover:border-[var(--nayin-accent)] hover:bg-[var(--nayin-glow)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)] disabled:opacity-50"
            >
              {option.label}
            </button>
          ))}
        </div>
        {question.freeTextAllowed ? (
          <p className="mt-2 text-[9.5px] text-muted-foreground">
            也可以直接在下方聊天框说自己的答案。
          </p>
        ) : null}
      </div>
      <footer
        className="flex items-center gap-1.5 border-t px-3 py-2"
        style={{ borderColor: "var(--panel-border)" }}
      >
        <button
          type="button"
          onClick={() => void director.goBack()}
          disabled={
            director.pending || (interview?.currentStepIndex ?? 0) === 0
          }
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted disabled:opacity-35"
        >
          <ArrowLeft className="h-3 w-3" />
          上一题
        </button>
        <button
          type="button"
          onClick={director.exit}
          className="ml-auto inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted"
        >
          <LogOut className="h-3 w-3" />
          暂停，回到普通聊天
        </button>
        {director.pending ? (
          <Loader2
            className="h-3 w-3 animate-spin text-muted-foreground"
            aria-label="正在保存回答"
          />
        ) : null}
      </footer>
    </article>
  );
}
