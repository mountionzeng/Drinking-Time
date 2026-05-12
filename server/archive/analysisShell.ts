import type { AnalysisResult, Project, Reference, Shot } from "../../drizzle/schema";
import {
  getProjectAnalysis,
  getProjectReferences,
  getProjectShots,
  getUserProjects,
} from "../db";
import { getTodayNayin } from "../../client/src/features/nayin/nayin";

const STAGE_FLOW = [
  "idea_pool",
  "requirement_pool",
  "structured",
  "production_ready",
  "queued",
  "rendered",
] as const;

type StageKey = (typeof STAGE_FLOW)[number] | "blocked";

type ArchiveShot = {
  id: string;
  name: string;
  stages: StageKey[];
};

type ArchiveScene = {
  id: string;
  name: string;
  shots: ArchiveShot[];
};

type ArchiveProject = {
  id: string;
  code: string;
  name: string;
  shotCount: number;
  scenes: ArchiveScene[];
};

type ArchiveTimelineEvent = {
  time: string;
  stage: StageKey;
  shot: string;
  title: string;
  detail: string;
  actor: string;
  actorAccent: boolean;
  isNow?: boolean;
};

type ArchiveTimelineDay = {
  day: string;
  dow: string;
  events: ArchiveTimelineEvent[];
};

type ArchiveShellState = {
  today: {
    dateChip: string;
    lunarChip: string;
    nayinChip: string;
    nayinName: string;
    ganzhi: string;
    element: string;
    elementCn: string;
  };
  summary: {
    projectsCount: number;
    shotsCount: number;
    onTimeRate: number;
  };
  mode: {
    stageKey: StageKey;
  };
  projects: ArchiveProject[];
  timeline: ArchiveTimelineDay[];
};

type ProjectBundle = {
  project: Project;
  references: Reference[];
  shots: Shot[];
  analysis: AnalysisResult | null;
};

type TimelineDraft = {
  at: Date;
  stage: StageKey;
  shot: string;
  title: string;
  detail: string;
  actor: string;
  actorAccent: boolean;
  isNow?: boolean;
};

const stageLabelMap: Record<StageKey, string> = {
  idea_pool: "IDEA POOL",
  requirement_pool: "REQUIREMENT POOL",
  structured: "STRUCTURED",
  production_ready: "PRODUCTION READY",
  queued: "QUEUED",
  rendered: "RENDERED",
  blocked: "BLOCKED",
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function trimLabel(text: string | null | undefined, fallback: string, max: number = 26) {
  const source = (text ?? "").replace(/\s+/g, " ").trim();
  if (!source) return fallback;
  if (source.length <= max) return source;
  return `${source.slice(0, max - 1)}…`;
}

function parseDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function formatParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    weekday: get("weekday").toUpperCase(),
  };
}

function toTimelineGrouping(date: Date) {
  const parts = formatParts(date);
  return {
    day: `${parts.month} · ${parts.day}`,
    dow: parts.weekday,
    year: parts.year,
    time: `${parts.hour}:${parts.minute}`,
  };
}

function stageTrail(status: Shot["status"]): StageKey[] {
  if (status === "blocked") {
    return ["idea_pool", "requirement_pool", "structured", "blocked"];
  }
  const stage = status as StageKey;
  const index = STAGE_FLOW.indexOf(stage as (typeof STAGE_FLOW)[number]);
  if (index === -1) return [];
  return [...STAGE_FLOW.slice(0, index + 1)];
}

function stageWeight(stage: StageKey) {
  return stage === "blocked" ? 3 : STAGE_FLOW.indexOf(stage as (typeof STAGE_FLOW)[number]);
}

function deriveMode(bundleList: ProjectBundle[]): StageKey {
  const shots = bundleList.flatMap((bundle) => bundle.shots);
  if (shots.length > 0) {
    const latestShot = [...shots].sort(
      (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime(),
    )[0];
    return latestShot.status as StageKey;
  }

  const latestAnalysis = bundleList
    .map((bundle) => bundle.analysis)
    .filter((analysis): analysis is AnalysisResult => Boolean(analysis))
    .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())[0];
  if (latestAnalysis) return "structured";

  const refCount = bundleList.reduce((count, bundle) => count + bundle.references.length, 0);
  if (refCount > 0) return "requirement_pool";

  return "idea_pool";
}

function computeOnTimeRate(shots: Shot[]) {
  if (shots.length === 0) return 0;

  const datedShots = shots.filter((shot) => parseDate(shot.deadline));
  if (datedShots.length > 0) {
    const now = new Date();
    const timely = datedShots.filter((shot) => {
      const deadline = parseDate(shot.deadline);
      if (!deadline) return false;
      return shot.status === "rendered" || deadline.getTime() >= now.getTime();
    }).length;
    return Math.round((timely / datedShots.length) * 100);
  }

  const healthy = shots.filter((shot) => shot.status !== "blocked").length;
  return Math.round((healthy / shots.length) * 100);
}

function buildProjectView(bundle: ProjectBundle): ArchiveProject {
  const shotsByScene = new Map<string, Shot[]>();
  for (const shot of bundle.shots) {
    const sceneKey = shot.sceneNo || "SC·00";
    const current = shotsByScene.get(sceneKey) ?? [];
    current.push(shot);
    shotsByScene.set(sceneKey, current);
  }

  const scenes: ArchiveScene[] = Array.from(shotsByScene.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([sceneNo, shots]) => ({
      id: sceneNo,
      name: escapeHtml(`Scene ${sceneNo}`),
      shots: [...shots]
        .sort((left, right) => left.shotNo.localeCompare(right.shotNo))
        .map((shot) => ({
          id: escapeHtml(shot.shotNo),
          name: escapeHtml(trimLabel(
            shot.sourceSummary,
            `${shot.sceneNo} · ${shot.shotNo}`,
          )),
          stages: stageTrail(shot.status),
        })),
    }));

  return {
    id: `P${String(bundle.project.id).padStart(2, "0")}`,
    code: `PID·${String(bundle.project.id).padStart(2, "0")}`,
    name: escapeHtml(bundle.project.name),
    shotCount: bundle.shots.length,
    scenes,
  };
}

function buildTimeline(bundleList: ProjectBundle[]): ArchiveTimelineDay[] {
  const draftEvents: TimelineDraft[] = [];

  for (const bundle of bundleList) {
    draftEvents.push({
      at: bundle.project.createdAt,
      stage: "idea_pool",
      shot: `P${String(bundle.project.id).padStart(2, "0")}`,
      title: escapeHtml(`${bundle.project.name} · 项目建立`),
      detail: "新的分析项目已经创建，工坊台账开始记录本次任务。",
      actor: "D · Director",
      actorAccent: false,
    });

    for (const reference of bundle.references) {
      draftEvents.push({
        at: reference.createdAt,
        stage: "requirement_pool",
        shot: `P${String(bundle.project.id).padStart(2, "0")}`,
        title: escapeHtml(`${trimLabel(reference.title, "素材文件", 20)} · 加入素材池`),
        detail: escapeHtml(`${reference.sourceType.toUpperCase()} 已接入，等待进一步整理与拆解。`),
        actor: "D · Director",
        actorAccent: false,
      });
    }

    if (bundle.analysis) {
      draftEvents.push({
        at: bundle.analysis.updatedAt,
        stage: "structured",
        shot: `P${String(bundle.project.id).padStart(2, "0")}`,
        title: escapeHtml(`${bundle.project.name} · 环境模板更新`),
        detail: escapeHtml(trimLabel(bundle.analysis.summary, "分析引擎已生成新的环境模板与提示词草稿。", 56)),
        actor: "DT · 工坊",
        actorAccent: true,
      });
    }

    for (const shot of bundle.shots) {
      draftEvents.push({
        at: shot.updatedAt,
        stage: shot.status as StageKey,
        shot: escapeHtml(`${shot.sceneNo} · ${shot.shotNo}`),
        title: escapeHtml(`${trimLabel(shot.sourceSummary, `${shot.sceneNo} ${shot.shotNo}`, 22)} · ${stageLabelMap[shot.status as StageKey]}`),
        detail: escapeHtml(
          shot.nextAction?.trim() ||
            shot.promptDraft?.trim() ||
            "镜头卡已同步到分析台账，等待下一步推进。",
        ),
        actor: shot.status === "idea_pool" ? "D · Director" : "DT · 工坊",
        actorAccent: shot.status !== "idea_pool",
      });
    }
  }

  const sortedEvents = draftEvents.sort((left, right) => right.at.getTime() - left.at.getTime());
  if (sortedEvents.length > 0) {
    sortedEvents[0].isNow = true as boolean;
  }

  const grouped = new Map<string, ArchiveTimelineDay>();
  for (const event of sortedEvents) {
    const parts = toTimelineGrouping(event.at);
    const key = `${parts.year}-${parts.day}-${parts.dow}`;
    const dayGroup = grouped.get(key) ?? {
      day: parts.day,
      dow: parts.dow,
      events: [],
    };
    dayGroup.events.push({
      time: parts.time,
      stage: event.stage,
      shot: event.shot,
      title: event.title,
      detail: event.detail,
      actor: event.actor,
      actorAccent: event.actorAccent,
      isNow: event.isNow,
    });
    grouped.set(key, dayGroup);
  }

  return Array.from(grouped.values());
}

export async function buildArchiveAnalysisShell(userId: number): Promise<ArchiveShellState> {
  const today = getTodayNayin();
  const projects = await getUserProjects(userId);
  const bundles: ProjectBundle[] = await Promise.all(
    projects.map(async (project) => ({
      project,
      references: await getProjectReferences(project.id),
      shots: await getProjectShots(project.id),
      analysis: await getProjectAnalysis(project.id),
    })),
  );

  const allShots = bundles.flatMap((bundle) => bundle.shots);
  const projectsView = bundles.map(buildProjectView);
  const mode = deriveMode(bundles);

  return {
    today: {
      dateChip: `CST ${today.cstDateStr}`,
      lunarChip: `农历 ${today.lunar.yearGanzhi}年 ${today.lunar.monthCn}${today.lunar.dayCn}`,
      nayinChip: `日柱 ${today.ganzhi} · 纳音 ${today.nayinName}`,
      nayinName: today.nayinName,
      ganzhi: today.ganzhi,
      element: today.theme.element,
      elementCn: today.theme.elementCn,
    },
    summary: {
      projectsCount: projects.length,
      shotsCount: allShots.length,
      onTimeRate: computeOnTimeRate(allShots),
    },
    mode: {
      stageKey: mode,
    },
    projects: projectsView,
    timeline: buildTimeline(bundles),
  };
}
