import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import { computeStoryConversationTurnRequestHash } from "../shared/promptLineage";
import { mobileTextDraftRequest } from "../client/src/features/mobileWorkspace/mobileTextDraftWorkflow";
import {
  mobileWritingContext,
  type MemoryFollowupSource,
} from "../client/src/features/mobileWorkspace/mobileMemoryFollowup";

const ai = vi.hoisted(() => ({ proposal: vi.fn(), text: vi.fn() }));
vi.mock("./_core/agentChannel", () => ({ invokeAgent: ai.proposal }));
vi.mock("./services/agentRuntime", () => ({ runJsonAgent: ai.text }));
const { appRouter } = await import("./routers");
const { resetMemoryStateForTesting } = await import("./db");
function caller(id = 871) {
  return appRouter.createCaller({
    user: {
      id,
      openId: `mobile-writing-${id}`,
      name: "测试用户",
      role: "user",
      sessionVersion: 1,
    },
    req: { protocol: "http", headers: {} },
    res: {},
  } as TrpcContext);
}
function textResult(body = "前文。新的表达。后文。") {
  return {
    parsed: {
      draft: { title: "", body, tags: [] },
      observation: {
        originalExpression: "",
        adoptionLearning: "",
        confidence: "insufficient",
        choices: [],
      },
    },
    modelLabel: "test",
    rawText: "{}",
  };
}
async function setup() {
  const api = caller();
  const story = await api.storyAgent.storyUpsert({
    title: "手机流程隔离验收",
    body: { shots: [], messages: [] },
  });
  const storyId = story!.id;
  await api.publishingDraft.initBody({ storyId });
  const empty = await api.publishingDraft.readBody({ storyId });
  await api.publishingDraft.saveBody({
    storyId,
    versionId: empty.versionId,
    platform: empty.platform,
    baseBodyRevision: empty.bodyRevision,
    body: "前文。原句。后文。",
  });
  const document = await api.publishingDraft.readBody({ storyId });
  const source: MemoryFollowupSource = {
    storyId,
    id: "text:current",
    kind: "text",
    origin: "note",
    content: document.body,
    text: {
      content: { title: "", body: document.body, tags: [] },
      parentId: null,
      platform: document.platform,
      versionId: document.versionId,
      bodyRevision: document.bodyRevision,
    },
  };
  return { api, storyId, document, source };
}
beforeEach(() => {
  process.env.DATABASE_URL = "";
  resetMemoryStateForTesting();
  vi.clearAllMocks();
  ai.proposal.mockResolvedValue({
    text: "可以让这一句更简洁。确认后点生成新版本，再预览保存。",
    modelLabel: "test",
  });
  ai.text.mockResolvedValue(textResult());
});
describe("mobile uses the desktop proposal / candidate / explicit adoption workflow", () => {
  it("carries full draft through the real mobile router; chat and generation do not save, explicit adoption survives a reread", async () => {
    const { api, storyId, document, source } = await setup();
    await api.textDrafts.read({ storyId });
    expect(ai.proposal).not.toHaveBeenCalled();
    expect(ai.text).not.toHaveBeenCalled();
    const turn = {
      storyId,
      clientTurnId: "mobile-proposal",
      userClientMessageId: "mobile-user",
      assistantClientMessageId: "mobile-assistant",
      userContent: "让中间这句话更简洁",
    };
    const requestHash = computeStoryConversationTurnRequestHash(turn);
    const reply = await api.storyConversation.generateMobileTurn({
      ...turn,
      requestHash,
      writingContext: mobileWritingContext(source),
    });
    expect(reply.status).toBe("completed");
    expect(ai.proposal.mock.calls[0][0][0].content).toContain(
      "只讨论方案，不修改正文"
    );
    expect(JSON.stringify(ai.proposal.mock.calls[0][0])).toContain(
      document.body
    );
    await api.storyConversation.appendMobileTurn({
      storyId,
      clientTurnId: turn.clientTurnId,
      requestHash,
    });
    const history = await api.textDrafts.read({ storyId });
    const { publishing } = await api.publishingDraft.read({ storyId });
    const chat = await api.storyConversation.list({ storyId });
    const request = mobileTextDraftRequest({
      storyId,
      token: "mobile-candidate-1",
      publishing,
      history,
      source,
      messages: chat.messages
        .filter(m => m.role !== "system")
        .map(m => ({
          id: String(m.clientMessageId ?? m.id),
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      instruction: "",
    });
    const generated = await api.textDrafts.generate(request);
    const candidate = generated.versions.at(-1)!;
    expect(candidate.generated?.body).toBe("前文。新的表达。后文。");
    expect(candidate.adoption).toBeUndefined();
    expect((await api.publishingDraft.readBody({ storyId })).body).toBe(
      document.body
    );
    expect(candidate.conversationSnapshot.map(m => m.content)).toContain(
      turn.userContent
    );
    const saved = await api.textDrafts.adopt({
      storyId,
      versionId: candidate.id,
      expectedRevision: generated.revision,
      expectedPublishingRevision: publishing.revision,
      content: candidate.generated!,
      feedback: "",
    });
    expect((await api.publishingDraft.readBody({ storyId })).body).toBe(
      candidate.generated?.body
    );
    expect(
      (await api.textDrafts.read({ storyId })).versions.at(-1)?.adoption
        ?.content
    ).toEqual(candidate.generated);
    expect(saved.history.versions.at(-1)?.request.basis?.body).toBe(
      document.body
    );
    // Same token recovers a candidate without another model call.
    await api.textDrafts.generate(request);
    expect(ai.text).toHaveBeenCalledTimes(1);
  });
  it("mechanically preserves outside a mobile selection and rejects a save over a newer desktop edit", async () => {
    const { api, storyId, document, source } = await setup();
    source.text!.selection = { start: 3, end: 6 };
    ai.text.mockResolvedValue(textResult("换一种表达。"));
    const { publishing } = await api.publishingDraft.read({ storyId });
    const history = await api.textDrafts.read({ storyId });
    const result = await api.textDrafts.generate(
      mobileTextDraftRequest({
        storyId,
        token: "mobile-selection-1",
        publishing,
        history,
        source,
        messages: [],
        instruction: "改这句",
      })
    );
    const candidate = result.versions.at(-1)!;
    expect(candidate.generated?.body).toBe("前文。换一种表达。后文。");
    await api.publishingDraft.saveBody({
      storyId,
      versionId: document.versionId,
      platform: document.platform,
      baseBodyRevision: document.bodyRevision,
      body: "电脑的新修改",
    });
    await expect(
      api.textDrafts.adopt({
        storyId,
        versionId: candidate.id,
        expectedRevision: result.revision,
        expectedPublishingRevision: publishing.revision,
        content: candidate.generated!,
        feedback: "",
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await api.publishingDraft.readBody({ storyId })).body).toBe(
      "电脑的新修改"
    );
    expect(
      (await api.textDrafts.read({ storyId })).versions.at(-1)?.generated
    ).toEqual(candidate.generated);
    await expect(
      caller(872).textDrafts.read({ storyId })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
