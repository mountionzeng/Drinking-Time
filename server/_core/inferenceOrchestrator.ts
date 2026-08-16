import {
  describeModelCapabilities,
  resolveComputeCandidates,
  type ComputeCandidateOptions,
  type ModelCapabilities,
  type TextComputeProvider,
  type TextComputeProviderId,
  type TextComputeUseCase,
} from "./textComputeProvider";
import type {
  ImageContent,
  InvokeResult,
  JsonSchema,
  Message,
  MessageContent,
  ResponseFormat,
  TextContent,
  Tool,
  ToolChoice,
  ToolChoiceExplicit,
  FileContent,
} from "./llm";

/**
 * 一次尝试失败的归一化描述。编排规则只读这些字段，**不解析 adapter 的错误
 * 文案**——文案随网关版本漂移，用它做控制流会在供应商改一个字后失效。
 */
export type AttemptErrorCategory =
  | "network"
  | "timeout"
  | "rate_limit"
  | "server_error"
  | "auth"
  | "invalid_request"
  | "content_safety"
  | "context_length"
  | "aborted"
  | "unknown";

export type AttemptError = {
  provider: TextComputeProviderId;
  model: string;
  status?: number;
  category: AttemptErrorCategory;
  /** 供应商返回的机器可读 error code，只在其形如安全短标识时保留。 */
  errorCode?: string;
  retryAfterMs?: number;
  aborted: boolean;
  /** 请求是否可能已被受理（发出后连接中断）——决定能否安全重放。 */
  acceptanceUnknown: boolean;
};

export class InferenceError extends Error {
  readonly attempts: readonly AttemptError[];
  readonly category: AttemptErrorCategory;

  constructor(message: string, attempts: readonly AttemptError[]) {
    super(message);
    this.name = "InferenceError";
    this.attempts = attempts;
    this.category = attempts[attempts.length - 1]?.category ?? "unknown";
  }
}

export type InferenceProtocol = "openai-compatible" | "claude-messages";

/**
 * `endpointUrl` 让非 chat/completions 协议（Anthropic Messages 走 `/v1/messages`）
 * 复用同一条编排链；不填时用 U1 解析出的 chat/completions 地址。
 */
export type InferenceCandidate = TextComputeProvider & { endpointUrl?: string };

export type InferenceRequest = {
  useCase: TextComputeUseCase;
  messages: Message[];
  /** OpenAI Next 不可用时的 302 模型与凭据，透传给 U1 的候选解析。 */
  candidates: ComputeCandidateOptions;
  /**
   * 绕过 U1 候选解析，直接指定候选链。给 Claude 通道这类还没并入统一路由的
   * 协议用，让它们至少先共享同一个 retry / 错误分类 owner。
   */
  explicitCandidates?: InferenceCandidate[];
  tools?: Tool[];
  toolChoice?: ToolChoice;
  maxTokens?: number;
  temperature?: number;
  responseFormat?: ResponseFormat;
  thinkingBudgetTokens?: number;
  /**
   * 调用方必须显式声明这次请求跨供应商重放是安全的。默认 fail closed：
   * 没声明就绝不换供应商重发。
   */
  replaySafe?: boolean;
  /** 整个候选链的外层预算；切换候选不重置。 */
  deadlineMs?: number;
  signal?: AbortSignal;
  protocol?: InferenceProtocol;
  /** 测试注入点。 */
  fetchImpl?: typeof fetch;
  now?: () => number;
  backoffMs?: number;
};

export type InferenceOutcome = {
  result: InvokeResult;
  provider: TextComputeProviderId;
  providerLabel: string;
  model: string;
  latencyMs: number;
  /** 前面失败过的尝试，供调用方做可观测性判断。 */
  priorFailures: readonly AttemptError[];
};

const MAX_PROVIDER_ATTEMPTS = 2;

/** 收敛前 agentChannel 用的就是这个值，保持不变。 */
const TRANSIENT_BACKOFF_MS = 700;

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** 只有这些类别在显式 replay-safe 时才允许换供应商重发。 */
const REPLAYABLE_CATEGORIES = new Set<AttemptErrorCategory>([
  "network",
  "timeout",
  "rate_limit",
  "server_error",
]);

// ── 消息 / 参数规范化（自 llm.ts 迁入，保持既有契约）──

const ensureArray = (
  value: MessageContent | MessageContent[]
): MessageContent[] => (Array.isArray(value) ? value : [value]);

const normalizeContentPart = (
  part: MessageContent
): TextContent | ImageContent | FileContent => {
  if (typeof part === "string") return { type: "text", text: part };
  if (part.type === "text") return part;
  if (part.type === "image_url") return part;
  if (part.type === "file_url") return part;
  throw new Error("Unsupported message content part");
};

export const normalizeMessage = (message: Message) => {
  const { role, name, tool_call_id } = message;

  if (role === "tool" || role === "function") {
    const content = ensureArray(message.content)
      .map(part => (typeof part === "string" ? part : JSON.stringify(part)))
      .join("\n");
    return { role, name, tool_call_id, content };
  }

  const contentParts = ensureArray(message.content).map(normalizeContentPart);

  // 纯文本折叠回字符串，保持与旧网关的兼容。
  if (contentParts.length === 1 && contentParts[0].type === "text") {
    return { role, name, content: contentParts[0].text };
  }

  return { role, name, content: contentParts };
};

export const normalizeToolChoice = (
  toolChoice: ToolChoice | undefined,
  tools: Tool[] | undefined
): "none" | "auto" | ToolChoiceExplicit | undefined => {
  if (!toolChoice) return undefined;
  if (toolChoice === "none" || toolChoice === "auto") return toolChoice;

  if (toolChoice === "required") {
    if (!tools || tools.length === 0) {
      throw new Error(
        "tool_choice 'required' was provided but no tools were configured"
      );
    }
    if (tools.length > 1) {
      throw new Error(
        "tool_choice 'required' needs a single tool or specify the tool name explicitly"
      );
    }
    return { type: "function", function: { name: tools[0].function.name } };
  }

  if ("name" in toolChoice) {
    return { type: "function", function: { name: toolChoice.name } };
  }

  return toolChoice;
};

// ── 重放安全性 ──

/**
 * 结构上是否允许跨供应商重放。与调用方的 `replaySafe` 声明是「且」关系：
 * 调用方说安全，但消息里带着工具续写，仍然不重放——换一家供应商续写
 * 另一家发起的 tool call 是无意义的，还可能重复触发副作用。
 */
export function isStructurallyReplaySafe(request: InferenceRequest): boolean {
  if (request.tools && request.tools.length > 0) return false;
  return !request.messages.some(
    message =>
      message.role === "tool" ||
      message.role === "function" ||
      Boolean(message.tool_call_id)
  );
}

// ── 错误分类 ──

const SAFE_ERROR_CODE = /^[a-z0-9_.-]{1,64}$/i;

function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return Math.floor(seconds * 1000);
  const at = Date.parse(header);
  if (Number.isFinite(at)) return Math.max(0, at - Date.now());
  return undefined;
}

function categorizeStatus(status: number): AttemptErrorCategory {
  if (status === 401 || status === 403) return "auth";
  if (status === 408) return "timeout";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "server_error";
  if (status === 413 || status === 422) return "invalid_request";
  if (status === 400) return "invalid_request";
  return "unknown";
}

/**
 * 从响应正文里只提取机器可读的 error code —— **正文本身永远不进日志或异常**，
 * 供应商会把用户 prompt 原样回显在 error message 里。
 */
function extractSafeErrorCode(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as {
      error?: { code?: unknown; type?: unknown };
    };
    const raw = parsed.error?.code ?? parsed.error?.type;
    if (typeof raw === "string" && SAFE_ERROR_CODE.test(raw)) return raw;
  } catch {
    // 非 JSON 正文没有可安全提取的字段，直接放弃。
  }
  return undefined;
}

function refineCategory(
  status: number,
  errorCode: string | undefined
): AttemptErrorCategory {
  const base = categorizeStatus(status);
  if (base !== "invalid_request" || !errorCode) return base;
  const code = errorCode.toLowerCase();
  if (code.includes("content_filter") || code.includes("content_policy")) {
    return "content_safety";
  }
  if (code.includes("context_length") || code.includes("too_many_tokens")) {
    return "context_length";
  }
  return base;
}

function classifyThrown(error: unknown): {
  category: AttemptErrorCategory;
  aborted: boolean;
} {
  if (error instanceof Error && error.name === "AbortError") {
    return { category: "aborted", aborted: true };
  }
  if (error instanceof Error && error.name === "TimeoutError") {
    return { category: "timeout", aborted: false };
  }
  return { category: "network", aborted: false };
}

// ── payload 构建 ──

type PayloadOptions = {
  /** 参数降级后为 true：只发最小兼容字段。 */
  minimal: boolean;
};

export function buildOpenAiPayload(
  request: InferenceRequest,
  candidate: TextComputeProvider,
  capabilities: ModelCapabilities,
  options: PayloadOptions
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    model: candidate.model,
    messages: request.messages.map(normalizeMessage),
  };

  // tools 承载业务语义，降级时也绝不丢弃——丢了就是换了一个请求。
  if (request.tools && request.tools.length > 0) {
    payload.tools = request.tools;
  }

  // 校验必须无条件执行：声明了 tool_choice 却没配 tool 是调用方的错误，
  // 要当场报出来，不能因为没有 tools 就跳过检查静默发一个变了味的请求。
  const toolChoice = normalizeToolChoice(request.toolChoice, request.tools);
  if (toolChoice) payload.tool_choice = toolChoice;

  payload[capabilities.tokenLimitField] = request.maxTokens ?? 8192;

  if (options.minimal) return payload;

  if (typeof request.temperature === "number" && capabilities.supportsTemperature) {
    payload.temperature = request.temperature;
  }

  if (request.responseFormat) {
    payload.response_format = capabilities.supportsStructuredOutputs
      ? request.responseFormat
      : downgradeResponseFormat(request.responseFormat);
  }

  if (
    typeof request.thinkingBudgetTokens === "number" &&
    request.thinkingBudgetTokens > 0
  ) {
    payload.thinking = {
      budget_tokens: Math.floor(request.thinkingBudgetTokens),
    };
  }

  return payload;
}

/**
 * 未登记 / 不支持 strict schema 的模型收不到 json_schema，但仍要保住
 * 「必须返回 JSON」这层语义，否则上层解析一定失败。
 */
function downgradeResponseFormat(
  format: ResponseFormat
): { type: "text" } | { type: "json_object" } {
  return format.type === "text" ? { type: "text" } : { type: "json_object" };
}

// ── adapter：只做一次请求，不重试、不选下家 ──

type AttemptResult =
  | { ok: true; result: InvokeResult }
  | { ok: false; error: AttemptError };

function endpointFor(candidate: InferenceCandidate): string {
  return candidate.endpointUrl ?? candidate.chatCompletionsUrl;
}

async function attemptOpenAiCompatible(
  request: InferenceRequest,
  candidate: InferenceCandidate,
  capabilities: ModelCapabilities,
  options: PayloadOptions,
  signal: AbortSignal | undefined
): Promise<AttemptResult> {
  const doFetch = request.fetchImpl ?? fetch;
  const payload = buildOpenAiPayload(request, candidate, capabilities, options);

  let response: Response;
  try {
    response = await doFetch(endpointFor(candidate), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${candidate.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (error) {
    const { category, aborted } = classifyThrown(error);
    return {
      ok: false,
      error: {
        provider: candidate.id,
        model: candidate.model,
        category,
        aborted,
        // 连接在发出后断开时无法判断网关是否已受理。
        acceptanceUnknown: !aborted,
      },
    };
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const errorCode = extractSafeErrorCode(body);
    return {
      ok: false,
      error: {
        provider: candidate.id,
        model: candidate.model,
        status: response.status,
        category: refineCategory(response.status, errorCode),
        errorCode,
        retryAfterMs: parseRetryAfterMs(response.headers.get("retry-after")),
        aborted: false,
        // 网关明确拒绝 = 未受理。
        acceptanceUnknown: false,
      },
    };
  }

  return { ok: true, result: (await response.json()) as InvokeResult };
}

type ClaudeMessageResponse = {
  content?: Array<{ type?: string; text?: string }>;
  model?: string;
};

function toAnthropicMessages(messages: Message[]) {
  return messages
    .filter(m => m.role !== "system")
    .map(m => {
      const role = m.role === "assistant" ? "assistant" : "user";
      if (!Array.isArray(m.content)) return { role, content: String(m.content) };

      const parts = m.content.map(part => {
        if (typeof part === "string") return { type: "text" as const, text: part };
        if (part.type === "text") return part;
        if (part.type === "image_url") {
          const url = part.image_url.url;
          if (url.startsWith("data:")) {
            const match = url.match(/^data:(image\/\w+);base64,(.+)$/);
            if (match) {
              return {
                type: "image" as const,
                source: {
                  type: "base64" as const,
                  media_type: match[1],
                  data: match[2],
                },
              };
            }
          }
          return { type: "image" as const, source: { type: "url" as const, url } };
        }
        return { type: "text" as const, text: JSON.stringify(part) };
      });
      return { role, content: parts };
    });
}

async function attemptClaudeMessages(
  request: InferenceRequest,
  candidate: InferenceCandidate,
  signal: AbortSignal | undefined
): Promise<AttemptResult> {
  const doFetch = request.fetchImpl ?? fetch;
  const system = request.messages
    .filter(m => m.role === "system")
    .map(m => String(m.content))
    .join("\n\n");

  let response: Response;
  try {
    response = await doFetch(endpointFor(candidate), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": candidate.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: candidate.model,
        max_tokens: request.maxTokens ?? 8192,
        system,
        messages: toAnthropicMessages(request.messages),
      }),
      signal,
    });
  } catch (error) {
    const { category, aborted } = classifyThrown(error);
    return {
      ok: false,
      error: {
        provider: candidate.id,
        model: candidate.model,
        category,
        aborted,
        acceptanceUnknown: !aborted,
      },
    };
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const errorCode = extractSafeErrorCode(body);
    return {
      ok: false,
      error: {
        provider: candidate.id,
        model: candidate.model,
        status: response.status,
        category: refineCategory(response.status, errorCode),
        errorCode,
        retryAfterMs: parseRetryAfterMs(response.headers.get("retry-after")),
        aborted: false,
        acceptanceUnknown: false,
      },
    };
  }

  const data = (await response.json()) as ClaudeMessageResponse;
  const text =
    data.content
      ?.filter(block => block.type === "text" && block.text)
      .map(block => block.text)
      .join("\n")
      .trim() || "";

  // 归一成 InvokeResult，让编排层对两种协议只有一个结果形状。
  return {
    ok: true,
    result: {
      id: "",
      created: Math.floor(Date.now() / 1000),
      model: data.model || candidate.model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: text },
          finish_reason: null,
        },
      ],
    },
  };
}

// ── 日志脱敏 ──

/**
 * 只允许这些字段进日志。messages、图片 data URL、工具参数、响应正文和 Key
 * 都不在其中，也不会被间接带出去。
 */
function redactedAttemptLog(error: AttemptError, latencyMs: number) {
  return {
    provider: error.provider,
    model: error.model,
    status: error.status,
    category: error.category,
    errorCode: error.errorCode,
    latencyMs,
    aborted: error.aborted,
  };
}

function attemptSummary(error: AttemptError): string {
  const status = error.status ? ` ${error.status}` : "";
  return `${error.provider}/${error.model}${status} (${error.category})`;
}

// ── 编排 ──

export async function runInference(
  request: InferenceRequest
): Promise<InferenceOutcome> {
  const now = request.now ?? (() => Date.now());
  const startedAt = now();
  const chainDeadlineAt =
    typeof request.deadlineMs === "number"
      ? startedAt + request.deadlineMs
      : undefined;

  const resolved: InferenceCandidate[] =
    request.explicitCandidates ??
    resolveComputeCandidates(request.useCase, request.candidates);

  // 预算是「2 次尝试」，不是「2 家供应商」。只配了一家时仍然把同一个端点
  // 排两次——否则网关抖动的可重放请求会比收敛前少一次机会。
  const candidates =
    resolved.length === 1 ? [resolved[0], resolved[0]] : resolved;

  if (candidates.length === 0) {
    throw new InferenceError(
      "LLM invoke failed: no text compute provider is configured (OPENAI_NEXT_API_KEY / API302_KEY)",
      []
    );
  }

  const protocol = request.protocol ?? "openai-compatible";
  const callerAllowsReplay =
    request.replaySafe === true && isStructurallyReplaySafe(request);

  const failures: AttemptError[] = [];
  let attemptsUsed = 0;
  let candidateIndex = 0;
  let minimalPayload = false;

  while (attemptsUsed < MAX_PROVIDER_ATTEMPTS && candidateIndex < candidates.length) {
    if (request.signal?.aborted) {
      throw new InferenceError("LLM invoke aborted by caller", failures);
    }
    const remainingMs =
      chainDeadlineAt === undefined ? undefined : chainDeadlineAt - now();
    if (remainingMs !== undefined && remainingMs <= 0) break;

    const candidate = candidates[candidateIndex];
    const capabilities = describeModelCapabilities(candidate.model);
    const attemptStartedAt = now();

    // 每次尝试只拿链上**剩余**预算，换候选不重置。
    const timeoutSignal =
      remainingMs === undefined ? undefined : AbortSignal.timeout(remainingMs);
    const signal = mergeSignals(request.signal, timeoutSignal);

    const attempt =
      protocol === "claude-messages"
        ? await attemptClaudeMessages(request, candidate, signal)
        : await attemptOpenAiCompatible(
            request,
            candidate,
            capabilities,
            { minimal: minimalPayload },
            signal
          );

    attemptsUsed += 1;
    const latencyMs = now() - attemptStartedAt;

    if (attempt.ok) {
      return {
        result: attempt.result,
        provider: candidate.id,
        providerLabel: candidate.label,
        model: candidate.model,
        latencyMs,
        priorFailures: failures,
      };
    }

    failures.push(attempt.error);
    console.warn("[inference] attempt failed", redactedAttemptLog(attempt.error, latencyMs));

    if (attempt.error.aborted) {
      // 调用方取消 → 立刻终止整条候选链，不再尝试任何供应商。
      throw new InferenceError("LLM invoke aborted by caller", failures);
    }

    if (attempt.error.category === "auth") {
      // 鉴权失败换一家也是错的配置，而且会把坏 Key 的问题掩盖成「网关不稳」。
      console.error("[inference] provider auth rejected — check credentials", {
        provider: attempt.error.provider,
        status: attempt.error.status,
      });
      break;
    }

    // 400/422：只做一次预定义的确定性降级，且留在同一家。
    if (
      attempt.error.category === "invalid_request" &&
      !minimalPayload &&
      protocol === "openai-compatible" &&
      hasDowngradableFields(request, capabilities)
    ) {
      minimalPayload = true;
      continue;
    }

    if (!callerAllowsReplay) break;
    if (!REPLAYABLE_CATEGORIES.has(attempt.error.category)) break;
    if (attempt.error.acceptanceUnknown && !request.replaySafe) break;

    // 网关抖动时立刻重发往往撞上同一个坏连接，所以保留一个短退避；
    // 供应商给了 Retry-After 就听它的。
    const waitMs =
      attempt.error.retryAfterMs ?? request.backoffMs ?? TRANSIENT_BACKOFF_MS;
    const remainingForWait =
      chainDeadlineAt === undefined ? undefined : chainDeadlineAt - now();
    // 等不起就别等——宁可直接放弃，也不要把预算耗在等待上。
    if (remainingForWait !== undefined && waitMs > remainingForWait) break;
    if (waitMs > 0) await delay(waitMs);

    candidateIndex += 1;
    minimalPayload = false;
  }

  const detail = failures.map(attemptSummary).join("; ") || "no attempt completed";
  throw new InferenceError(`LLM invoke failed: ${detail}`, failures);
}

function hasDowngradableFields(
  request: InferenceRequest,
  capabilities: ModelCapabilities
): boolean {
  if (typeof request.temperature === "number" && capabilities.supportsTemperature) {
    return true;
  }
  if (request.responseFormat) return true;
  if (typeof request.thinkingBudgetTokens === "number") return true;
  return false;
}

function mergeSignals(
  a: AbortSignal | undefined,
  b: AbortSignal | undefined
): AbortSignal | undefined {
  if (!a) return b;
  if (!b) return a;
  return AbortSignal.any([a, b]);
}

export type { JsonSchema };
