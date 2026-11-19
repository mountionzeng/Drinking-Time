const prefix = "video-feedback-activity:";
export const feedbackActivityId = (feedbackId: string) => prefix + feedbackId;
export const isFeedbackActivityId = (id: string) => id.startsWith(prefix);
export const waitingFeedbackActivity = "等待制作\n反馈已记录，等待开始制作";
const phases = ["等待制作", "制作中", "制作完成", "制作失败"] as const;
type Phase = (typeof phases)[number];

/** The ordinary chat transcript also stays readable by older clients. */
export function readFeedbackActivity(text: string) {
  const [phase, ...lines] = text.split("\n");
  if (!phases.includes(phase as Phase)) return null;
  const steps = lines.filter(line => line.trim().length > 0);
  return steps.length ? { phase: phase as Phase, steps, latest: steps[steps.length - 1] } : null;
}

export function storedFeedbackActivity(body: unknown, id: string) {
  if (!isFeedbackActivityId(id) || !body || typeof body !== "object" || !("messages" in body) || !Array.isArray(body.messages)) return null;
  const row = body.messages.find(row => row?.id === id && row.who === "s");
  return typeof row?.text === "string" ? readFeedbackActivity(row.text) : null;
}
