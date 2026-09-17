/**
 * Story sound planning and voice-profile persistence seam.
 *
 * Domain services import durable operations from this module instead of
 * reaching into the repository-wide db module independently. Keeping one
 * owner preserves the architecture ratchet while the underlying records are
 * still implemented in server/db.ts.
 */
export {
  compareAndSaveStorySoundWorkspaceRecord,
  getOrCreateStorySoundPlanVersionRecord,
  getOrCreateStorySoundRowOperationRecord,
  getOrCreateStoryVoiceActivationOperationRecord,
  getStoryById,
  getStorySoundPlanVersionRecord,
  getStorySoundWorkspaceRecord,
  getStoryTimeline,
  getStoryVoiceProfileRecord,
  listStorySoundPlanVersionRecords,
  listStorySoundRowOperationRecords,
  upsertStoryVoiceProfileRecord,
} from "../db";
