import { exportStoryTimeline, type ExportResult, type TimelineExportStage } from "./videoExport";

type ExportOptions = Omit<Parameters<typeof exportStoryTimeline>[0], "onStage">;

export type TimelineExportJob =
  | { status: "running"; stage: TimelineExportStage }
  | { status: "error"; stage: TimelineExportStage; error: string }
  | Extract<ExportResult, { status: "ok" }>;

const jobs = new Map<string, TimelineExportJob>();

export function getTimelineExportJob(userId: number, storyId: number): TimelineExportJob | null {
  return jobs.get(`${userId}:${storyId}`) ?? null;
}

export function startTimelineExportJob(options: ExportOptions): TimelineExportJob {
  const key = `${options.userId}:${options.storyId}`;
  const current = jobs.get(key);
  if (current?.status === "running") return current;
  let stage: TimelineExportStage = "preparing";
  const initial = { status: "running", stage } as const;
  jobs.set(key, initial);

  const finish = (result: ExportResult) => {
    const completed = result.status === "error" ? { ...result, stage } : result;
    jobs.set(key, completed);
    setTimeout(() => {
      if (jobs.get(key) === completed) jobs.delete(key);
    }, 60 * 60_000).unref();
  };

  void exportStoryTimeline({
    ...options,
    onStage: next => {
      stage = next;
      jobs.set(key, { status: "running", stage });
    },
  }).then(finish, (cause: unknown) => {
    finish({ status: "error", error: cause instanceof Error ? cause.message : "导出失败" });
  });
  return initial;
}
