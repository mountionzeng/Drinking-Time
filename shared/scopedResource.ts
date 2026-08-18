/**
 * 跨层 Story/Publishing 资源作用域合同。
 *
 * 这个模块只定义类型和纯函数，不做任何 I/O：它是 router、service、client
 * Context 之间共享的"资源身份"词汇表，取代此前各层各自用
 * `activeStoryId === xxx.storyId` 这类零散比较表达同一件事。
 *
 * U2 建立时还一并预留了 owner scope、领域命令信封、resource/aggregate revision
 * 转换等一整套函数，设想由 U3~U8 接线。U8 复核时它们仍然是零生产调用方：U3 做的
 * 是本地持久化原子性、U7 做的是缓存失效收窄，都没走这套合同。因此按"不留没有
 * 调用方的抽象"把它们删掉了——需要时从 git 历史里取回当时的实现，比留在这里让
 * 后来者以为已经在用要好。ScopedRevision 保留，因为 publishingDraft.ts 的
 * `publishingVersionScopedRevision` 真的在用它表达"资源 revision 与聚合 revision
 * 是两件事"这个区分。
 */

/**
 * 资源身份。刻意不包含 userId —— owner 校验是另一个正交维度（服务端一律用
 * `getStoryById(id, userId)` / `getProjectById(id, userId)` 这类双键查询完成），
 * 不能通过在 ScopeKey 里塞 userId 造成"谁读到就是谁的"的错觉。
 * 同一 storyId 下，不同资源种类各自携带自己的稳定 ID。
 */
export type ScopeKey =
  | { resourceKind: "story"; storyId: number }
  | { resourceKind: "publishingVersion"; storyId: number; versionId: string }
  | { resourceKind: "stableShot"; storyId: number; stableShotId: string }
  | { resourceKind: "cover"; storyId: number; versionId: string };

/**
 * 一个资源同时持有的两种 revision：`resourceRevision` 是该资源自身的写入
 * 冲突条件；`aggregateRevision` 只用于驱动上层投影失效，不能被用作阻塞
 * 无关资源写入的前置条件（把聚合 revision 误当成资源级锁，是"改一个地方
 * 其他地方跟着变"的根因之一）。
 */
export type ScopedRevision = {
  resourceRevision: number;
  aggregateRevision: number;
};

/**
 * 用途：判断两个 ScopeKey 是否指向同一资源；替代此前各处手写的
 *   `a.storyId === b.storyId` 之类的临时比较（这类比较容易在只改一侧字段时
 *   漏掉另一侧，是"迟到响应污染新 scope"的常见成因）。
 * 调用入口：client 迟到响应丢弃判断——
 *   `client/src/features/creationEditor/publishingHandoffScope.ts` 的
 *   `resolveScopedPublishingHandoff`。
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
