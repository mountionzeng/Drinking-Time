import { trpc } from "@/lib/trpc";
import { useEffect, useRef } from "react";

type Surface = "studio" | "mobile" | "book";

function send(mutate: ReturnType<typeof trpc.activityJourney.record.useMutation>["mutate"], input: {
  event: "creation.entered" | "result.opened" | "recharge.opened" | "session.ended";
  surface?: Surface;
  subjectKind?: "image" | "video";
  subjectRef?: number;
  dedupeKey: string;
}) {
  mutate(input, { onError() { /* 记录失败不影响创作、扣费或支付。 */ } });
}

export function journeyKey(prefix: string, value: string): string {
  const cleaned = `${prefix}${value}`.toLowerCase().replace(/[^a-z0-9_:-]/g, "");
  return cleaned.length >= 8 ? cleaned.slice(0, 64) : `${cleaned}journey`.slice(0, 64);
}

/** 进入网站创作页。每小时同一界面只报一次，失败被忽略。 */
export function JourneySurface({ surface }: { surface: Surface }) {
  const record = trpc.activityJourney.record.useMutation();
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    const hour = new Date().toISOString().slice(0, 13).replace(/[^0-9]/g, "");
    send(record.mutate, {
      event: "creation.entered",
      surface,
      dedupeKey: journeyKey("enter", `${surface}${hour}`),
    });
  }, [record.mutate, surface]);
  return null;
}

export function noteRechargeOpened(mutate: ReturnType<typeof trpc.activityJourney.record.useMutation>["mutate"]) {
  send(mutate, { event: "recharge.opened", dedupeKey: journeyKey("recharge", Date.now().toString(36)) });
}

export function noteResultOpened(
  mutate: ReturnType<typeof trpc.activityJourney.record.useMutation>["mutate"],
  subjectRef: number
) {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  send(mutate, {
    event: "result.opened",
    subjectKind: "image",
    subjectRef,
    dedupeKey: journeyKey("view", `${subjectRef}${day}`),
  });
}

export function noteSessionEnded(
  mutate: ReturnType<typeof trpc.activityJourney.record.useMutation>["mutate"],
  visitId: string
) {
  send(mutate, { event: "session.ended", dedupeKey: journeyKey("end", visitId) });
}
