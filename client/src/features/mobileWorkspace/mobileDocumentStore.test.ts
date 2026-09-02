import { describe, expect, it } from "vitest";

import {
  applyMobileDocumentAuthority,
  applyMobileDocumentSaveConflict,
  applyMobileDocumentSaveSuccess,
  beginMobileDocumentSave,
  editMobileDocumentBody,
  hydrateMobileDocumentState,
  loadMobileDocumentRecovery,
  mobileDocumentRecoveryKey,
  saveMobileDocumentRecovery,
  type MobilePublishingBodyDocument,
} from "./mobileDocumentStore";

function document(
  overrides: Partial<MobilePublishingBodyDocument> = {}
): MobilePublishingBodyDocument {
  return {
    storyId: 7,
    storyRevision: 10,
    versionId: "v2",
    platform: "xiaohongshu",
    body: "服务端正文",
    bodyRevision: 4,
    draftRevision: 6,
    versionRevision: 8,
    containerRevision: 9,
    publishingRevision: 9,
    updatedAt: 100,
    ...overrides,
  };
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

describe("mobile document store", () => {
  it("keeps dirty text when a background read returns the same authority", () => {
    const clean = hydrateMobileDocumentState({
      userId: 3,
      storyId: 7,
      document: document(),
      recoveryRecords: [],
    });
    const dirty = editMobileDocumentBody(clean, "手机未保存正文", 200);
    const refreshed = applyMobileDocumentAuthority(
      dirty,
      document({ updatedAt: 300 })
    );
    expect(refreshed).toMatchObject({
      status: "dirty",
      body: "手机未保存正文",
      document: { body: "服务端正文", bodyRevision: 4 },
    });
  });

  it("restores only a matching recovery base and conflicts after scope drift", () => {
    const base = document();
    const dirty = editMobileDocumentBody(
      hydrateMobileDocumentState({
        userId: 3,
        storyId: 7,
        document: base,
        recoveryRecords: [],
      }),
      "恢复正文",
      200
    );
    const restored = hydrateMobileDocumentState({
      userId: 3,
      storyId: 7,
      document: base,
      recoveryRecords: [dirty.recovery!],
    });
    expect(restored).toMatchObject({ status: "dirty", body: "恢复正文" });

    const drifted = hydrateMobileDocumentState({
      userId: 3,
      storyId: 7,
      document: document({ versionId: "v3", platform: "wechat_moments" }),
      recoveryRecords: [dirty.recovery!],
    });
    expect(drifted).toMatchObject({
      status: "conflict",
      body: "恢复正文",
      conflict: {
        reason: "scope_changed",
        localBody: "恢复正文",
        latestDocument: { versionId: "v3", platform: "wechat_moments" },
      },
    });
  });

  it("retains local text and latest authority on a save conflict", () => {
    const dirty = editMobileDocumentBody(
      hydrateMobileDocumentState({
        userId: 3,
        storyId: 7,
        document: document(),
        recoveryRecords: [],
      }),
      "手机正文",
      200
    );
    const saving = beginMobileDocumentSave(dirty);
    const conflicted = applyMobileDocumentSaveConflict(saving, {
      reason: "body_changed",
      latestDocument: document({ body: "电脑新正文", bodyRevision: 5 }),
    });
    expect(conflicted).toMatchObject({
      status: "conflict",
      body: "手机正文",
      conflict: {
        localBody: "手机正文",
        latestDocument: { body: "电脑新正文", bodyRevision: 5 },
      },
    });
  });

  it("accepts a save only for the captured scope and local body", () => {
    const dirty = editMobileDocumentBody(
      hydrateMobileDocumentState({
        userId: 3,
        storyId: 7,
        document: document(),
        recoveryRecords: [],
      }),
      "已保存正文",
      200
    );
    const saving = beginMobileDocumentSave(dirty);
    const saved = applyMobileDocumentSaveSuccess(saving, {
      expectedScopeKey: saving.recovery!.scopeKey,
      expectedBody: "已保存正文",
      document: document({ body: "已保存正文", bodyRevision: 5 }),
    });
    expect(saved).toMatchObject({
      status: "saved",
      body: "已保存正文",
      document: { bodyRevision: 5 },
      recovery: null,
    });
    expect(
      applyMobileDocumentSaveSuccess(dirty, {
        expectedScopeKey: "another-scope",
        expectedBody: "已保存正文",
        document: document({ body: "迟到结果", bodyRevision: 6 }),
      })
    ).toBe(dirty);
  });

  it("uses an authority read to prove whether an uncertain save landed", () => {
    const dirty = editMobileDocumentBody(
      hydrateMobileDocumentState({
        userId: 3,
        storyId: 7,
        document: document(),
        recoveryRecords: [],
      }),
      "可能已保存",
      200
    );
    const saving = beginMobileDocumentSave(dirty);
    const landed = applyMobileDocumentAuthority(
      { ...saving, status: "uncertain" },
      document({ body: "可能已保存", bodyRevision: 5 })
    );
    expect(landed).toMatchObject({ status: "saved", recovery: null });

    const notLanded = applyMobileDocumentAuthority(
      { ...saving, status: "uncertain" },
      document()
    );
    expect(notLanded).toMatchObject({
      status: "failed",
      body: "可能已保存",
      recovery: { body: "可能已保存" },
    });
  });

  it("expires, bounds, and scopes recovery records without email identifiers", () => {
    const storage = memoryStorage();
    const key = mobileDocumentRecoveryKey(17, 7);
    expect(key).toBe("dt:mobile:document:v1:17:7");
    expect(key).not.toContain("@");
    const records = Array.from({ length: 12 }, (_, index) => ({
      userId: 17,
      storyId: 7,
      scopeKey: `17:7:v${index}:xiaohongshu:${index + 1}`,
      versionId: `v${index}`,
      platform: "xiaohongshu" as const,
      baseBodyRevision: index + 1,
      baseStoryRevision: index + 1,
      body: `正文-${index}`,
      updatedAt: index === 0 ? 1 : 1_000 + index,
      expiresAt: index === 0 ? 2 : 10_000,
    }));
    saveMobileDocumentRecovery(storage, 17, 7, records, { now: 5 });
    const loaded = loadMobileDocumentRecovery(storage, 17, 7, { now: 5 });
    expect(loaded).toHaveLength(8);
    expect(loaded.some(record => record.updatedAt === 1)).toBe(false);
    expect(loadMobileDocumentRecovery(storage, 18, 7, { now: 5 })).toEqual([]);
  });
});
