import type {
  BalanceSummary,
  ConversationServerMessage,
  PublishingBodyDocument,
  PublishingPlatformId,
  StorySummary,
} from "../core/types";

/**
 * 小程序本地 transport 合同（冻结于 U3）。
 *
 * mock 与未来的 live 实现都必须完整实现这份接口。这里刻意**不**改 `shared/**`：
 * U6 由账号／服务端文件释放后的那条线把同一语义提升成真正的跨端共享合同。
 *
 * 三件事在这一层就定死，避免以后各写各的：
 * 1. 整轮幂等：submitTurn 以 requestHash 为键，重复提交不得产生第二次生成；
 * 2. 结果未知与失败是**两种**东西：未知只能查询，不能重跑；
 * 3. 正文保存是 CAS：带 baseBodyRevision，冲突时把服务端那份一起带回来。
 */

export type TransportErrorKind =
  | "unavailable"
  | "timeout"
  | "unknown-result"
  | "conflict"
  | "target-missing"
  | "insufficient-balance"
  | "rejected"
  | "internal";

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
      retryable: error.kind !== "rejected" && error.kind !== "insufficient-balance",
      resultUnknown: error.kind === "timeout" || error.kind === "unknown-result",
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

export type SubmitTurnRequest = {
  storyId: number;
  clientTurnId: string;
  requestHash: string;
  userClientMessageId: string;
  assistantClientMessageId: string;
  userContent: string;
};

export type SubmitTurnResponse = {
  assistantContent: string;
  /** 服务端是否已经把整轮落库。false 表示只生成了、还没入库。 */
  persisted: boolean;
  balance: BalanceSummary;
};

export type LookupTurnRequest = {
  storyId: number;
  clientTurnId: string;
  requestHash: string;
};

export type LookupTurnResponse = {
  status: "synced" | "missing";
  assistantContent: string | null;
  balance: BalanceSummary | null;
};

export type SaveDocumentBodyRequest = {
  storyId: number;
  versionId: string;
  platform: PublishingPlatformId;
  baseBodyRevision: number;
  body: string;
};

export interface WorkspaceTransport {
  /** 界面据此打「演示数据」标识，禁止 mock 冒充 live。 */
  readonly kind: "mock" | "live";
  listStories(): Promise<TransportResult<StorySummary[]>>;
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
