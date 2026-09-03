import { describe, expect, it } from "vitest";
import { createEmptyPersonalMemoryLocalState } from "../../shared/personalMemory";
import type { PersonalMemoryLocalState } from "../../shared/personalMemory";
import {
  hasReconciliationDrift,
  reconcilePersonalMemory,
} from "./personalMemoryReconciliation";

const NOW = new Date("2026-09-03T12:00:00.000Z");

function state(build: (s: PersonalMemoryLocalState) => void): PersonalMemoryLocalState {
  const next = createEmptyPersonalMemoryLocalState();
  build(next);
  return next;
}

function event(id: number, overrides: Partial<PersonalMemoryLocalState["events"][number]> = {}) {
  return {
    id,
    userId: 7,
    sourceType: "chat_message" as const,
    sourceKey: `message:${id}`,
    sourceRevision: "1",
    actionKind: "submitted" as const,
    actionId: `a-${id}`,
    occurredOn: "2026-09-03",
    occurredAt: "2026-09-03T02:00:00.000Z",
    snapshot: { excerpt: "x", contentHash: null, display: null },
    contentScrubbed: false,
    createdAt: "2026-09-03T02:00:00.000Z",
    ...overrides,
  };
}

function job(id: number, eventId: number, overrides: Partial<PersonalMemoryLocalState["jobs"][number]> = {}) {
  return {
    id,
    userId: 7,
    eventId,
    operationId: `op-${id}`,
    extractorVersion: "v1",
    state: "pending" as const,
    attempts: 0,
    leaseToken: null,
    leaseExpiresAt: null,
    availableAt: "2026-09-03T02:00:00.000Z",
    lastErrorKind: null,
    createdAt: "2026-09-03T02:00:00.000Z",
    updatedAt: "2026-09-03T02:00:00.000Z",
    ...overrides,
  };
}

function insight(id: number, overrides: Partial<PersonalMemoryLocalState["insights"][number]> = {}) {
  return {
    id,
    userId: 7,
    lineageKey: `k-${id}`,
    revision: 1,
    state: "active" as const,
    origin: "inferred" as const,
    category: "preference" as const,
    text: "喜欢游泳",
    scope: null,
    confidence: 0.5,
    allowProactiveMention: false,
    supersededByInsightId: null,
    createdAt: "2026-09-03T02:00:00.000Z",
    updatedAt: "2026-09-03T02:00:00.000Z",
    ...overrides,
  };
}

describe("对账", () => {
  it("健康状态没有任何发现", () => {
    const report = reconcilePersonalMemory(
      state(s => {
        s.events.push(event(1));
        s.jobs.push(job(1, 1, { state: "succeeded" }));
        s.insights.push(insight(1));
        s.evidence.push({
          id: 1, userId: 7, insightId: 1, eventId: 1,
          sourceRevision: "1", createdAt: "2026-09-03T02:00:00.000Z",
        });
      }),
      { now: NOW }
    );
    expect(report.findings).toEqual([]);
    expect(hasReconciliationDrift(report)).toBe(false);
  });

  // Phase 1 里 runner 还没启动，pending 是**预期状态**。
  // 把它报成漂移会让第一份报告就淹没在噪音里。
  it("pending 任务不算漂移", () => {
    const report = reconcilePersonalMemory(
      state(s => {
        s.events.push(event(1));
        s.jobs.push(job(1, 1, { state: "pending" }));
      }),
      { now: NOW }
    );
    expect(report.counts.event_without_extraction).toBe(0);
  });

  it("经历压根没排上任务时报出来", () => {
    const report = reconcilePersonalMemory(
      state(s => { s.events.push(event(1)); }),
      { now: NOW }
    );
    expect(report.counts.event_without_extraction).toBe(1);
    expect(report.findings[0].ref).toBe("event:1");
  });

  it("任务全部进终态时报出来", () => {
    const report = reconcilePersonalMemory(
      state(s => {
        s.events.push(event(1));
        s.jobs.push(job(1, 1, { state: "permanently_failed" }));
      }),
      { now: NOW }
    );
    expect(report.counts.event_without_extraction).toBe(1);
  });

  // 已清内容的 tombstone 本来就不该提炼，报它是噪音。
  it("已 scrub 的经历不要求提炼", () => {
    const report = reconcilePersonalMemory(
      state(s => { s.events.push(event(1, { contentScrubbed: true })); }),
      { now: NOW }
    );
    expect(report.counts.event_without_extraction).toBe(0);
  });

  it("过期 lease 被识别为卡死", () => {
    const report = reconcilePersonalMemory(
      state(s => {
        s.events.push(event(1));
        s.jobs.push(job(1, 1, {
          state: "claimed",
          leaseToken: "t",
          leaseExpiresAt: "2026-09-03T11:00:00.000Z",
        }));
      }),
      { now: NOW }
    );
    expect(report.counts.stuck_lease).toBe(1);
  });

  it("未过期的 lease 不报", () => {
    const report = reconcilePersonalMemory(
      state(s => {
        s.events.push(event(1));
        s.jobs.push(job(1, 1, {
          state: "claimed",
          leaseToken: "t",
          leaseExpiresAt: "2026-09-03T13:00:00.000Z",
        }));
      }),
      { now: NOW }
    );
    expect(report.counts.stuck_lease).toBe(0);
  });

  it("孤立证据边被找出来", () => {
    const report = reconcilePersonalMemory(
      state(s => {
        s.evidence.push({
          id: 1, userId: 7, insightId: 99, eventId: 98,
          sourceRevision: "1", createdAt: "2026-09-03T02:00:00.000Z",
        });
      }),
      { now: NOW }
    );
    expect(report.counts.orphan_evidence).toBe(1);
    expect(report.findings[0].detail).toContain("insight");
    expect(report.findings[0].detail).toContain("event");
  });

  // 多来源理解删掉其中一个仍然有依据——这条守住「不要一删就全清」。
  it("多来源理解只失去一个来源时仍然有依据", () => {
    const report = reconcilePersonalMemory(
      state(s => {
        s.events.push(event(1, { contentScrubbed: true }), event(2));
        s.jobs.push(job(1, 2, { state: "succeeded" }));
        s.insights.push(insight(1));
        s.evidence.push(
          { id: 1, userId: 7, insightId: 1, eventId: 1, sourceRevision: "1", createdAt: "x" },
          { id: 2, userId: 7, insightId: 1, eventId: 2, sourceRevision: "1", createdAt: "x" }
        );
      }),
      { now: NOW }
    );
    expect(report.counts.insight_without_evidence).toBe(0);
  });

  it("最后一个来源失效后理解被标为失据", () => {
    const report = reconcilePersonalMemory(
      state(s => {
        s.events.push(event(1, { contentScrubbed: true }));
        s.jobs.push(job(1, 1, { state: "succeeded" }));
        s.insights.push(insight(1));
        s.evidence.push({
          id: 1, userId: 7, insightId: 1, eventId: 1,
          sourceRevision: "1", createdAt: "x",
        });
      }),
      { now: NOW }
    );
    expect(report.counts.insight_without_evidence).toBe(1);
  });

  it("非活跃理解不参与失据判定", () => {
    const report = reconcilePersonalMemory(
      state(s => { s.insights.push(insight(1, { state: "archived" })); }),
      { now: NOW }
    );
    expect(report.counts.insight_without_evidence).toBe(0);
  });

  // 「忘记」如果只清了理解、没清历史来信里的摘录，就只是表面功夫。
  it("来信 payload 仍引用已清除内容的经历时报残留", () => {
    const report = reconcilePersonalMemory(
      state(s => {
        s.events.push(event(1, { contentScrubbed: true }));
        s.jobs.push(job(1, 1, { state: "succeeded" }));
        s.letterVersions.push({
          id: 1, userId: 7, letterDate: "2026-09-03",
          envelope: {
            versionNumber: 1, generatedAt: "x", trigger: "generated",
            selectorVersion: "s", promptVersion: "p", modelVersion: "m",
          },
          payload: {
            dailyReference: {}, analysisSeed: {}, userMessage: null,
            profileRevision: null, almanac: null,
            selectedEvidence: [{ insightId: 1, insightRevision: 1, eventIds: [1] }],
          },
          privacyEpoch: 1, actionId: "a", createdAt: "x",
        });
      }),
      { now: NOW }
    );
    expect(report.counts.letter_payload_residue).toBe(1);
  });

  it("payload 整份已 scrub 的版本没有残留", () => {
    const report = reconcilePersonalMemory(
      state(s => {
        s.events.push(event(1, { contentScrubbed: true }));
        s.jobs.push(job(1, 1, { state: "succeeded" }));
        s.letterVersions.push({
          id: 1, userId: 7, letterDate: "2026-09-03",
          envelope: {
            versionNumber: 1, generatedAt: "x", trigger: "generated",
            selectorVersion: "s", promptVersion: "p", modelVersion: "m",
          },
          payload: null, privacyEpoch: 1, actionId: "a", createdAt: "x",
        });
      }),
      { now: NOW }
    );
    expect(report.counts.letter_payload_residue).toBe(0);
  });

  it("limit 只裁剪列表，计数仍然完整——否则趋势指标会撒谎", () => {
    const report = reconcilePersonalMemory(
      state(s => { for (let i = 1; i <= 5; i += 1) s.events.push(event(i)); }),
      { now: NOW, limit: 2 }
    );
    expect(report.findings).toHaveLength(2);
    expect(report.counts.event_without_extraction).toBe(5);
  });
});
