import { describe, expect, it } from "vitest";

import {
  applyDocumentAuthority,
  applyDocumentSaveConflict,
  applyDocumentSaveFailure,
  applyDocumentSaveSuccess,
  beginDocumentSave,
  createLoadingDocumentState,
  discardLocalDraft,
  documentConflictCopies,
  documentScopeKey,
  editDocumentBody,
  hydrateDocumentState,
  normalizeDocumentRecoveryRecord,
} from "../src/core/documentState";
import { RECOVERY_TTL_MS } from "../src/core/recoveryState";
import type { PublishingBodyDocument } from "../src/core/types";

const SCOPE = "demo-scope-aaaa";
const NOW = 1_760_000_000_000;

function serverDocument(
  overrides: Partial<PublishingBodyDocument> = {},
): PublishingBodyDocument {
  return {
    storyId: 1186,
    storyRevision: 4,
    versionId: "version-1",
    platform: "xiaohongshu",
    body: "服务端的正文",
    bodyRevision: 7,
    updatedAt: NOW,
    ...overrides,
  };
}

function hydrated() {
  return hydrateDocumentState({
    scope: SCOPE,
    storyId: 1186,
    document: serverDocument(),
    recoveryRecords: [],
  });
}

describe("clean / dirty / saving / saved", () => {
  it("没有本地草稿时进入 clean，正文就是服务端那份", () => {
    const state = hydrated();
    expect(state.status).toBe("clean");
    expect(state.body).toBe("服务端的正文");
    expect(state.recovery).toBeNull();
  });

  it("编辑后进入 dirty，并带上服务端给的版本／平台／revision", () => {
    const state = editDocumentBody(hydrated(), "我改过的正文", NOW + 1000);
    expect(state.status).toBe("dirty");
    expect(state.recovery).toMatchObject({
      versionId: "version-1",
      platform: "xiaohongshu",
      baseBodyRevision: 7,
      baseStoryRevision: 4,
      body: "我改过的正文",
      expiresAt: NOW + 1000 + RECOVERY_TTL_MS,
    });
  });

  it("改回原文等于没改，回到 clean 并丢掉草稿", () => {
    const dirty = editDocumentBody(hydrated(), "我改过的正文", NOW + 1);
    const back = editDocumentBody(dirty, "服务端的正文", NOW + 2);
    expect(back.status).toBe("clean");
    expect(back.recovery).toBeNull();
  });

  it("clean 状态点保存不会空转出 saving", () => {
    expect(beginDocumentSave(hydrated()).status).toBe("clean");
  });

  it("保存成功后回到权威 saved，草稿清掉", () => {
    const dirty = editDocumentBody(hydrated(), "我改过的正文", NOW + 1);
    const saving = beginDocumentSave(dirty);
    expect(saving.status).toBe("saving");
    const saved = applyDocumentSaveSuccess(saving, {
      expectedScopeKey: saving.recovery?.scopeKey ?? "",
      expectedBody: "我改过的正文",
      document: serverDocument({ body: "我改过的正文", bodyRevision: 8 }),
    });
    expect(saved.status).toBe("saved");
    expect(saved.document?.bodyRevision).toBe(8);
    expect(saved.recovery).toBeNull();
  });

  it("迟到的成功响应不能顶掉用户之后的编辑", () => {
    const dirty = editDocumentBody(hydrated(), "第一次改", NOW + 1);
    const saving = beginDocumentSave(dirty);
    const editedAgain = editDocumentBody(saving, "第二次改", NOW + 2);
    const late = applyDocumentSaveSuccess(editedAgain, {
      expectedScopeKey: saving.recovery?.scopeKey ?? "",
      expectedBody: "第一次改",
      document: serverDocument({ body: "第一次改", bodyRevision: 8 }),
    });
    expect(late.body).toBe("第二次改");
    expect(late.status).toBe("dirty");
  });
});

describe("冲突：两份文本都不能丢", () => {
  it("base revision 过期时保留本地正文和最新服务端正文", () => {
    const dirty = editDocumentBody(hydrated(), "我在手机上改的", NOW + 1);
    const saving = beginDocumentSave(dirty);
    const conflict = applyDocumentSaveConflict(saving, {
      reason: "body_changed",
      latestDocument: serverDocument({
        body: "别的设备改的",
        bodyRevision: 9,
      }),
    });
    expect(conflict.status).toBe("conflict");
    expect(documentConflictCopies(conflict)).toEqual({
      localBody: "我在手机上改的",
      serverBody: "别的设备改的",
    });
    expect(conflict.error).toContain("其他设备");
  });

  it("目标不存在时服务端那份为 null，本地那份仍在", () => {
    const dirty = editDocumentBody(hydrated(), "本地文字", NOW + 1);
    const conflict = applyDocumentSaveConflict(beginDocumentSave(dirty), {
      reason: "target_missing",
      latestDocument: null,
    });
    expect(conflict.conflict?.reason).toBe("target_missing");
    expect(documentConflictCopies(conflict)).toEqual({
      localBody: "本地文字",
      serverBody: null,
    });
  });

  it("版本或平台变了归类为 scope_changed，不是普通 body 冲突", () => {
    const recovery = {
      scope: SCOPE,
      storyId: 1186,
      scopeKey: documentScopeKey({
        scope: SCOPE,
        storyId: 1186,
        versionId: "version-0",
        platform: "x" as const,
        bodyRevision: 7,
      }),
      versionId: "version-0",
      platform: "x" as const,
      baseBodyRevision: 7,
      baseStoryRevision: 4,
      body: "在另一个平台写的草稿",
      updatedAt: NOW,
      expiresAt: NOW + RECOVERY_TTL_MS,
    };
    const state = hydrateDocumentState({
      scope: SCOPE,
      storyId: 1186,
      document: serverDocument(),
      recoveryRecords: [recovery],
    });
    expect(state.status).toBe("conflict");
    expect(state.conflict?.reason).toBe("scope_changed");
  });

  it("放弃本地草稿是显式动作，之后才回到服务端那份", () => {
    const dirty = editDocumentBody(hydrated(), "本地草稿", NOW + 1);
    const conflict = applyDocumentSaveConflict(beginDocumentSave(dirty), {
      reason: "body_changed",
      latestDocument: serverDocument({ body: "服务端新文字", bodyRevision: 9 }),
    });
    // 冲突态本身不会自动覆盖。
    expect(conflict.body).toBe("本地草稿");
    const discarded = discardLocalDraft(conflict);
    expect(discarded.status).toBe("clean");
    expect(discarded.body).toBe("服务端新文字");
  });
});

describe("失败与不确定", () => {
  it("普通失败进 failed，可以直接重试保存", () => {
    const dirty = editDocumentBody(hydrated(), "改动", NOW + 1);
    const failed = applyDocumentSaveFailure(beginDocumentSave(dirty), {
      error: "网络不给力",
      uncertain: false,
    });
    expect(failed.status).toBe("failed");
    expect(failed.body).toBe("改动");
    expect(beginDocumentSave(failed).status).toBe("saving");
  });

  it("结果不确定时先进 uncertain，权威回来才判定", () => {
    const dirty = editDocumentBody(hydrated(), "改动", NOW + 1);
    const uncertain = applyDocumentSaveFailure(beginDocumentSave(dirty), {
      error: "请求超时，结果未知",
      uncertain: true,
    });
    expect(uncertain.status).toBe("uncertain");

    const settled = applyDocumentAuthority(uncertain, serverDocument());
    expect(settled.status).toBe("failed");
    expect(settled.error).toContain("仍保留在本机");
    expect(settled.body).toBe("改动");
  });
});

describe("onShow 刷新权威", () => {
  it("不覆盖 dirty 正文", () => {
    const dirty = editDocumentBody(hydrated(), "手机上没保存的文字", NOW + 1);
    const refreshed = applyDocumentAuthority(dirty, serverDocument());
    expect(refreshed.body).toBe("手机上没保存的文字");
    expect(refreshed.status).toBe("dirty");
  });

  it("服务端文字与本地一致时收敛为 saved", () => {
    const dirty = editDocumentBody(hydrated(), "两边一样的文字", NOW + 1);
    const refreshed = applyDocumentAuthority(
      dirty,
      serverDocument({ body: "两边一样的文字", bodyRevision: 8 }),
    );
    expect(refreshed.status).toBe("saved");
    expect(refreshed.recovery).toBeNull();
  });

  it("别的 Story 的权威正文不会渲染进来", () => {
    const state = hydrated();
    const other = applyDocumentAuthority(
      state,
      serverDocument({ storyId: 9999, body: "别的 Story 的正文" }),
    );
    expect(other.body).toBe("服务端的正文");
  });

  it("loading 状态收到权威后进入 clean", () => {
    const loading = createLoadingDocumentState(SCOPE, 1186);
    const loaded = applyDocumentAuthority(loading, serverDocument());
    expect(loaded.status).toBe("clean");
    expect(loaded.body).toBe("服务端的正文");
  });
});

describe("恢复记录归一化", () => {
  function record(overrides: Record<string, unknown> = {}) {
    const base = {
      scope: SCOPE,
      storyId: 1186,
      versionId: "version-1",
      platform: "xiaohongshu" as const,
      baseBodyRevision: 7,
      baseStoryRevision: 4,
      body: "草稿",
      updatedAt: NOW,
      expiresAt: NOW + RECOVERY_TTL_MS,
    };
    return {
      ...base,
      scopeKey: documentScopeKey({
        scope: base.scope,
        storyId: base.storyId,
        versionId: base.versionId,
        platform: base.platform,
        bodyRevision: base.baseBodyRevision,
      }),
      ...overrides,
    };
  }

  it("接受自洽的记录", () => {
    expect(normalizeDocumentRecoveryRecord(record(), SCOPE, 1186)).not.toBeNull();
  });

  it("scopeKey 与字段对不上就丢弃", () => {
    expect(
      normalizeDocumentRecoveryRecord(
        record({ scopeKey: "被人改过的键" }),
        SCOPE,
        1186,
      ),
    ).toBeNull();
  });

  it("平台值不在枚举内、跨作用域、跨 Story 都丢弃", () => {
    expect(
      normalizeDocumentRecoveryRecord(record({ platform: "myspace" }), SCOPE, 1186),
    ).toBeNull();
    expect(
      normalizeDocumentRecoveryRecord(record(), "demo-scope-bbbb", 1186),
    ).toBeNull();
    expect(normalizeDocumentRecoveryRecord(record(), SCOPE, 1187)).toBeNull();
  });
});
