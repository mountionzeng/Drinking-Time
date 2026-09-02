import { describe, expect, it, vi } from "vitest";

import {
  beginMobileDocumentSave,
  editMobileDocumentBody,
  hydrateMobileDocumentState,
  type MobilePublishingBodyDocument,
} from "./mobileDocumentStore";
import { runMobileDocumentSave } from "./useMobileDocument";

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

function savingState() {
  return beginMobileDocumentSave(
    editMobileDocumentBody(
      hydrateMobileDocumentState({
        userId: 3,
        storyId: 7,
        document: document(),
        recoveryRecords: [],
      }),
      "手机正文",
      200
    )
  );
}

describe("runMobileDocumentSave", () => {
  it("submits only the exact body scope and accepts its authoritative result", async () => {
    const state = savingState();
    const api = {
      save: vi.fn(async () => ({
        status: "saved" as const,
        document: document({ body: "手机正文", bodyRevision: 5 }),
      })),
      read: vi.fn(),
    };
    const result = await runMobileDocumentSave({ state, api });

    expect(api.save).toHaveBeenCalledWith({
      storyId: 7,
      versionId: "v2",
      platform: "xiaohongshu",
      baseBodyRevision: 4,
      body: "手机正文",
    });
    expect(result).toMatchObject({ status: "saved", recovery: null });
  });

  it("keeps local and latest text when the server returns conflict", async () => {
    const state = savingState();
    const api = {
      save: vi.fn(async () => ({
        status: "conflict" as const,
        reason: "body_changed" as const,
        latestDocument: document({ body: "电脑正文", bodyRevision: 5 }),
      })),
      read: vi.fn(),
    };
    const result = await runMobileDocumentSave({ state, api });
    expect(result).toMatchObject({
      status: "conflict",
      body: "手机正文",
      conflict: {
        localBody: "手机正文",
        latestDocument: { body: "电脑正文" },
      },
    });
  });

  it("proves a lost save response landed before marking it saved", async () => {
    const state = savingState();
    const api = {
      save: vi.fn().mockRejectedValue(new Error("response lost")),
      read: vi.fn(async () => document({ body: "手机正文", bodyRevision: 5 })),
    };
    const result = await runMobileDocumentSave({ state, api });
    expect(result.status).toBe("saved");
    expect(api.read).toHaveBeenCalledWith({ storyId: 7 });
  });

  it("keeps the local draft failed when authority proves the save did not land", async () => {
    const state = savingState();
    const api = {
      save: vi.fn().mockRejectedValue(new Error("offline")),
      read: vi.fn(async () => document()),
    };
    const result = await runMobileDocumentSave({ state, api });
    expect(result).toMatchObject({
      status: "failed",
      body: "手机正文",
      recovery: { body: "手机正文" },
    });
  });

  it("stays uncertain when neither the save nor authority read is knowable", async () => {
    const state = savingState();
    const api = {
      save: vi.fn().mockRejectedValue(new Error("timeout")),
      read: vi.fn().mockRejectedValue(new Error("offline")),
    };
    const result = await runMobileDocumentSave({ state, api });
    expect(result).toMatchObject({
      status: "uncertain",
      body: "手机正文",
      recovery: { body: "手机正文" },
    });
  });
});
