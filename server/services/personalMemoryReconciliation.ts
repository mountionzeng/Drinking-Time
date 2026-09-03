/**
 * 个人记忆持续对账（U4）。
 *
 * 这里只做**发现**，不做修复：把「系统自己知道自己不一致」的地方找出来并
 * 分类，修复动作走各自的幂等合同。之所以拆开，是因为对账要能在任何时刻安全
 * 地跑——包括召回还关着、runner 还没启动的现在。
 *
 * 扫描项与计划里的清单一一对应：活跃经历没有成功提炼、活跃理解只剩失效来源、
 * 卡死的 lease、孤立证据边、索引状态不一致、来信隐私 payload 残留。
 */
import type {
  PersonalMemoryLocalState,
  PersonalMemoryLetterVersionRecord,
} from "../../shared/personalMemory";

export type ReconciliationFindingKind =
  /** 经历存在，但它的提炼任务永久失败或根本没排上——足迹会缺一块理解。 */
  | "event_without_extraction"
  /** 理解还活着，但它依赖的经历已经被 scrub 了内容——失据，必须退出召回。 */
  | "insight_without_evidence"
  /** 任务 claim 了却过期没回来——进程崩在外部调用里，lease 要回收。 */
  | "stuck_lease"
  /** 证据边指向不存在的理解或经历。 */
  | "orphan_evidence"
  /** 来信版本的 payload 还引用着已被 scrub 的经历——删除没有传播干净。 */
  | "letter_payload_residue";

export type ReconciliationFinding = {
  kind: ReconciliationFindingKind;
  userId: number;
  /** 定位用的稳定标识，不含用户原话。 */
  ref: string;
  detail: string;
};

export type ReconciliationReport = {
  scannedAt: string;
  /** 按类型汇总，便于做趋势指标（漂移应当收敛而不是持续增长）。 */
  counts: Record<ReconciliationFindingKind, number>;
  findings: ReconciliationFinding[];
};

export type ReconciliationOptions = {
  now?: Date;
  /** 单次报告最多列出多少条，避免一份报告本身变成事故。 */
  limit?: number;
};

const EMPTY_COUNTS: Record<ReconciliationFindingKind, number> = {
  event_without_extraction: 0,
  insight_without_evidence: 0,
  stuck_lease: 0,
  orphan_evidence: 0,
  letter_payload_residue: 0,
};

/** 任务处于「不会再自己往前走」的终态：需要人来看一眼。 */
const DEAD_JOB_STATES = new Set(["permanently_failed", "cancelled"]);

/**
 * 纯函数对账。输入是一份个人记忆状态快照，输出是发现列表。
 *
 * 刻意不接受数据库句柄：这样 MySQL 与本地两条路径可以各自把状态读出来再喂
 * 进同一套判定，两边不会各写一套规则然后慢慢漂移。
 */
export function reconcilePersonalMemory(
  state: PersonalMemoryLocalState,
  options: ReconciliationOptions = {}
): ReconciliationReport {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 500;
  const findings: ReconciliationFinding[] = [];
  const counts = { ...EMPTY_COUNTS };

  const push = (finding: ReconciliationFinding) => {
    counts[finding.kind] += 1;
    if (findings.length < limit) findings.push(finding);
  };

  const eventById = new Map(state.events.map(event => [event.id, event]));
  const insightById = new Map(
    state.insights.map(insight => [insight.id, insight])
  );

  // ① 经历有了，但提炼没成。Phase 1 里 runner 还没启动，所以只统计**死掉的**
  //    任务和**压根没排上**的经历；pending 是预期状态，不算漂移。
  const jobsByEvent = new Map<number, (typeof state.jobs)[number][]>();
  for (const job of state.jobs) {
    const list = jobsByEvent.get(job.eventId) ?? [];
    list.push(job);
    jobsByEvent.set(job.eventId, list);
  }
  for (const event of state.events) {
    if (event.contentScrubbed) continue; // 已清内容的 tombstone 本就不提炼
    const jobs = jobsByEvent.get(event.id) ?? [];
    if (jobs.length === 0) {
      push({
        kind: "event_without_extraction",
        userId: event.userId,
        ref: `event:${event.id}`,
        detail: "经历没有任何提炼任务",
      });
      continue;
    }
    if (jobs.every(job => DEAD_JOB_STATES.has(job.state))) {
      push({
        kind: "event_without_extraction",
        userId: event.userId,
        ref: `event:${event.id}`,
        detail: `全部任务处于终态：${jobs.map(job => job.state).join(",")}`,
      });
    }
  }

  // ② 卡死的 lease：claim 了但租约已过期。进程大概率崩在外部调用里。
  for (const job of state.jobs) {
    if (job.state !== "claimed") continue;
    const expiresAt = job.leaseExpiresAt ? new Date(job.leaseExpiresAt) : null;
    if (expiresAt && expiresAt.getTime() < now.getTime()) {
      push({
        kind: "stuck_lease",
        userId: job.userId,
        ref: `job:${job.id}`,
        detail: `lease 于 ${job.leaseExpiresAt} 过期仍未归还`,
      });
    }
  }

  // ③ 孤立证据边。
  for (const edge of state.evidence) {
    const missing: string[] = [];
    if (!insightById.has(edge.insightId)) missing.push("insight");
    if (!eventById.has(edge.eventId)) missing.push("event");
    if (missing.length > 0) {
      push({
        kind: "orphan_evidence",
        userId: edge.userId,
        ref: `evidence:${edge.id}`,
        detail: `指向不存在的 ${missing.join(" 与 ")}`,
      });
    }
  }

  // ④ 活跃理解的最后一个有效来源没了。多来源理解删掉其中一个仍然有依据，
  //    所以这里要求**全部**证据失效才算失据。
  const edgesByInsight = new Map<number, (typeof state.evidence)[number][]>();
  for (const edge of state.evidence) {
    const list = edgesByInsight.get(edge.insightId) ?? [];
    list.push(edge);
    edgesByInsight.set(edge.insightId, list);
  }
  for (const insight of state.insights) {
    if (insight.state !== "active") continue;
    const edges = edgesByInsight.get(insight.id) ?? [];
    const stillSupported = edges.some(edge => {
      const event = eventById.get(edge.eventId);
      return Boolean(event) && !event!.contentScrubbed;
    });
    if (!stillSupported) {
      push({
        kind: "insight_without_evidence",
        userId: insight.userId,
        ref: `insight:${insight.id}`,
        detail:
          edges.length === 0
            ? "活跃理解没有任何证据边"
            : "全部证据来源已被删除或清除内容",
      });
    }
  }

  // ⑤ 来信隐私 payload 残留：版本还引用着已被 scrub 的经历。
  //    删除必须传播到历史来信的摘录，否则「忘记」只是表面功夫。
  for (const version of state.letterVersions) {
    for (const ref of residualEvidenceRefs(version, eventById)) {
      push({
        kind: "letter_payload_residue",
        userId: version.userId,
        ref: `letter:${version.id}`,
        detail: `payload 仍引用已清除内容的经历 ${ref}`,
      });
    }
  }

  return { scannedAt: now.toISOString(), counts, findings };
}

function residualEvidenceRefs(
  version: PersonalMemoryLetterVersionRecord,
  eventById: Map<number, { contentScrubbed: boolean }>
): string[] {
  if (!version.payload) return []; // 整份 payload 已 scrub，没有残留
  const refs: string[] = [];
  for (const selected of version.payload.selectedEvidence) {
    for (const eventId of selected.eventIds) {
      const event = eventById.get(eventId);
      if (!event || event.contentScrubbed) refs.push(`event:${eventId}`);
    }
  }
  return refs;
}

/** 报告里有没有需要动手的项。空报告是健康状态。 */
export function hasReconciliationDrift(report: ReconciliationReport): boolean {
  return Object.values(report.counts).some(count => count > 0);
}
