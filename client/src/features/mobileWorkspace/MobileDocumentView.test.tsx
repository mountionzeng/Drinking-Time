import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { MobileDocumentState } from "./mobileDocumentStore";
import {
  MobileDocumentConflictDetails,
  MobileDocumentView,
  type MobileDocumentController,
} from "./MobileDocumentView";

function state(overrides: Partial<MobileDocumentState> = {}): MobileDocumentState {
  return {
    userId: 3,
    storyId: 7,
    status: "dirty",
    document: {
      storyId: 7,
      storyRevision: 10,
      versionId: "v2",
      platform: "xiaohongshu",
      body: "电脑上的正文",
      bodyRevision: 4,
      draftRevision: 6,
      versionRevision: 8,
      containerRevision: 9,
      publishingRevision: 9,
      updatedAt: 100,
    },
    body: "手机上修改的正文",
    recovery: null,
    conflict: null,
    error: null,
    ...overrides,
  };
}

function controller(value = state()): MobileDocumentController {
  return {
    state: value,
    loadState: "ready",
    loadError: null,
    editBody: vi.fn(),
    save: vi.fn(),
    discard: vi.fn(),
    retryLoad: vi.fn(),
    hasUnsavedChanges: true,
    canSave: true,
    isSaving: false,
  };
}

describe("MobileDocumentView", () => {
  it("renders only the current body editor and sticky save action", () => {
    const html = renderToStaticMarkup(
      <MobileDocumentView controller={controller()} storyTitle="旅行记" />
    );

    expect(html).toContain('aria-label="正文内容"');
    expect(html).toContain("手机上修改的正文");
    expect(html).toContain("保存正文");
    expect(html).not.toContain("标题");
    expect(html).not.toContain("标签");
  });

  it("shows both copies and a safe recovery action for conflicts", () => {
    const html = renderToStaticMarkup(
      <MobileDocumentConflictDetails
        latestBody="电脑刚保存的正文"
        localBody="手机未保存的正文"
        onCopyLocal={vi.fn()}
        onLoadLatest={vi.fn()}
      />
    );

    expect(html).toContain("手机未保存的正文");
    expect(html).toContain("电脑刚保存的正文");
    expect(html).toContain("复制我的正文");
    expect(html).toContain("载入最新正文");
  });
});
