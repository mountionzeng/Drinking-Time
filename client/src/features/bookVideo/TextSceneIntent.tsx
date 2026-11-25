import { useState } from "react";
import { intentAnswer, textSceneIntent } from "@shared/textSceneIntent";
import type { SceneLayout } from "@shared/shotSceneDirection";
import { useUiText } from "@/features/uiLanguage/UiLanguage";

export function useTextSceneIntent(scope: string, source: string, established: string, layout?: SceneLayout) {
  const review = textSceneIntent(source, established, layout);
  const [reply, setReply] = useState<{ scope: string; source: string; question: typeof review.question; value: string }>();
  const active = reply?.scope === scope && reply.source === source && reply.value ? reply : undefined;
  // A quote or a richer reading can arrive while someone is answering. Keep the
  // original question with that answer until they clear it or the source changes.
  const question = active ? active.question : review.question;
  const value = active?.value ?? "";
  return { ...review, question, value, direction: intentAnswer(question, value),
    setValue: (value: string) => setReply({ scope, source, question, value }),
    clear: () => setReply(undefined) };
}

export function TextSceneIntentReview({ review, disabled }: { review: ReturnType<typeof useTextSceneIntent>; disabled: boolean }) {
  const ui = useUiText();
  const q = review.question;
  const label = !q ? ui("补充或纠正画面（可选）") : q.kind === "gaze" ? ui("这一刻，{0}看向哪里？", [q.focus]) :
    q.kind === "position" ? ui("画面里，{0}的位置怎么安排？", [q.focus]) :
    q.kind === "actor" ? ui("「{0}」说的是谁？", [q.focus]) :
    q.kind === "model" ? ui("这处细节你想怎么画？{0}", [q.focus]) : ui("这里具体要画什么场景？");
  return <section aria-label={ui("出图前读一遍文字")} className="space-y-1 text-sm">
    {!!review.beats.length && <>
      <p className="font-medium">{ui("这一帧要画什么")}</p>
      <ul className="max-h-28 space-y-0.5 overflow-y-auto">{review.beats.map((beat, i) => {
        const start = beat.subject ? beat.evidence.indexOf(beat.subject) : -1;
        return <li key={i}>{start < 0 ? beat.evidence : <>{beat.evidence.slice(0, start)}<strong>{beat.subject}</strong>{beat.evidence.slice(start + beat.subject.length)}</>}</li>;
      })}</ul>
    </>}
    <label className="block">{label}
      <input className="mt-1 w-full rounded border bg-transparent px-2 py-1" value={review.value} maxLength={450}
        disabled={disabled} placeholder={ui("可留空，沿用原文")} onChange={e => review.setValue(e.target.value)} />
    </label>
  </section>;
}
