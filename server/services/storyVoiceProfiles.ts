import {
  normalizeStoryVoiceProfile,
  type StoryVoiceProfile,
} from "../../shared/storyVoiceProfile";
import {
  getOrCreateStoryVoiceActivationOperationRecord,
  getStoryVoiceProfileRecord,
  upsertStoryVoiceProfileRecord,
} from "../db";

export async function saveStoryVoiceProfile(
  input: StoryVoiceProfile
): Promise<StoryVoiceProfile> {
  const normalized = normalizeStoryVoiceProfile(input);
  if (!normalized) throw new Error("Invalid voice profile");
  const row = await upsertStoryVoiceProfileRecord({
    publicId: normalized.id,
    userId: normalized.userId,
    profile: normalized,
  });
  return normalizeStoryVoiceProfile(row.profile)!;
}
export async function loadStoryVoiceProfile(input: {
  id: string;
  userId: number;
}): Promise<StoryVoiceProfile | null> {
  const row = await getStoryVoiceProfileRecord(input.id, input.userId);
  return row ? normalizeStoryVoiceProfile(row.profile) : null;
}
export async function getOrCreateVoiceActivationOperation(input: {
  userId: number;
  profileId: string;
  provider: "doubao";
  priceVersion: string;
  requestDigest: string;
}) {
  const row = await getOrCreateStoryVoiceActivationOperationRecord({
    userId: input.userId,
    profilePublicId: input.profileId,
    provider: input.provider,
    priceVersion: input.priceVersion,
    requestDigest: input.requestDigest,
  });
  return {
    id: row.publicId,
    profileId: row.profilePublicId,
    userId: row.userId,
    provider: row.provider,
    priceVersion: row.priceVersion,
    requestDigest: row.requestDigest,
    state: row.state,
  };
}
