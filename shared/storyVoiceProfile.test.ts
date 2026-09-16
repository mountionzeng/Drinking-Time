import { describe, expect, it } from "vitest";
import {
  normalizeStoryVoiceProfile,
  voiceProfileCanBind,
  voiceProfileCanSynthesize,
} from "./storyVoiceProfile";

const activeSelfVoice = () => ({
  id: "voice-profile-1",
  userId: 7,
  displayName: "我的声音",
  subject: "self",
  rightsBasis: "self_voice",
  assuranceLevel: "fresh_liveness",
  allowedUseScope: "all_owned_stories",
  consent: {
    id: "consent-1",
    policyVersion: "2026-09-16",
    confirmedAt: "2026-09-16T01:00:00.000Z",
    sampleDigest: "sample-sha256",
    challengeId: "challenge-1",
  },
  challenge: {
    id: "challenge-1",
    promptDigest: "prompt-hmac",
    expiresAt: "2026-09-16T01:10:00.000Z",
    verifiedAt: "2026-09-16T01:05:00.000Z",
    sampleDigest: "sample-sha256",
  },
  provider: {
    provider: "doubao",
    resourceId: "resource-1",
    voiceId: "provider-voice-1",
  },
  previewAcceptedAt: "2026-09-16T01:08:00.000Z",
  activation: { status: "active", priceVersion: "price-v1" },
  status: "active",
});

describe("storyVoiceProfile", () => {
  it("accepts a preview-approved, liveness-verified self voice for binding and synthesis", () => {
    const profile = normalizeStoryVoiceProfile(activeSelfVoice());

    expect(profile).not.toBeNull();
    expect(voiceProfileCanBind(profile!, { userId: 7, storyId: 1196 })).toEqual(
      {
        ok: true,
      }
    );
    expect(
      voiceProfileCanSynthesize(profile!, { userId: 7, storyId: 1196 })
    ).toEqual({ ok: true });
  });

  it("rejects checkbox-only consent and mismatched challenge/sample evidence", () => {
    const checkboxOnly = normalizeStoryVoiceProfile({
      ...activeSelfVoice(),
      assuranceLevel: "asserted",
      challenge: undefined,
    });
    const mismatched = normalizeStoryVoiceProfile({
      ...activeSelfVoice(),
      challenge: {
        ...activeSelfVoice().challenge,
        sampleDigest: "different-sample",
      },
    });

    expect(
      voiceProfileCanBind(checkboxOnly!, { userId: 7, storyId: 1 })
    ).toEqual({
      ok: false,
      reason: "fresh_liveness_required",
    });
    expect(voiceProfileCanBind(mismatched!, { userId: 7, storyId: 1 })).toEqual(
      {
        ok: false,
        reason: "consent_sample_mismatch",
      }
    );
  });

  it("enforces owner and Story scope without accepting client identity as authority", () => {
    const profile = normalizeStoryVoiceProfile({
      ...activeSelfVoice(),
      allowedUseScope: "story_only",
      allowedStoryId: 1196,
    })!;

    expect(voiceProfileCanBind(profile, { userId: 8, storyId: 1196 })).toEqual({
      ok: false,
      reason: "owner_mismatch",
    });
    expect(voiceProfileCanBind(profile, { userId: 7, storyId: 1197 })).toEqual({
      ok: false,
      reason: "story_scope_mismatch",
    });
  });

  it("prevents deactivated, withdrawn, unaccepted, or unknown-activation profiles from paid synthesis", () => {
    for (const raw of [
      { ...activeSelfVoice(), status: "deactivated" },
      { ...activeSelfVoice(), status: "withdrawn" },
      { ...activeSelfVoice(), previewAcceptedAt: undefined },
      {
        ...activeSelfVoice(),
        activation: { status: "submission_unknown", priceVersion: "price-v1" },
      },
    ]) {
      const profile = normalizeStoryVoiceProfile(raw)!;
      expect(
        voiceProfileCanSynthesize(profile, { userId: 7, storyId: 1196 }).ok
      ).toBe(false);
    }
  });

  it("normalization never retains raw sample bytes, transcripts, API keys, or provider payloads", () => {
    const profile = normalizeStoryVoiceProfile({
      ...activeSelfVoice(),
      rawAudioBase64: "secret-audio",
      transcript: "secret transcript",
      apiKey: "secret-key",
      providerPayload: { secret: true },
    })! as unknown as Record<string, unknown>;

    expect(profile.rawAudioBase64).toBeUndefined();
    expect(profile.transcript).toBeUndefined();
    expect(profile.apiKey).toBeUndefined();
    expect(profile.providerPayload).toBeUndefined();
  });
});
