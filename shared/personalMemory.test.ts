import { describe, expect, it } from "vitest";
import {
  appendPersonalMemoryOutboxEntry,
  applyPersonalMemoryCapture,
  canTransitionInsightState,
  createEmptyPersonalMemoryEventSnapshot,
  createEmptyPersonalMemoryLocalState,
  createEmptyPersonalMemoryOutbox,
  projectPersonalMemoryOutbox,
  currentLetterVersion,
  normalizePersonalMemoryEventIdentity,
  normalizePersonalMemoryLocalState,
  PersonalMemoryIdentityError,
  personalMemoryEventFingerprint,
  projectLetterRowFromVersion,
  type PersonalMemoryCapture,
  type PersonalMemoryEventIdentity,
  type PersonalMemoryLetterVersionRecord,
  STATEMENT_TYPES_WITHOUT_INSIGHTS,
  deriveInsightOrigin,
  reinforceInsightConfidence,
  decideInsightMutation,
  decideLineageStateChange,
  decideEvidenceLossOutcome,
  insightLineageTip,
  type PersonalMemoryInsightRecord,
} from "./personalMemory";

function identity(
  overrides: Partial<PersonalMemoryEventIdentity> = {}
): PersonalMemoryEventIdentity {
  return {
    userId: 7,
    sourceType: "chat_message",
    sourceKey: "message:1287",
    sourceRevision: "1",
    actionKind: "submitted",
    actionId: "client-msg-abc",
    ...overrides,
  };
}

describe("事件身份", () => {
  it("六段齐全时归一化并去掉首尾空白", () => {
    const normalized = normalizePersonalMemoryEventIdentity(
      identity({ sourceKey: "  message:1287  ", actionId: " client-msg-abc " })
    );
    expect(normalized.sourceKey).toBe("message:1287");
    expect(normalized.actionId).toBe("client-msg-abc");
  });

  // 这条是 U1 的承重约束：MySQL 唯一索引会放过任意多行 NULL，
  // 空串在这里等价于 NULL——一旦放过去就会静默制造重复经历。
  it.each([
    ["sourceKey", { sourceKey: "" }],
    ["sourceKey 只有空白", { sourceKey: "   " }],
    ["sourceRevision", { sourceRevision: "" }],
    ["actionId", { actionId: "" }],
  ])("%s 缺失时拒绝捕获", (_label, overrides) => {
    expect(() =>
      normalizePersonalMemoryEventIdentity(
        identity(overrides as Partial<PersonalMemoryEventIdentity>)
      )
    ).toThrow(PersonalMemoryIdentityError);
  });

  it("userId 必须是正整数", () => {
    expect(() =>
      normalizePersonalMemoryEventIdentity(identity({ userId: 0 }))
    ).toThrow(PersonalMemoryIdentityError);
    expect(() =>
      normalizePersonalMemoryEventIdentity(identity({ userId: 1.5 }))
    ).toThrow(PersonalMemoryIdentityError);
  });

  it("超长的来源标识被拒绝而不是被截断", () => {
    expect(() =>
      normalizePersonalMemoryEventIdentity(
        identity({ sourceKey: "m".repeat(192) })
      )
    ).toThrow(/191/);
  });

  it("动作必须属于该来源允许的集合", () => {
    expect(() =>
      normalizePersonalMemoryEventIdentity(
        identity({ sourceType: "image_adoption", actionKind: "submitted" })
      )
    ).toThrow(PersonalMemoryIdentityError);
    expect(() =>
      normalizePersonalMemoryEventIdentity(
        identity({
          sourceType: "image_adoption",
          sourceKey: "image:42",
          actionKind: "adopted",
        })
      )
    ).not.toThrow();
  });

  it("聊天消息不接受 revised —— 改文字属于每日留言语义", () => {
    expect(() =>
      normalizePersonalMemoryEventIdentity(identity({ actionKind: "revised" }))
    ).toThrow(PersonalMemoryIdentityError);
  });
});

describe("幂等指纹", () => {
  it("同一动作重放得到同一指纹", () => {
    expect(personalMemoryEventFingerprint(identity())).toBe(
      personalMemoryEventFingerprint(identity())
    );
  });

  it("不同用户的相同来源 ID 不会相撞", () => {
    expect(personalMemoryEventFingerprint(identity({ userId: 7 }))).not.toBe(
      personalMemoryEventFingerprint(identity({ userId: 8 }))
    );
  });

  it("同一来源的不同修订各自成事件", () => {
    expect(
      personalMemoryEventFingerprint(
        identity({ sourceType: "daily_letter_message", sourceRevision: "1" })
      )
    ).not.toBe(
      personalMemoryEventFingerprint(
        identity({ sourceType: "daily_letter_message", sourceRevision: "2" })
      )
    );
  });

  it("分段之间不会因为拼接而互相串味", () => {
    // sourceKey="a b" + revision="c" 与 sourceKey="a" + revision="b c"
    // 如果朴素拼接就会撞在一起。分隔符是 U+001F，任何一段都不允许包含它。
    const left = personalMemoryEventFingerprint(
      identity({ sourceType: "daily_letter_message", sourceKey: "a b", sourceRevision: "c" })
    );
    const right = personalMemoryEventFingerprint(
      identity({ sourceType: "daily_letter_message", sourceKey: "a", sourceRevision: "b c" })
    );
    expect(left).not.toBe(right);
  });
});

describe("理解状态机", () => {
  it("归档可恢复", () => {
    expect(canTransitionInsightState("archived", "active")).toBe(true);
  });

  it("忘记是终态", () => {
    expect(canTransitionInsightState("forgotten", "active")).toBe(false);
    expect(canTransitionInsightState("forgotten", "archived")).toBe(false);
  });

  it("被替代的理解不能直接复活成当前理解", () => {
    expect(canTransitionInsightState("superseded", "active")).toBe(false);
  });

  it("失据理解只能走向忘记，不能自己回到 active", () => {
    expect(canTransitionInsightState("unsupported", "active")).toBe(false);
    expect(canTransitionInsightState("unsupported", "forgotten")).toBe(true);
  });
});

describe("本地状态兼容加载", () => {
  it("空输入得到干净的空状态", () => {
    expect(normalizePersonalMemoryLocalState(undefined)).toEqual(
      createEmptyPersonalMemoryLocalState()
    );
    expect(normalizePersonalMemoryLocalState(null)).toEqual(
      createEmptyPersonalMemoryLocalState()
    );
    expect(normalizePersonalMemoryLocalState([])).toEqual(
      createEmptyPersonalMemoryLocalState()
    );
  });

  it("旧文件缺字段时补齐而不是抛错", () => {
    const state = normalizePersonalMemoryLocalState({ events: [] });
    expect(state.insights).toEqual([]);
    expect(state.projectionWatermarks).toEqual({});
    expect(state.nextIds.event).toBe(1);
  });

  // 一次坏写可能让存下来的 nextId 落后于实际行；取两者较大者，
  // 否则新事件会拿到已被占用的 id。
  it("nextId 取存值与行内最大 id + 1 的较大者", () => {
    const state = normalizePersonalMemoryLocalState({
      events: [{ id: 41 }, { id: 12 }],
      nextIds: { event: 3 },
    });
    expect(state.nextIds.event).toBe(42);
  });

  it("outbox 水位同样不会退回到已用过的 seq", () => {
    const state = normalizePersonalMemoryLocalState({
      outbox: [{ seq: 9 }],
      nextOutboxSeq: 2,
    });
    expect(state.nextOutboxSeq).toBe(10);
  });

  it("损坏的投影水位被丢弃而不是污染状态", () => {
    const state = normalizePersonalMemoryLocalState({
      projectionWatermarks: { promptLineage: 12, broken: "nope" },
    });
    expect(state.projectionWatermarks).toEqual({ promptLineage: 12 });
  });
});

describe("来信版本投影", () => {
  function version(
    overrides: Partial<PersonalMemoryLetterVersionRecord> = {}
  ): PersonalMemoryLetterVersionRecord {
    return {
      id: 1,
      userId: 7,
      letterDate: "2026-09-03",
      envelope: {
        versionNumber: 1,
        generatedAt: "2026-09-03T01:00:00.000Z",
        trigger: "generated",
        selectorVersion: "s1",
        promptVersion: "p1",
        modelVersion: "m1",
      },
      payload: {
        dailyReference: { todayDate: "2026-09-03" },
        analysisSeed: { userMessage: "最近在学游泳" },
        userMessage: "最近在学游泳",
        profileRevision: "r1",
        almanac: null,
        selectedEvidence: [],
      },
      privacyEpoch: 1,
      actionId: "letter-2026-09-03-v1",
      createdAt: "2026-09-03T01:00:00.000Z",
      ...overrides,
    };
  }

  it("日期级行完全由版本重建", () => {
    expect(projectLetterRowFromVersion(version())).toEqual({
      userId: 7,
      letterDate: "2026-09-03",
      userMessage: "最近在学游泳",
      dailyReference: { todayDate: "2026-09-03" },
      analysisSeed: { userMessage: "最近在学游泳" },
      revision: 1,
    });
  });

  // 删除来源后 payload 被 scrub：envelope 仍在（那天确实有过一封信），
  // 但投影出来的正文必须是空的，不能把旧正文留在日期级行里。
  it("payload 被 scrub 后投影不再带出正文", () => {
    const projected = projectLetterRowFromVersion(version({ payload: null }));
    expect(projected.userMessage).toBeNull();
    expect(projected.dailyReference).toEqual({});
    expect(projected.revision).toBe(1);
  });

  it("当前版本是版本号最大的那个，与数组顺序无关", () => {
    const v1 = version({ id: 1 });
    const v2 = version({
      id: 2,
      envelope: { ...version().envelope, versionNumber: 2, trigger: "reread" },
    });
    expect(currentLetterVersion([v2, v1])?.id).toBe(2);
    expect(currentLetterVersion([v1, v2])?.id).toBe(2);
    expect(currentLetterVersion([])).toBeNull();
  });
});

describe("捕获与幂等投影", () => {
  function capture(
    overrides: Partial<PersonalMemoryCapture> = {}
  ): PersonalMemoryCapture {
    return {
      identity: identity(),
      occurredOn: "2026-09-03",
      occurredAt: "2026-09-03T02:00:00.000Z",
      snapshot: createEmptyPersonalMemoryEventSnapshot(),
      storyId: 1186,
      job: { operationId: "op-1", extractorVersion: "v1" },
      ...overrides,
    };
  }

  it("首次捕获建事件并入队一个任务", () => {
    const state = createEmptyPersonalMemoryLocalState();
    const result = applyPersonalMemoryCapture(state, capture());
    expect(result.changed).toBe(true);
    expect(state.events).toHaveLength(1);
    expect(state.jobs).toHaveLength(1);
    expect(state.jobs[0].state).toBe("pending");
    expect(state.jobs[0].eventId).toBe(result.event.id);
  });

  // 计划里的 Edge case：重放同一动作 ID 多次，事件、任务和证据边基数不变。
  it("重放同一动作 ID 不增加事件或任务", () => {
    const state = createEmptyPersonalMemoryLocalState();
    applyPersonalMemoryCapture(state, capture());
    const replay = applyPersonalMemoryCapture(state, capture());
    applyPersonalMemoryCapture(state, capture());
    expect(replay.changed).toBe(false);
    expect(state.events).toHaveLength(1);
    expect(state.jobs).toHaveLength(1);
  });

  it("两个用户的相同来源 ID 各自成事件，互不相撞", () => {
    const state = createEmptyPersonalMemoryLocalState();
    applyPersonalMemoryCapture(state, capture());
    applyPersonalMemoryCapture(
      state,
      capture({ identity: identity({ userId: 8 }) })
    );
    expect(state.events).toHaveLength(2);
    expect(state.events.map(event => event.userId)).toEqual([7, 8]);
  });

  it("身份非法时拒绝捕获，状态一点没动", () => {
    const state = createEmptyPersonalMemoryLocalState();
    expect(() =>
      applyPersonalMemoryCapture(
        state,
        capture({ identity: identity({ actionId: "" }) })
      )
    ).toThrow(PersonalMemoryIdentityError);
    expect(state.events).toHaveLength(0);
    expect(state.nextIds.event).toBe(1);
  });

  it("同一事件换提炼器版本才产生新任务", () => {
    const state = createEmptyPersonalMemoryLocalState();
    applyPersonalMemoryCapture(state, capture());
    // 同一身份重放：连事件都不新建，任务自然也不会重复。
    applyPersonalMemoryCapture(
      state,
      capture({ job: { operationId: "op-2", extractorVersion: "v2" } })
    );
    expect(state.jobs).toHaveLength(1);
  });

  describe("outbox 与 projector", () => {
    function carrier() {
      return createEmptyPersonalMemoryOutbox();
    }

    it("outbox 按来源聚合追加，seq 单调递增", () => {
      const box = carrier();
      const first = appendPersonalMemoryOutboxEntry(box, capture());
      const second = appendPersonalMemoryOutboxEntry(
        box,
        capture({ identity: identity({ actionId: "client-msg-def" }) })
      );
      expect([first.seq, second.seq]).toEqual([1, 2]);
      expect(box.nextOutboxSeq).toBe(3);
    });

    it("投影后水位推进，事件进入统一索引", () => {
      const box = carrier();
      appendPersonalMemoryOutboxEntry(box, capture());
      const state = createEmptyPersonalMemoryLocalState();
      const result = projectPersonalMemoryOutbox(
        state,
        "promptLineage",
        box.outbox
      );
      expect(result).toEqual({ applied: 1, skipped: 0, watermark: 1 });
      expect(state.events).toHaveLength(1);
      expect(state.projectionWatermarks.promptLineage).toBe(1);
    });

    // 「source 聚合已落盘但 projector 还没跑」时崩溃：重启后补齐，且只补一次。
    it("崩溃后重跑 projector 补齐且不重复", () => {
      const box = carrier();
      appendPersonalMemoryOutboxEntry(box, capture());
      appendPersonalMemoryOutboxEntry(
        box,
        capture({ identity: identity({ actionId: "client-msg-def" }) })
      );
      const state = createEmptyPersonalMemoryLocalState();
      projectPersonalMemoryOutbox(state, "promptLineage", box.outbox);
      const rerun = projectPersonalMemoryOutbox(
        state,
        "promptLineage",
        box.outbox
      );
      expect(rerun.applied).toBe(0);
      expect(rerun.skipped).toBe(2);
      expect(state.events).toHaveLength(2);
      expect(state.jobs).toHaveLength(2);
    });

    // 水位本身也存在 local-persist 里，一次坏写可能把它抹回 0。
    // 这时必须靠身份去重兜住，否则事件会翻倍。
    it("水位被抹掉后重投也不会翻倍", () => {
      const box = carrier();
      appendPersonalMemoryOutboxEntry(box, capture());
      const state = createEmptyPersonalMemoryLocalState();
      projectPersonalMemoryOutbox(state, "promptLineage", box.outbox);
      state.projectionWatermarks.promptLineage = 0;
      const rerun = projectPersonalMemoryOutbox(
        state,
        "promptLineage",
        box.outbox
      );
      expect(rerun.applied).toBe(0);
      expect(state.events).toHaveLength(1);
      expect(state.projectionWatermarks.promptLineage).toBe(1);
    });

    it("投影执行到一半崩溃后，从水位续投剩下的", () => {
      const box = carrier();
      appendPersonalMemoryOutboxEntry(box, capture());
      appendPersonalMemoryOutboxEntry(
        box,
        capture({ identity: identity({ actionId: "client-msg-def" }) })
      );
      const state = createEmptyPersonalMemoryLocalState();
      // 只投了第一条就崩了。
      projectPersonalMemoryOutbox(state, "promptLineage", [box.outbox[0]]);
      expect(state.events).toHaveLength(1);

      const resumed = projectPersonalMemoryOutbox(
        state,
        "promptLineage",
        box.outbox
      );
      expect(resumed.applied).toBe(1);
      expect(state.events).toHaveLength(2);
    });

    it("outbox 乱序到达时仍按 seq 升序投影", () => {
      const box = carrier();
      appendPersonalMemoryOutboxEntry(box, capture());
      appendPersonalMemoryOutboxEntry(
        box,
        capture({ identity: identity({ actionId: "client-msg-def" }) })
      );
      const state = createEmptyPersonalMemoryLocalState();
      projectPersonalMemoryOutbox(state, "promptLineage", [
        box.outbox[1],
        box.outbox[0],
      ]);
      expect(state.events.map(event => event.actionId)).toEqual([
        "client-msg-abc",
        "client-msg-def",
      ]);
      expect(state.projectionWatermarks.promptLineage).toBe(2);
    });

    it("不同来源聚合各自记水位，互不干扰", () => {
      const state = createEmptyPersonalMemoryLocalState();
      const chat = carrier();
      appendPersonalMemoryOutboxEntry(chat, capture());
      const local = carrier();
      appendPersonalMemoryOutboxEntry(
        local,
        capture({
          identity: identity({
            sourceType: "image_adoption",
            sourceKey: "image:42",
            actionKind: "adopted",
            actionId: "adopt-42",
          }),
        })
      );
      projectPersonalMemoryOutbox(state, "promptLineage", chat.outbox);
      projectPersonalMemoryOutbox(state, "localPersist", local.outbox);
      expect(state.projectionWatermarks).toEqual({
        promptLineage: 1,
        localPersist: 1,
      });
      expect(state.events).toHaveLength(2);
    });
  });
});

describe("提炼来源判定", () => {
  it.each(["question", "quotation", "hypothesis"] as const)(
    "%s 类型结构上不产生理解",
    statementType => {
      expect(STATEMENT_TYPES_WITHOUT_INSIGHTS.has(statementType)).toBe(true);
    }
  );

  it("direct_statement 和 project_scoped_instruction 结构上可以产生理解", () => {
    expect(STATEMENT_TYPES_WITHOUT_INSIGHTS.has("direct_statement")).toBe(false);
    expect(STATEMENT_TYPES_WITHOUT_INSIGHTS.has("project_scoped_instruction")).toBe(
      false
    );
  });
});

describe("可信级别推导（不接受模型覆盖）", () => {
  it("推断行为永远是 inferred，即使动作是 supersede", () => {
    expect(deriveInsightOrigin("inferred_behavior", "supersede")).toBe("inferred");
    expect(deriveInsightOrigin("inferred_behavior", "new")).toBe("inferred");
  });

  it("直接陈述的新建/强化是 user_stated", () => {
    expect(deriveInsightOrigin("direct_statement", "new")).toBe("user_stated");
    expect(deriveInsightOrigin("direct_statement", "reinforce")).toBe("user_stated");
  });

  // supersede = 用新表达替换旧结论，这正是纠正的定义。
  it("直接陈述的 supersede 是 user_corrected", () => {
    expect(deriveInsightOrigin("direct_statement", "supersede")).toBe(
      "user_corrected"
    );
  });

  it("项目限定指令同样是 user_stated（用户确实说过），但不影响它必须被限定作用域", () => {
    expect(deriveInsightOrigin("project_scoped_instruction", "new")).toBe(
      "user_stated"
    );
  });
});

describe("强化置信度", () => {
  it("每次强化增加但不超过 1", () => {
    expect(reinforceInsightConfidence(0.5)).toBeCloseTo(0.6);
    expect(reinforceInsightConfidence(0.95)).toBe(1);
    expect(reinforceInsightConfidence(1)).toBe(1);
  });
});

describe("提炼动作判定：不能覆盖新纠正/归档/忘记", () => {
  function insight(
    overrides: Partial<PersonalMemoryInsightRecord> = {}
  ): PersonalMemoryInsightRecord {
    return {
      id: 1,
      userId: 7,
      lineageKey: "L1",
      revision: 1,
      state: "active",
      origin: "inferred",
      category: "preference",
      text: "喜欢暖色调",
      scope: null,
      confidence: 0.5,
      allowProactiveMention: false,
      supersededByInsightId: null,
      createdAt: "2026-09-03T00:00:00.000Z",
      updatedAt: "2026-09-03T00:00:00.000Z",
      ...overrides,
    };
  }

  it("new 动作总是产生 create，不看 lineage 是否存在", () => {
    const decision = decideInsightMutation(
      {
        action: "new",
        origin: "inferred",
        category: "preference",
        text: "喜欢暖色调",
        scope: null,
        confidence: 0.5,
        allowProactiveMention: false,
      },
      "L1",
      { revisions: [] }
    );
    expect(decision).toEqual({ kind: "create", lineageKey: "L1" });
  });

  it("reinforce 在 lineage 不存在时判为 stale", () => {
    const decision = decideInsightMutation(
      { action: "reinforce", lineageKey: "L1", expectedRevision: 1 },
      "L1",
      { revisions: [] }
    );
    expect(decision.kind).toBe("stale");
  });

  it("reinforce 在 tip 是 active 时正常生效", () => {
    const tip = insight();
    const decision = decideInsightMutation(
      { action: "reinforce", lineageKey: "L1", expectedRevision: 1 },
      "L1",
      { revisions: [tip] }
    );
    expect(decision).toEqual({ kind: "reinforce", target: tip });
  });

  // 这是承重约束：用户刚纠正过，旧任务的提炼结果绝不能覆盖它。
  it.each(["superseded", "archived", "unsupported", "forgotten"] as const)(
    "tip 状态是 %s 时，reinforce 和 supersede 都判为 stale 而不是覆盖",
    state => {
      const tip = insight({ state });
      const reinforce = decideInsightMutation(
        { action: "reinforce", lineageKey: "L1", expectedRevision: 1 },
        "L1",
        { revisions: [tip] }
      );
      const supersede = decideInsightMutation(
        {
          action: "supersede",
          lineageKey: "L1",
          expectedRevision: 1,
          origin: "user_corrected",
          category: "preference",
          text: "喜欢冷色调",
          scope: null,
          confidence: 0.6,
          allowProactiveMention: false,
        },
        "L1",
        { revisions: [tip] }
      );
      expect(reinforce.kind).toBe("stale");
      expect(supersede.kind).toBe("stale");
    }
  );

  // 这条是发现于 U5 的真实漏洞：只查 state=active 不够。用户纠正之后 tip 仍然
  // 是 active，只是内容换了；一个在纠正之前就决定要 reinforce 的旧任务，会把
  // 新证据错挂到内容完全不同的新版本上。序列号（revision）才是那道门。
  it("tip 仍是 active 但 revision 已经变了——判 stale，不把证据挂到新内容上", () => {
    const corrected = insight({ id: 2, revision: 2, state: "active" });
    const decision = decideInsightMutation(
      { action: "reinforce", lineageKey: "L1", expectedRevision: 1 },
      "L1",
      { revisions: [insight({ id: 1, revision: 1, state: "superseded" }), corrected] }
    );
    expect(decision.kind).toBe("stale");
    expect(decision.kind === "stale" && decision.reason).toContain("revision");
  });

  it("supersede 在 tip 是 active 时正常生效", () => {
    const tip = insight();
    const decision = decideInsightMutation(
      {
        action: "supersede",
        lineageKey: "L1",
        expectedRevision: 1,
        origin: "user_corrected",
        category: "preference",
        text: "喜欢冷色调",
        scope: null,
        confidence: 0.6,
        allowProactiveMention: false,
      },
      "L1",
      { revisions: [tip] }
    );
    expect(decision).toEqual({ kind: "supersede", target: tip });
  });

  it("tip 取最高 revision 那一行，与数组顺序无关", () => {
    const r1 = insight({ id: 1, revision: 1, state: "superseded" });
    const r2 = insight({ id: 2, revision: 2, state: "active" });
    expect(insightLineageTip({ revisions: [r2, r1] })?.id).toBe(2);
    expect(insightLineageTip({ revisions: [r1, r2] })?.id).toBe(2);
    expect(insightLineageTip({ revisions: [] })).toBeNull();
  });
});

describe("归档/恢复状态迁移", () => {
  function insight(state: PersonalMemoryInsightRecord["state"]): PersonalMemoryInsightRecord {
    return {
      id: 1, userId: 7, lineageKey: "L1", revision: 1, state,
      origin: "inferred", category: "preference", text: "x", scope: null,
      confidence: 0.5, allowProactiveMention: false, supersededByInsightId: null,
      createdAt: "x", updatedAt: "x",
    };
  }

  it("active 可以归档", () => {
    const decision = decideLineageStateChange({ revisions: [insight("active")] }, "archived");
    expect(decision.kind).toBe("apply");
  });

  it("archived 可以恢复到 active", () => {
    const decision = decideLineageStateChange({ revisions: [insight("archived")] }, "active");
    expect(decision.kind).toBe("apply");
  });

  // 归档后恢复不覆盖更新的冲突理解：由于 restore 只操作这一个 lineage 自己的
  // tip，不触碰其它 lineage，这条约束天然成立——这里验证的是迁移表本身没开口子。
  it("superseded 不能直接恢复到 active", () => {
    const decision = decideLineageStateChange({ revisions: [insight("superseded")] }, "active");
    expect(decision.kind).toBe("invalid");
  });

  it("forgotten 是终态，不能恢复", () => {
    const decision = decideLineageStateChange({ revisions: [insight("forgotten")] }, "active");
    expect(decision.kind).toBe("invalid");
  });

  it("任何状态都可以走向 forgotten（忘记整条 lineage）", () => {
    for (const state of ["active", "superseded", "archived", "unsupported"] as const) {
      expect(
        decideLineageStateChange({ revisions: [insight(state)] }, "forgotten").kind
      ).toBe("apply");
    }
  });

  it("lineage 不存在时判为 invalid", () => {
    expect(decideLineageStateChange({ revisions: [] }, "active").kind).toBe("invalid");
  });
});

describe("来源被清空内容后重新计算依据", () => {
  function tip(state: PersonalMemoryInsightRecord["state"] = "active") {
    return {
      id: 1, userId: 7, lineageKey: "L1", revision: 1, state,
      origin: "inferred" as const, category: "preference" as const, text: "x",
      scope: null, confidence: 0.5, allowProactiveMention: false,
      supersededByInsightId: null, createdAt: "x", updatedAt: "x",
    };
  }

  it("多来源理解删掉其中一个仍保留依据", () => {
    expect(decideEvidenceLossOutcome(tip(), 1)).toBe("unaffected");
  });

  it("最后一个有效来源没了后退出召回", () => {
    expect(decideEvidenceLossOutcome(tip(), 0)).toBe("unsupported");
  });

  it("非活跃理解不参与召回判定，即使证据清零", () => {
    expect(decideEvidenceLossOutcome(tip("archived"), 0)).toBe("unaffected");
    expect(decideEvidenceLossOutcome(tip("forgotten"), 0)).toBe("unaffected");
  });
});
