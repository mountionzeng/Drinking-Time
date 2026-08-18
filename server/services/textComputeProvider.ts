/**
 * 供应商解析已上提到 `server/_core/textComputeProvider.ts`。
 * 这里只保留薄 re-export，让既有 service 调用点保持不变，不必等所有调用点
 * 改完才能编译。新代码请直接从 `_core` 引入。
 */
export {
  describeModelCapabilities,
  resolveComputeCandidates,
  resolveLoginGuestComputeProvider,
  resolveTextComputeProvider,
  resolveVisionComputeProvider,
} from "../_core/textComputeProvider";

export type {
  ComputeCandidateOptions,
  ModelCapabilities,
  TextComputeProvider,
  TextComputeProviderId,
  TextComputeUseCase,
  TokenLimitField,
} from "../_core/textComputeProvider";
