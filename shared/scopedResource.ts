/**
 * 跨层 Story/Publishing 资源作用域合同（U2）。
 *
 * 这个模块只定义类型和纯函数，不做任何 I/O：它是 router、service、client
 * Context 之间共享的"资源身份 + revision"词汇表，取代此前各层各自用
 * `activeStoryId === xxx.storyId` 这类零散比较表达同一件事。
 *
 * 接线现状（2026-08-15，U7 结束时）：只有 `ScopeKey` 类型和 `scopeKeysEqual`
 * 有真实生产调用方（publishingHandoffScope.ts、storySpine.ts、publishingDraft.ts）。
 * 其余导出函数至今没有生产调用方——U3 做的是本地持久化原子性、U7 做的是缓存
 * 失效收窄，都没有接线这套合同。是否保留、还是随 seam 收敛一起删掉，交给 U8
 * 决定；不要因为"它已经在这里"就假设它已被使用。
 */

/** 目前需要独立身份的资源种类；新增种类时在这里扩展，不要用字符串字面量散落各处代替。 */
export type ResourceKind =
  | "story"
  | "publishingVersion"
  | "stableShot"
  | "cover";

/**
 * 资源身份。刻意不包含 userId —— owner 校验是另一个正交维度（见
 * `buildOwnerScope`），不能通过在 ScopeKey 里塞 userId 造成"谁读到就是谁的"
 * 的错觉。同一 storyId 下，不同资源种类各自携带自己的稳定 ID。
 */
export type ScopeKey =
  | { resourceKind: "story"; storyId: number }
  | { resourceKind: "publishingVersion"; storyId: number; versionId: string }
  | { resourceKind: "stableShot"; storyId: number; stableShotId: string }
  | { resourceKind: "cover"; storyId: number; versionId: string };

/**
 * 一个资源同时持有的两种 revision：`resourceRevision` 是该资源自身的写入
 * 冲突条件；`aggregateRevision` 只用于驱动上层投影失效，不能被用作阻塞
 * 无关资源写入的前置条件（这是本周多次"改一个地方其他地方跟着变"的根因
 * 之一：把聚合 revision 误当成了资源级锁）。
 */
export type ScopedRevision = {
  resourceRevision: number;
  aggregateRevision: number;
};

/**
 * 领域命令信封。UI 只能发送"对某个 scope 的一个局部 payload"，不能把客户端
 * 完整投影整体回写服务端；`expectedResourceRevision` 是唯一的写入冲突判定
 * 依据，服务端不得用 aggregateRevision 顶替。
 */
export type DomainCommand<TPayload> = {
  scope: ScopeKey;
  expectedResourceRevision: number;
  payload: TPayload;
};

/**
 * 服务端权威 owner scope：`ownerUserId` 只能来自认证会话（router 里的
 * `ctx.user.id`），不能来自任何客户端提交的字段。即使调用方误传入一个带
 * `userId` 的原始对象当作 `scope` 参数，这里的返回值里也不会出现它——
 * 类型上 ScopeKey 本就没有 userId 字段，这个函数是这份不变量的唯一书面入口。
 */
export type OwnerScope = {
  ownerUserId: number;
  scope: ScopeKey;
};

/**
 * 用途：把 session authenticated 的 owner id 和一个资源 scope 组装成
 *   persistence 层需要的 owner scope。注意这个函数本身**不做任何字段过滤**——
 *   `scope` 里出现的任何额外字段都会原样透传。它不是"防止客户端 userId 混入"
 *   的执行点，那一步必须由调用方先用 `parseScopeKey` 解析未经信任的输入完成；
 *   本函数只负责"owner 只取 sessionOwnerUserId 参数，绝不读 scope 里的任何字段"
 *   这一半的合同——调用方必须自己保证传入的 `scope` 已经是干净的。
 * 调用入口（至今没有生产调用方，留给 U8——U3 做的是本地持久化原子性，
 *   并没有接线这套合同）：router/service 在执行任何 Story/Publishing
 *   读写前，先用 `parseScopeKey` 解析出干净的 ScopeKey，再和 `ctx.user.id`
 *   一起调用本函数得到持久化层需要的 owner scope。
 * 下游调用：server/services/storyBodyPersistence.ts、publishingPersistence.ts
 *   等领域 persistence 模块的 owner-scoped 读写入口。
 */
export function buildOwnerScope(
  sessionOwnerUserId: number,
  scope: ScopeKey
): OwnerScope {
  return { ownerUserId: sessionOwnerUserId, scope };
}

// U2 曾在这里放过一个 `deriveClientCacheScopeKey`，用来给 query cache 加
// `cacheUserId` 分区，防同一浏览器多账号串数据。U7 删掉了它——但要说清楚原因，
// 因为最初写下的理由是错的：并非"每条身份切换路径都整页跳转"。实际上只有登出
// （TopBar 里的 `window.location.href`）会销毁 JS 堆；邀请码登录走的是 wouter
// 的 SPA 跳转，会话过期后的重定向也是 SPA 的 `<Redirect to="/login" />`，两者
// 都不销毁 react-query 缓存。跨身份串数据是真实存在的。
// 选择删除而不是保留这层，是因为 cacheUserId 要穿进 100+ 个调用点才能生效，
// 而同一个问题在身份切换那一个点上清一次缓存就彻底解决了——见
// `client/src/_core/hooks/useAuth.ts` 的 `refreshAfterIdentityChange`。
// 一个正确的窄修复优于一层需要处处配合才成立的抽象。

function isFiniteNonNegativeInt(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isInteger(value) && value >= 0
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * 用途：严格解析未知输入为 ScopeKey；缺少 storyId、resourceKind 或该
 *   resourceKind 要求的稳定资源 ID 一律解析失败（返回 null），不做猜测式回退。
 *   这是唯一负责从不可信输入中剔除多余字段（比如伪造的 userId）的校验点——
 *   `buildOwnerScope` 本身不做这件事，必须先经过本函数。
 * 调用入口（至今没有生产调用方，留给 U8——U3 做的是本地持久化原子性，
 *   并没有接线这套合同）：router 输入校验层、`parseDomainCommand`。
 * 下游调用：`scopeKeysEqual`、`buildOwnerScope`。
 */
export function parseScopeKey(candidate: unknown): ScopeKey | null {
  if (!candidate || typeof candidate !== "object") return null;
  const raw = candidate as Record<string, unknown>;
  if (!isFiniteNonNegativeInt(raw.storyId)) return null;
  const storyId = raw.storyId;

  switch (raw.resourceKind) {
    case "story":
      return { resourceKind: "story", storyId };
    case "publishingVersion":
      return isNonEmptyString(raw.versionId)
        ? { resourceKind: "publishingVersion", storyId, versionId: raw.versionId }
        : null;
    case "stableShot":
      return isNonEmptyString(raw.stableShotId)
        ? { resourceKind: "stableShot", storyId, stableShotId: raw.stableShotId }
        : null;
    case "cover":
      return isNonEmptyString(raw.versionId)
        ? { resourceKind: "cover", storyId, versionId: raw.versionId }
        : null;
    default:
      return null;
  }
}

/**
 * 用途：判断两个 ScopeKey 是否指向同一资源；替代此前各处手写的
 *   `a.storyId === b.storyId` 之类的临时比较（这类比较容易在只改一侧字段时
 *   漏掉另一侧，是"迟到响应污染新 scope"的常见成因）。
 * 调用入口：client 迟到响应丢弃判断——目前已在
 *   `client/src/features/creationEditor/publishingHandoffScope.ts` 的
 *   `resolveScopedPublishingHandoff` 里替换掉手写比较；`storySpine.ts` 的
 *   `currentStoryScopeKey` 目前只导出 ScopeKey，仍未接入本函数（U7 未做，留给 U8）。
 * 下游调用：无（叶子纯函数）。
 */
export function scopeKeysEqual(a: ScopeKey, b: ScopeKey): boolean {
  if (a.resourceKind !== b.resourceKind) return false;
  if (a.storyId !== b.storyId) return false;
  switch (a.resourceKind) {
    case "story":
      return true;
    case "publishingVersion":
    case "cover":
      return a.versionId === (b as typeof a).versionId;
    case "stableShot":
      return a.stableShotId === (b as typeof a).stableShotId;
  }
}

/** `parsePayload` 的返回结果：显式区分"解析成功、值就是 T"和"解析失败"，
 * 不能用 `T | null` 表达——否则一个合法取值恰好是 null 的 payload（比如
 * "清空封面"这类命令）会被误判为解析失败。 */
export type PayloadParseResult<T> =
  | { ok: true; value: T }
  | { ok: false };

/**
 * 用途：解析领域命令信封，payload 校验委托给调用方传入的 `parsePayload`；
 *   scope 或 `expectedResourceRevision` 缺失/非法、或 `parsePayload` 返回
 *   `{ ok: false }` 都返回 null，禁止部分成立的命令进入下一层。
 * 调用入口（至今没有生产调用方，留给 U8——U3 做的是本地持久化原子性，
 *   并没有接线这套合同）：router mutation 输入校验层。
 * 下游调用：`parseScopeKey`；解析成功后交给对应领域 service 执行。
 */
export function parseDomainCommand<T>(
  candidate: unknown,
  parsePayload: (rawPayload: unknown) => PayloadParseResult<T>
): DomainCommand<T> | null {
  if (!candidate || typeof candidate !== "object") return null;
  const raw = candidate as Record<string, unknown>;
  const scope = parseScopeKey(raw.scope);
  if (!scope) return null;
  if (!isFiniteNonNegativeInt(raw.expectedResourceRevision)) return null;
  const parsedPayload = parsePayload(raw.payload);
  if (!parsedPayload.ok) return null;
  return {
    scope,
    expectedResourceRevision: raw.expectedResourceRevision,
    payload: parsedPayload.value,
  };
}

/**
 * 用途：资源写入成功后的唯一 revision 转换——同一事务内原子递增
 *   resourceRevision 与 aggregateRevision。
 * 调用入口：至今没有生产调用方——预期是领域 persistence 模块的资源写入成功分支，留给 U8。
 * 下游调用：无（叶子纯函数），调用方负责把结果落盘。
 */
export function commitResourceRevision(
  current: ScopedRevision
): ScopedRevision {
  return {
    resourceRevision: current.resourceRevision + 1,
    aggregateRevision: current.aggregateRevision + 1,
  };
}

/**
 * 用途：无关资源的写入只需要让聚合投影知道"有变化"，不能触碰这个资源自己
 *   的 resourceRevision——否则会把聚合级别的失效误伤成资源级别的冲突。
 * 调用入口（至今没有生产调用方，留给 U8——U3 做的是本地持久化原子性，
 *   并没有接线这套合同）：领域 persistence 模块在写入资源 B 后，为
 *   资源 A 的聚合投影调用。
 * 下游调用：无（叶子纯函数）。
 */
export function bumpAggregateForProjection(
  current: ScopedRevision
): ScopedRevision {
  return {
    resourceRevision: current.resourceRevision,
    aggregateRevision: current.aggregateRevision + 1,
  };
}

/**
 * 用途：资源级 CAS 冲突判定——只看 `resourceRevision`，`aggregateRevision`
 *   的变化不构成冲突。这是"aggregate 不得阻塞无关资源写入"这条不变量在代码
 *   里的唯一判定点。
 * 调用入口：至今没有生产调用方——预期是领域 persistence 模块的资源写入前置校验，留给 U8。
 * 下游调用：无（叶子纯函数）。
 */
export function hasResourceRevisionConflict(
  expectedResourceRevision: number,
  current: ScopedRevision
): boolean {
  return expectedResourceRevision !== current.resourceRevision;
}
