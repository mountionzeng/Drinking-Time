/** Redacted, JSON-safe provider capability contract shared with clients. */

export const STORY_VOICE_CAPABILITY_DISABLED_REASONS = [
  "credential_missing",
  "credential_slot_invalid",
  "credential_unverified",
  "credential_revoked",
  "contract_version_missing",
  "price_version_missing",
  "tts_entitlement_unverified",
  "tts_resource_missing",
  "tts_resource_unsupported",
  "clone_entitlement_unverified",
  "clone_resource_missing",
  "clone_resource_unsupported",
  "clone_data_policy_incomplete",
  "official_voice_allowlist_missing",
  "official_voice_allowlist_invalid",
  "preview_unverified",
] as const;

export type StoryVoiceCapabilityDisabledReason =
  (typeof STORY_VOICE_CAPABILITY_DISABLED_REASONS)[number];

export type StoryVoiceCapabilityGate =
  | { enabled: true }
  | {
      enabled: false;
      disabledReason: StoryVoiceCapabilityDisabledReason;
    };

export type StoryVoicePreviewMode = "official_tts" | "clone_demo";

export type StoryVoiceControlRange = {
  min: number;
  max: number;
  default: number;
};

export type StoryOfficialVoiceCapability = {
  /** Server-owned opaque id. Never a provider speaker/voice id. */
  id: string;
  label: string;
  previewAvailable: boolean;
  controls: {
    rate?: StoryVoiceControlRange;
    intensity?: StoryVoiceControlRange;
    emotions: Array<{ id: string; label: string }>;
  };
};

export type StoryVoiceDataPolicy = {
  verifiedForSampleSubmission: boolean;
  region: string | null;
  retentionPolicyVersion: string | null;
  providerTrainingUse:
    | "not_used_for_provider_training"
    | "contractually_restricted"
    | "unverified";
  sampleRetention:
    | "temporary_until_terminal"
    | "provider_documented"
    | "unverified";
  deletionMode: "provider_api" | "support_dsar" | "unverified";
  deletionSla: string | null;
  dsarSupported: boolean;
};

export type StoryVoiceCapabilities = {
  provider: "doubao";
  configured: boolean;
  contractVersion: string | null;
  priceVersion: string | null;
  fingerprint: string;
  manualAudioImportAvailable: true;
  capabilities: {
    speechSynthesis: StoryVoiceCapabilityGate;
    officialVoiceCatalog: StoryVoiceCapabilityGate;
    voiceClone: StoryVoiceCapabilityGate;
    preview: StoryVoiceCapabilityGate & { modes: StoryVoicePreviewMode[] };
  };
  officialVoices: StoryOfficialVoiceCapability[];
  dataPolicy: StoryVoiceDataPolicy;
};
