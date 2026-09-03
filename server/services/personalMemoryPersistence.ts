/**
 * 个人记忆的持久化 seam（U1）。
 *
 * 存在的理由不是「包一层」：架构棘轮要求 `server/db.ts` 只被领域 persistence
 * 服务直接引用（见 client/src/architecture-boundaries.test.ts）。U2／U3／U5 的
 * 捕获入口、U7 的足迹查询和集成测试 worker 都从这里取，而不是各自去戳 db.ts。
 *
 * 这里只做转发，不加语义——语义在 shared/personalMemory.ts，事务与幂等在
 * db.ts。任何新的业务判断都应该落进上面两处之一，不要在这层长出第三套规则。
 */
export {
  appendEmotionDailyLetterVersion,
  archivePersonalMemoryInsightLineage,
  capturePersonalMemoryEvent,
  capturePersonalMemoryEventStandalone,
  claimPersonalMemoryJobs,
  completePersonalMemoryExtractionJob,
  correctPersonalMemoryInsight,
  countPendingPersonalMemoryJobs,
  drainLocalPersonalMemoryOutbox,
  failPersonalMemoryJob,
  forgetPersonalMemoryInsightLineage,
  getChatMessageContentForPersonalMemory,
  getPersonalMemoryEventById,
  getPersonalMemoryEventByIdentity,
  getPersonalMemoryPrivacyEpoch,
  getPersonalMemorySuppression,
  getUserByOpenId,
  bumpPersonalMemoryPrivacyEpoch,
  isPersonalMemoryEventSuppressed,
  listActivePersonalMemoryInsightCandidates,
  listEmotionDailyLetterVersions,
  listPersonalMemoryEvents,
  listPersonalMemoryEvidenceForInsight,
  listPersonalMemoryInsightLineage,
  projectPersonalMemoryOutboxIntoIndex,
  restorePersonalMemoryInsightLineage,
  scrubPersonalMemoryEventAndRecompute,
  upsertUser,
  type AppendDailyLetterVersionInput,
  type AppendDailyLetterVersionResult,
  type ClaimPersonalMemoryJobsInput,
  type FailPersonalMemoryJobInput,
  type LineageStateChangeResult,
  type PersonalMemoryExtractionCompletion,
  type PersonalMemoryExtractionCompletionResult,
  type PersonalMemoryMysqlTx,
  type PersonalMemoryTxScope,
  type ScrubEventResult,
} from "../db";
