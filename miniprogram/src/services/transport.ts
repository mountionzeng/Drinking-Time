import type {
  BalanceSummary,
  ConversationServerMessage,
  PublishingBodyDocument,
  PublishingPlatformId,
  StorySummary,
} from "../core/types";
import type {
  DocumentSaveRequest as WireDocumentSaveRequest,
  StoryCreateReceipt as WireStoryCreateReceipt,
  StoryCreateRequest as WireStoryCreateRequest,
  SubmitTurnRequest as WireSubmitTurnRequest,
  TurnStatusRequest as WireTurnStatusRequest,
  WorkspaceErrorKind,
} from "../contracts/workspace";
import type { RuntimeTransportKind } from "../core/runtimeMode";

/**
 * 小程序本地 transport 合同（冻结于“聊会儿”工作区计划 U1）。
 *
 * mock 与未来的 live 实现都必须完整实现这份接口。这里刻意**不**改 `shared/**`：
 * U4/U6 会把同一语义接到服务端与真实网络 transport。
 *
 * 三件事在这一层就定死，避免以后各写各的：
 * 1. 整轮幂等：submitTurn 以 requestHash 为键，重复提交不得产生第二次生成；
 * 2. 结果未知与失败是**两种**东西：未知只能查询，不能重跑；
 * 3. 正文保存是 CAS：带 baseBodyRevision，冲突时把服务端那份一起带回来。
 */

export type TransportErrorKind = WorkspaceErrorKind;

export type TransportError = {
  kind: TransportErrorKind;
  message: string;
  /** 能否用**同一个** turn / 同一份请求安全重试。 */
  retryable: boolean;
  /** 结果是否未知。未知时禁止重新生成，只能按同一 turn 查询。 */
  resultUnknown: boolean;
  /** 冲突时服务端那份正文；拿不到时为 null。 */
  latestDocument?: PublishingBodyDocument | null;
};

export type TransportResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: TransportError };

export function transportOk<T>(data: T): TransportResult<T> {
  return { ok: true, data };
}

export function transportFail<T>(
  error: Omit<TransportError, "retryable" | "resultUnknown"> &
    Partial<Pick<TransportError, "retryable" | "resultUnknown">>,
): TransportResult<T> {
  return {
    ok: false,
    error: {
      retryable:
        error.kind === "unavailable" || error.kind === "explicit-failure",
      resultUnknown: error.kind === "unknown-result",
      ...error,
    },
  };
}

export type StoryWorkspaceSnapshot = {
  story: StorySummary;
  messages: ConversationServerMessage[];
  document: PublishingBodyDocument;
  balance: BalanceSummary;
};

export type CreateStoryRequest = Omit<WireStoryCreateRequest, "contractVersion">;

export type CreateStoryResponse = {
  receipt: Omit<WireStoryCreateReceipt, "contractVersion" | "story"> & {
    story: StorySummary;
  };
  document: PublishingBodyDocument;
};

export type SubmitTurnRequest = Omit<WireSubmitTurnRequest, "contractVersion">;

export type SubmitTurnResponse = {
  assistantContent: string;
  /** 服务端是否已经把整轮落库。false 表示只生成了、还没入库。 */
  persisted: boolean;
  balance: BalanceSummary;
};

export type LookupTurnRequest = Omit<WireTurnStatusRequest, "contractVersion">;

export type LookupTurnResponse = {
  status: "synced" | "missing";
  assistantContent: string | null;
  balance: BalanceSummary | null;
};

export type SaveDocumentBodyRequest = Omit<
  WireDocumentSaveRequest,
  "contractVersion"
> & { platform: PublishingPlatformId };

export interface WorkspaceTransport {
  /** 界面据此打「演示数据」标识，禁止 mock 冒充 live。 */
  readonly kind: RuntimeTransportKind;
  listStories(): Promise<TransportResult<StorySummary[]>>;
  createStory(
    request: CreateStoryRequest,
  ): Promise<TransportResult<CreateStoryResponse>>;
  openStory(storyId: number): Promise<TransportResult<StoryWorkspaceSnapshot>>;
  submitTurn(
    request: SubmitTurnRequest,
  ): Promise<TransportResult<SubmitTurnResponse>>;
  lookupTurn(
    request: LookupTurnRequest,
  ): Promise<TransportResult<LookupTurnResponse>>;
  saveDocumentBody(
    request: SaveDocumentBodyRequest,
  ): Promise<TransportResult<{ document: PublishingBodyDocument }>>;
}

/**
 * live 配置不完整时使用的零数据 transport。
 *
 * 它只让启动页能够解释错误；即使绕过页面直接打开工作区，所有业务读取
 * 也只会失败，不会看见 mock Story、余额或回答。
 */
export function createBlockedWorkspaceTransport(
  message: string,
): WorkspaceTransport {
  const unavailable = async <T>(): Promise<TransportResult<T>> =>
    transportFail<T>({
      kind: "unavailable",
      message,
      retryable: false,
      resultUnknown: false,
    });

  return {
    kind: "blocked",
    listStories: () => unavailable(),
    createStory: () => unavailable(),
    openStory: () => unavailable(),
    submitTurn: () => unavailable(),
    lookupTurn: () => unavailable(),
    saveDocumentBody: () => unavailable(),
  };
}
