import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useUiLanguage } from "@/features/uiLanguage/UiLanguage";
import { readFeedbackActivity } from "@shared/videoFeedbackActivity";

const english: Record<string,string> = {
  "正在准备树冠图层": "Preparing tree crown layers",
  "正在渲染林间飞行": "Rendering the forest flight",
  "正在核对首帧和入屏动作": "Checking the opening frame and screen entry",
  "反馈已记录，等待开始制作": "Feedback recorded · waiting for production",
};
const terminal = (phase?: string) => phase === "制作完成" || phase === "制作失败";

export function VideoFeedbackActivity({ storyId, id, text, localEdit }: { storyId: number; id: string; text: string; localEdit?: boolean }) {
  const {language} = useUiLanguage();
  const ref = useRef<HTMLDetailsElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const saved = readFeedbackActivity(text);
  const query = trpc.warehouseVideoSequence.feedbackActivity.useQuery({storyId, id}, {
    enabled: visible && !terminal(saved?.phase),
    refetchInterval: q => terminal(q.state.data?.phase) ? false : localEdit ? 750 : q.state.data?.phase === "制作中" ? 2000 : 8000,
    refetchIntervalInBackground: false,
  });
  const activity = terminal(saved?.phase) ? saved : query.data ?? saved;
  if (!activity) return <p>{text}</p>;
  const label = (s: string) => language === "en" ? english[s] ?? s : s;
  const stale = query.isError && !terminal(activity.phase);
  return <details ref={ref} aria-label="视频制作进度" className="group text-xs">
    <summary className="flex cursor-pointer list-none items-center gap-1 rounded py-0.5 text-muted-foreground focus-visible:outline focus-visible:outline-2">
      <span className="min-w-0" aria-live="polite">{stale ? (language === "en" ? "Reconnecting to progress…" : "正在重新连接制作进度") : label(activity.latest)}</span>
      <ChevronDown aria-hidden className="size-3 shrink-0 group-open:rotate-180" />
    </summary>
    <ol className="my-1 list-disc space-y-0.5 pl-4">{activity.steps.map((line,i) => <li key={i}>{label(line)}</li>)}</ol>
  </details>;
}
