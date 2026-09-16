import { beforeEach, describe, expect, it } from "vitest";
import { resetMemoryStateForTesting } from "../db";
import {
  getOrCreateVoiceActivationOperation,
  loadStoryVoiceProfile,
  saveStoryVoiceProfile,
} from "./storyVoiceProfiles";

describe("storyVoiceProfiles", () => {
  beforeEach(() => resetMemoryStateForTesting());

  it("keeps profiles user-owned and activation operations uniquely idempotent", async () => {
    const profile = await saveStoryVoiceProfile({
      id: "voice-1",
      userId: 7,
      displayName: "我的声音",
      subject: "self",
      rightsBasis: "self_voice",
      assuranceLevel: "fresh_liveness",
      allowedUseScope: "all_owned_stories",
      activation: { status: "prepared", priceVersion: "p1" },
      status: "preview_ready",
    });
    expect(
      await loadStoryVoiceProfile({ id: profile.id, userId: 8 })
    ).toBeNull();
    await expect(
      saveStoryVoiceProfile({ ...profile, userId: 8, displayName: "冒名覆盖" })
    ).rejects.toThrow(/owner mismatch/i);
    expect(
      (await loadStoryVoiceProfile({ id: profile.id, userId: 7 }))?.displayName
    ).toBe("我的声音");
    const a = await getOrCreateVoiceActivationOperation({
      userId: 7,
      profileId: profile.id,
      provider: "doubao",
      priceVersion: "p1",
      requestDigest: "same",
    });
    const b = await getOrCreateVoiceActivationOperation({
      userId: 7,
      profileId: profile.id,
      provider: "doubao",
      priceVersion: "p1",
      requestDigest: "same",
    });
    expect(b.id).toBe(a.id);
    await expect(
      getOrCreateVoiceActivationOperation({
        userId: 7,
        profileId: profile.id,
        provider: "doubao",
        priceVersion: "p1",
        requestDigest: "different",
      })
    ).rejects.toThrow(/idempotency/i);
  });
});
