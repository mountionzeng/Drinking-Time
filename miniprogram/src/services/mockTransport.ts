import type {
  BalanceSummary,
  ConversationServerMessage,
  PublishingBodyDocument,
  StorySummary,
} from "../core/types";
import {
  transportFail,
  transportOk,
  type LookupTurnRequest,
  type LookupTurnResponse,
  type SaveDocumentBodyRequest,
  type StoryWorkspaceSnapshot,
  type SubmitTurnRequest,
  type SubmitTurnResponse,
  type TransportResult,
  type WorkspaceTransport,
} from "./transport";

/**
 * 确定性 mock transport。
 *
 * 硬约束：
 * - 不发任何网络请求、不调用模型、不写任何持久化，也不产生费用；
 * - 演示数据里没有任何真实姓名、地点、联系方式或账号信息；
 * - 同一个 requestHash 只「生成」一次，重复提交返回同一份结果
 *   （`generationCount` 就是这条约束的可观测证据）；
 * - 失败是**显式切换**出来的演示状态，绝不会静默变回看起来真实的成功。
 */

/**
 * 演示环境专用的不透明恢复作用域。
 *
 * 它是写死的常量，明确只属于 mock：不由邮箱、openid、昵称或 userId 推导，
 * 也**不得**在 live 模式沿用为真实身份 —— live 的 scope 必须由服务端下发。
 */
export const DEMO_RECOVERY_SCOPE = "mock-demo-scope-v1";

const DEMO_BALANCE_START_CENTS = 3000;
const DEMO_TURN_COST_CENTS = 12;

export const DEMO_STORIES: readonly StorySummary[] = [
  { id: 9001, title: "演示 · 一杯温热的黄酒", updatedAt: 1_759_900_000_000 },
  { id: 9002, title: "演示 · 雨天的便利店", updatedAt: 1_759_800_000_000 },
];

const DEMO_BODIES: Record<number, string> = {
  9001: "演示正文：那杯黄酒端上来的时候，杯壁上还挂着一层白气。",
  9002: "演示正文：雨下得很急，便利店的灯把地面照成一片浅黄色。",
};

const DEMO_SEED_MESSAGES: Record<number, ConversationServerMessage[]> = {
  9001: [
    {
      id: 1,
      role: "assistant",
      content: "（演示数据）上次我们聊到那杯黄酒的温度。今天想从哪里接着说？",
      clientMessageId: null,
      createdAt: "2026-09-01T10:00:00.000Z",
    },
  ],
  9002: [],
};

export type MockFailureMode =
  | "none"
  | "list-stories"
  | "open-story"
  | "submit-turn-unknown"
  | "submit-turn-failed"
  | "save-conflict"
  | "insufficient-balance";

export type MockTransport = WorkspaceTransport & {
  /** 「生成」发生的次数。重复提交同一 requestHash 不得让它增加。 */
  readonly generationCount: number;
  failureMode: MockFailureMode;
  setFailureMode(mode: MockFailureMode): void;
  reset(): void;
};

export function createMockTransport(): MockTransport {
  let generationCount = 0;
  let balanceCents = DEMO_BALANCE_START_CENTS;
  let lastCostCents: number | null = null;
  const answersByHash = new Map<string, string>();
  const documents = new Map<number, PublishingBodyDocument>();

  function seed(): void {
    documents.clear();
    for (const story of DEMO_STORIES) {
      documents.set(story.id, {
        storyId: story.id,
        storyRevision: 1,
        versionId: `demo-version-${story.id}`,
        platform: "xiaohongshu",
        body: DEMO_BODIES[story.id] ?? "演示正文",
        bodyRevision: 1,
        updatedAt: 1_759_900_000_000,
      });
    }
  }
  seed();

  function balance(): BalanceSummary {
    return {
      availableCents: balanceCents,
      lastCostCents,
      currency: "CNY",
      demo: true,
    };
  }

  /** 确定性「回答」：同一句话永远得到同一段文字，不依赖任何模型。 */
  function demoAnswer(userContent: string): string {
    const trimmed = userContent.trim();
    const shape = trimmed.length <= 12 ? "短" : "长";
    return `（演示回答，未调用任何模型）我听到的是「${trimmed}」。这是一句${shape}的话，接下来可以说说当时的声音或温度。`;
  }

  const transport: MockTransport = {
    kind: "mock",
    failureMode: "none",

    get generationCount() {
      return generationCount;
    },

    setFailureMode(mode) {
      transport.failureMode = mode;
      if (mode === "insufficient-balance") balanceCents = 0;
    },

    reset() {
      generationCount = 0;
      balanceCents = DEMO_BALANCE_START_CENTS;
      lastCostCents = null;
      answersByHash.clear();
      transport.failureMode = "none";
      seed();
    },

    async listStories(): Promise<TransportResult<StorySummary[]>> {
      if (transport.failureMode === "list-stories") {
        return transportFail({
          kind: "unavailable",
          message: "演示：故意让 transport 失败，用来验证空态与重试。",
        });
      }
      return transportOk(DEMO_STORIES.slice());
    },

    async openStory(storyId): Promise<TransportResult<StoryWorkspaceSnapshot>> {
      if (transport.failureMode === "open-story") {
        return transportFail({
          kind: "unavailable",
          message: "演示：打开 Story 失败，用来验证重试路径。",
        });
      }
      const story = DEMO_STORIES.find(item => item.id === storyId);
      const document = documents.get(storyId);
      if (!story || !document) {
        return transportFail({
          kind: "target-missing",
          message: "演示 Story 不存在。",
        });
      }
      return transportOk({
        story,
        messages: (DEMO_SEED_MESSAGES[storyId] ?? []).slice(),
        document,
        balance: balance(),
      });
    },

    async submitTurn(
      request: SubmitTurnRequest,
    ): Promise<TransportResult<SubmitTurnResponse>> {
      if (transport.failureMode === "submit-turn-unknown") {
        return transportFail({
          kind: "timeout",
          message: "演示：这一轮结果未知。请用「查询结果」，不要重发。",
        });
      }
      if (transport.failureMode === "submit-turn-failed") {
        return transportFail({
          kind: "unavailable",
          message: "演示：这一轮明确失败，可以用同一轮重试。",
        });
      }
      if (transport.failureMode === "insufficient-balance" || balanceCents <= 0) {
        return transportFail({
          kind: "insufficient-balance",
          message: "演示：余额不足，无法发起新的付费调用；正文仍可继续编辑。",
        });
      }

      // 整轮幂等：同一个 requestHash 只生成一次。
      const cached = answersByHash.get(request.requestHash);
      if (cached) {
        return transportOk({
          assistantContent: cached,
          persisted: true,
          balance: balance(),
        });
      }
      generationCount += 1;
      const answer = demoAnswer(request.userContent);
      answersByHash.set(request.requestHash, answer);
      lastCostCents = DEMO_TURN_COST_CENTS;
      balanceCents = Math.max(0, balanceCents - DEMO_TURN_COST_CENTS);
      return transportOk({
        assistantContent: answer,
        persisted: true,
        balance: balance(),
      });
    },

    async lookupTurn(
      request: LookupTurnRequest,
    ): Promise<TransportResult<LookupTurnResponse>> {
      const cached = answersByHash.get(request.requestHash);
      if (!cached) {
        return transportOk({
          status: "missing",
          assistantContent: null,
          balance: balance(),
        });
      }
      return transportOk({
        status: "synced",
        assistantContent: cached,
        balance: balance(),
      });
    },

    async saveDocumentBody(
      request: SaveDocumentBodyRequest,
    ): Promise<TransportResult<{ document: PublishingBodyDocument }>> {
      const current = documents.get(request.storyId);
      if (!current) {
        return transportFail({
          kind: "target-missing",
          message: "演示：这份正文的目标已经不存在。",
          latestDocument: null,
        });
      }
      if (transport.failureMode === "save-conflict") {
        const moved: PublishingBodyDocument = {
          ...current,
          body: "演示：别的设备刚刚改过的正文。",
          bodyRevision: current.bodyRevision + 1,
        };
        documents.set(request.storyId, moved);
        return transportFail({
          kind: "conflict",
          message: "演示：正文已在别处更新，两份文本都保留。",
          latestDocument: moved,
        });
      }
      if (current.bodyRevision !== request.baseBodyRevision) {
        return transportFail({
          kind: "conflict",
          message: "演示：本次保存基于过期的版本，两份文本都保留。",
          latestDocument: current,
        });
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

  return transport;
}
