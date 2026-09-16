import { describe, expect, it } from "vitest";
import {
  buildDoubaoSpeechCapabilities,
  resolveDoubaoOfficialVoice,
  selectDoubaoSpeechCredential,
  type DoubaoSpeechCapabilityConfig,
} from "./doubaoSpeechCapabilities";

const configured = (
  overrides: Partial<DoubaoSpeechCapabilityConfig> = {}
): DoubaoSpeechCapabilityConfig => ({
  apiKey: "primary-secret-key",
  nextApiKey: "next-secret-key",
  activeKeySlot: "primary",
  primaryCredentialStatus: "active",
  nextCredentialStatus: "active",
  ttsEntitlementVerified: true,
  cloneEntitlementVerified: true,
  ttsResourceId: "seed-tts-2.0",
  cloneResourceId: "seed-icl-2.0",
  contractVersion: "doubao-speech-2026-06-01",
  priceVersion: "console-price-2026-09-16",
  officialVoiceAllowlistJson: JSON.stringify([
    {
      id: "voice_warm_narrator",
      label: "温暖旁白",
      providerVoiceId: "provider_voice_secret_001",
      previewVerified: true,
      controls: {
        rate: true,
        emotions: [
          {
            id: "emotion_calm",
            label: "平静",
            providerValue: "calm",
          },
        ],
        intensity: true,
      },
    },
  ]),
  previewModes: "official_tts,clone_demo",
  policyVerified: true,
  policyRegion: "configured-region",
  retentionPolicyVersion: "retention-v1",
  providerTrainingUse: "contractually_restricted",
  sampleRetention: "provider_documented",
  deletionMode: "provider_api",
  deletionSla: "operator-verified",
  dsarSupported: true,
  ...overrides,
});

describe("Doubao speech capability contract", () => {
  it("exposes configured capabilities with only owned opaque voice/control ids", () => {
    const contract = buildDoubaoSpeechCapabilities(configured());

    expect(contract.capabilities.speechSynthesis.enabled).toBe(true);
    expect(contract.capabilities.officialVoiceCatalog.enabled).toBe(true);
    expect(contract.capabilities.voiceClone.enabled).toBe(true);
    expect(contract.capabilities.preview).toMatchObject({
      enabled: true,
      modes: ["official_tts", "clone_demo"],
    });
    expect(contract.officialVoices).toEqual([
      expect.objectContaining({
        id: "voice_warm_narrator",
        label: "温暖旁白",
        previewAvailable: true,
        controls: expect.objectContaining({
          rate: { min: -50, max: 100, default: 0 },
          intensity: { min: 1, max: 5, default: 4 },
          emotions: [{ id: "emotion_calm", label: "平静" }],
        }),
      }),
    ]);
  });

  it("does not infer TTS or clone entitlement from an ASR-capable API key", () => {
    const contract = buildDoubaoSpeechCapabilities(
      configured({
        ttsEntitlementVerified: false,
        cloneEntitlementVerified: false,
      })
    );

    expect(contract.configured).toBe(true);
    expect(contract.capabilities.speechSynthesis).toMatchObject({
      enabled: false,
      disabledReason: "tts_entitlement_unverified",
    });
    expect(contract.capabilities.voiceClone).toMatchObject({
      enabled: false,
      disabledReason: "clone_entitlement_unverified",
    });
  });

  it("fails closed when the selected credential is unverified or revoked", () => {
    for (const [primaryCredentialStatus, disabledReason] of [
      ["unverified", "credential_unverified"],
      ["revoked", "credential_revoked"],
    ] as const) {
      const contract = buildDoubaoSpeechCapabilities(
        configured({ primaryCredentialStatus })
      );
      expect(contract.capabilities.speechSynthesis).toMatchObject({
        enabled: false,
        disabledReason,
      });
      expect(contract.capabilities.voiceClone).toMatchObject({
        enabled: false,
        disabledReason,
      });
    }
  });

  it("fails closed for an invalid key slot or an unverified selected key", () => {
    const invalidSlot = buildDoubaoSpeechCapabilities(
      configured({ activeKeySlot: "nex" })
    );
    expect(
      selectDoubaoSpeechCredential(configured({ activeKeySlot: "nex" }))
    ).toBeNull();
    expect(invalidSlot.capabilities.speechSynthesis).toMatchObject({
      enabled: false,
      disabledReason: "credential_slot_invalid",
    });

    const unverifiedNext = buildDoubaoSpeechCapabilities(
      configured({ activeKeySlot: "next", nextCredentialStatus: "unverified" })
    );
    expect(unverifiedNext.capabilities.speechSynthesis).toMatchObject({
      enabled: false,
      disabledReason: "credential_unverified",
    });
    expect(unverifiedNext.capabilities.voiceClone).toMatchObject({
      enabled: false,
      disabledReason: "credential_unverified",
    });
  });

  it("keeps TTS enabled when only clone resource configuration is missing", () => {
    const contract = buildDoubaoSpeechCapabilities(
      configured({ cloneResourceId: "" })
    );
    expect(contract.capabilities.speechSynthesis.enabled).toBe(true);
    expect(contract.capabilities.voiceClone).toMatchObject({
      enabled: false,
      disabledReason: "clone_resource_missing",
    });
  });

  it.each([
    ["active key", { apiKey: "", nextApiKey: "" }, "credential_missing"],
    ["TTS resource", { ttsResourceId: "" }, "tts_resource_missing"],
    ["price version", { priceVersion: "" }, "price_version_missing"],
    ["contract version", { contractVersion: "" }, "contract_version_missing"],
  ] as const)(
    "disables only dependent capabilities when %s is missing",
    (_label, overrides, disabledReason) => {
      const contract = buildDoubaoSpeechCapabilities(configured(overrides));
      expect(contract.capabilities.speechSynthesis).toMatchObject({
        enabled: false,
        disabledReason,
      });
      expect(contract.manualAudioImportAvailable).toBe(true);
    }
  );

  it("keeps clone submission disabled until the data policy is complete", () => {
    const contract = buildDoubaoSpeechCapabilities(
      configured({ deletionMode: "unverified", dsarSupported: false })
    );

    expect(contract.capabilities.voiceClone).toMatchObject({
      enabled: false,
      disabledReason: "clone_data_policy_incomplete",
    });
    expect(contract.dataPolicy).toMatchObject({
      verifiedForSampleSubmission: false,
      deletionMode: "unverified",
      dsarSupported: false,
    });
    expect(contract.capabilities.speechSynthesis.enabled).toBe(true);
  });

  it.each([
    { policyVerified: false },
    { policyRegion: "" },
    { retentionPolicyVersion: "" },
    { providerTrainingUse: "unverified" },
    { sampleRetention: "unverified" },
    { deletionMode: "unverified" },
    { deletionSla: "" },
    { dsarSupported: false },
  ] as Array<Partial<DoubaoSpeechCapabilityConfig>>)(
    "keeps clone disabled when one required policy fact is missing: %j",
    override => {
      const contract = buildDoubaoSpeechCapabilities(configured(override));
      expect(contract.dataPolicy.verifiedForSampleSubmission).toBe(false);
      expect(contract.capabilities.voiceClone).toMatchObject({
        enabled: false,
        disabledReason: "clone_data_policy_incomplete",
      });
      expect(contract.capabilities.speechSynthesis.enabled).toBe(true);
      expect(contract.manualAudioImportAvailable).toBe(true);
    }
  );

  it("rejects unsupported resources without disabling unrelated paths", () => {
    const unsupportedTts = buildDoubaoSpeechCapabilities(
      configured({ ttsResourceId: "seed-tts-unknown" })
    );
    expect(unsupportedTts.capabilities.speechSynthesis).toMatchObject({
      enabled: false,
      disabledReason: "tts_resource_unsupported",
    });
    expect(unsupportedTts.capabilities.voiceClone.enabled).toBe(true);

    const unsupportedClone = buildDoubaoSpeechCapabilities(
      configured({ cloneResourceId: "seed-icl-unknown" })
    );
    expect(unsupportedClone.capabilities.speechSynthesis.enabled).toBe(true);
    expect(unsupportedClone.capabilities.voiceClone).toMatchObject({
      enabled: false,
      disabledReason: "clone_resource_unsupported",
    });
    expect(unsupportedClone.manualAudioImportAvailable).toBe(true);
  });

  it("fails closed for malformed or duplicate official-voice allowlists", () => {
    const malformed = buildDoubaoSpeechCapabilities(
      configured({ officialVoiceAllowlistJson: "{" })
    );
    expect(malformed.capabilities.officialVoiceCatalog).toMatchObject({
      enabled: false,
      disabledReason: "official_voice_allowlist_invalid",
    });

    const duplicate = buildDoubaoSpeechCapabilities(
      configured({
        officialVoiceAllowlistJson: JSON.stringify([
          {
            id: "voice_one",
            label: "一",
            providerVoiceId: "provider_1",
          },
          {
            id: "voice_one",
            label: "二",
            providerVoiceId: "provider_2",
          },
        ]),
      })
    );
    expect(duplicate.capabilities.officialVoiceCatalog).toMatchObject({
      enabled: false,
      disabledReason: "official_voice_allowlist_invalid",
    });
    expect(duplicate.officialVoices).toEqual([]);
  });

  it.each([
    [[]],
    [
      [
        { id: "voice_one", label: "一", providerVoiceId: "provider_same" },
        { id: "voice_two", label: "二", providerVoiceId: "provider_same" },
      ],
    ],
    [[{ id: "provider_same", label: "一", providerVoiceId: "provider_same" }]],
    [
      [
        {
          id: "voice_one",
          label: "一",
          providerVoiceId: "provider_1",
          controls: {
            intensity: true,
            emotions: [],
          },
        },
      ],
    ],
    [
      [
        {
          id: "voice_one",
          label: "一",
          providerVoiceId: "provider_1",
          controls: {
            emotions: [
              { id: "emotion_same", label: "平静", providerValue: "calm" },
              { id: "emotion_same", label: "欢快", providerValue: "happy" },
            ],
          },
        },
      ],
    ],
  ])("rejects unsafe official-voice allowlist shape %#", allowlist => {
    const contract = buildDoubaoSpeechCapabilities(
      configured({ officialVoiceAllowlistJson: JSON.stringify(allowlist) })
    );
    expect(contract.capabilities.officialVoiceCatalog).toMatchObject({
      enabled: false,
      disabledReason: "official_voice_allowlist_invalid",
    });
    expect(contract.officialVoices).toEqual([]);
  });

  it("does not advertise per-voice preview when the preview mode is disabled", () => {
    const contract = buildDoubaoSpeechCapabilities(
      configured({ previewModes: "clone_demo" })
    );
    expect(contract.capabilities.preview).toMatchObject({
      enabled: true,
      modes: ["clone_demo"],
    });
    expect(contract.officialVoices[0]?.previewAvailable).toBe(false);
  });

  it("never returns credentials, provider ids, resource ids, or raw payloads", () => {
    const serialized = JSON.stringify(
      buildDoubaoSpeechCapabilities(configured())
    );

    for (const secret of [
      "primary-secret-key",
      "next-secret-key",
      "provider_voice_secret_001",
      "seed-tts-2.0",
      "seed-icl-2.0",
      "Authorization",
      "X-Api-Key",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("resolves only allowlisted opaque ids and rejects raw provider ids", () => {
    const config = configured();
    expect(resolveDoubaoOfficialVoice(config, "voice_warm_narrator")).toEqual(
      expect.objectContaining({
        providerVoiceId: "provider_voice_secret_001",
        resourceId: "seed-tts-2.0",
      })
    );
    expect(
      resolveDoubaoOfficialVoice(config, "provider_voice_secret_001")
    ).toBeNull();
    expect(
      resolveDoubaoOfficialVoice(config, "voice_not_allowlisted")
    ).toBeNull();
  });

  it("supports key rollover without putting credential selection in quote identity", () => {
    const primaryConfig = configured();
    const nextConfig = configured({ activeKeySlot: "next" });

    expect(selectDoubaoSpeechCredential(primaryConfig)).toEqual({
      slot: "primary",
      apiKey: "primary-secret-key",
      status: "active",
    });
    expect(selectDoubaoSpeechCredential(nextConfig)).toEqual({
      slot: "next",
      apiKey: "next-secret-key",
      status: "active",
    });
    expect(buildDoubaoSpeechCapabilities(primaryConfig).fingerprint).toBe(
      buildDoubaoSpeechCapabilities(nextConfig).fingerprint
    );
  });

  it("changes the fingerprint when contract or price versions change", () => {
    const baseline = buildDoubaoSpeechCapabilities(configured()).fingerprint;
    expect(
      buildDoubaoSpeechCapabilities(
        configured({ contractVersion: "doubao-speech-next" })
      ).fingerprint
    ).not.toBe(baseline);
    expect(
      buildDoubaoSpeechCapabilities(
        configured({ priceVersion: "console-price-next" })
      ).fingerprint
    ).not.toBe(baseline);
  });

  it("changes the fingerprint when execution resources or provider mappings change", () => {
    const baseline = buildDoubaoSpeechCapabilities(configured()).fingerprint;
    expect(
      buildDoubaoSpeechCapabilities(
        configured({ ttsResourceId: "seed-tts-1.0" })
      ).fingerprint
    ).not.toBe(baseline);
    expect(
      buildDoubaoSpeechCapabilities(
        configured({ cloneResourceId: "seed-icl-1.0" })
      ).fingerprint
    ).not.toBe(baseline);

    const remappedAllowlist = JSON.parse(
      configured().officialVoiceAllowlistJson
    ) as Array<Record<string, unknown>>;
    remappedAllowlist[0] = {
      ...remappedAllowlist[0],
      providerVoiceId: "provider_voice_secret_002",
    };
    expect(
      buildDoubaoSpeechCapabilities(
        configured({
          officialVoiceAllowlistJson: JSON.stringify(remappedAllowlist),
        })
      ).fingerprint
    ).not.toBe(baseline);
  });
});
