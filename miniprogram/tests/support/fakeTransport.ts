import type {
  BalanceSummary,
  ConversationServerMessage,
  PublishingBodyDocument,
  StorySummary,
} from "../../src/core/types";
import {
  transportFail,
  transportOk,
  type LookupTurnRequest,
  type LookupTurnResponse,
  type SaveDocumentBodyRequest,
  type StoryWorkspaceSnapshot,
  type SubmitTurnRequest,
  type SubmitTurnResponse,
  type TransportError,
  type TransportResult,
  type WorkspaceTransport,
} from "../../src/services/transport";

/**
 * 可完全操控的 transport 测试替身：每个方法都能挂起、按需 resolve，
 * 用来复现迟到结果、重复点击、未知结果这些真实时序。
 */
export type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => {
    resolve = res;
  });
  return { promise, resolve };
}

export function balance(availableCents = 3000): BalanceSummary {
  return {
    availableCents,
    lastCostCents: null,
    currency: "CNY",
    demo: true,
  };
}

export function document(
  overrides: Partial<PublishingBodyDocument> = {},
): PublishingBodyDocument {
  return {
    storyId: 1,
    storyRevision: 1,
    versionId: "version-1",
    platform: "xiaohongshu",
    body: "服务端正文",
    bodyRevision: 1,
    updatedAt: 1_760_000_000_000,
    ...overrides,
  };
}

export type FakeTransportOptions = {
  stories?: StorySummary[];
  messages?: ConversationServerMessage[];
};

export type FakeTransport = WorkspaceTransport & {
  calls: {
    listStories: number;
    openStory: number[];
    submitTurn: SubmitTurnRequest[];
    lookupTurn: LookupTurnRequest[];
    saveDocumentBody: SaveDocumentBodyRequest[];
  };
  /** 挂起下一次 submitTurn，由测试决定何时以及以什么结果返回。 */
  pendingSubmit: Deferred<TransportResult<SubmitTurnResponse>> | null;
  holdNextSubmit(): Deferred<TransportResult<SubmitTurnResponse>>;
  nextSubmitError: TransportError | null;
  nextListStoriesError: TransportError | null;
  nextOpenStoryError: TransportError | null;
  nextSaveError: TransportError | null;
  lookupResponse: LookupTurnResponse;
  documents: Map<number, PublishingBodyDocument>;
  balanceCents: number;
};

export function createFakeTransport(
  options: FakeTransportOptions = {},
): FakeTransport {
  const stories = options.stories ?? [
    { id: 1, title: "演示 Story 一", updatedAt: 1_760_000_000_000 },
    { id: 2, title: "演示 Story 二", updatedAt: 1_759_000_000_000 },
  ];
  const documents = new Map<number, PublishingBodyDocument>(
    stories.map(story => [
      story.id,
      document({ storyId: story.id, body: `Story ${story.id} 的服务端正文` }),
    ]),
  );

  const fake: FakeTransport = {
    kind: "mock",
    calls: {
      listStories: 0,
      openStory: [],
      submitTurn: [],
      lookupTurn: [],
      saveDocumentBody: [],
    },
    pendingSubmit: null,
    nextSubmitError: null,
    nextListStoriesError: null,
    nextOpenStoryError: null,
    nextSaveError: null,
    lookupResponse: { status: "missing", assistantContent: null, balance: null },
    documents,
    balanceCents: 3000,

    holdNextSubmit() {
      const control = deferred<TransportResult<SubmitTurnResponse>>();
      fake.pendingSubmit = control;
      return control;
    },

    async listStories(): Promise<TransportResult<StorySummary[]>> {
      fake.calls.listStories += 1;
      if (fake.nextListStoriesError) {
        const error = fake.nextListStoriesError;
        fake.nextListStoriesError = null;
        return { ok: false, error };
      }
      return transportOk(stories);
    },

    async openStory(storyId): Promise<TransportResult<StoryWorkspaceSnapshot>> {
      fake.calls.openStory.push(storyId);
      if (fake.nextOpenStoryError) {
        const error = fake.nextOpenStoryError;
        fake.nextOpenStoryError = null;
        return { ok: false, error };
      }
      const story = stories.find(item => item.id === storyId);
      if (!story) {
        return transportFail({ kind: "target-missing", message: "Story 不存在" });
      }
      return transportOk({
        story,
        messages: options.messages ?? [],
        document: documents.get(storyId) ?? document({ storyId }),
        balance: balance(fake.balanceCents),
      });
    },

    async submitTurn(request): Promise<TransportResult<SubmitTurnResponse>> {
      fake.calls.submitTurn.push(request);
      if (fake.pendingSubmit) {
        const control = fake.pendingSubmit;
        fake.pendingSubmit = null;
        return control.promise;
      }
      if (fake.nextSubmitError) {
        const error = fake.nextSubmitError;
        fake.nextSubmitError = null;
        return { ok: false, error };
      }
      return transportOk({
        assistantContent: `对「${request.userContent}」的演示回答`,
        persisted: true,
        balance: balance(fake.balanceCents),
      });
    },

    async lookupTurn(request): Promise<TransportResult<LookupTurnResponse>> {
      fake.calls.lookupTurn.push(request);
      return transportOk(fake.lookupResponse);
    },

    async saveDocumentBody(
      request,
    ): Promise<TransportResult<{ document: PublishingBodyDocument }>> {
      fake.calls.saveDocumentBody.push(request);
      if (fake.nextSaveError) {
        const error = fake.nextSaveError;
        fake.nextSaveError = null;
        return { ok: false, error };
      }
      const current = documents.get(request.storyId) ?? document({ storyId: request.storyId });
      if (current.bodyRevision !== request.baseBodyRevision) {
        return {
          ok: false,
          error: {
            kind: "conflict",
            message: "正文已在别处更新",
            retryable: false,
            resultUnknown: false,
            latestDocument: current,
          },
        };
      }
      const saved: PublishingBodyDocument = {
        ...current,
        body: request.body,
        bodyRevision: current.bodyRevision + 1,
      };
      documents.set(request.storyId, saved);
      return transportOk({ document: saved });
    },
  };
  return fake;
}
