import { createHash } from "node:crypto";
import type {
  StoryOfficialVoiceCapability,
  StoryVoiceCapabilities,
  StoryVoiceCapabilityDisabledReason,
  StoryVoiceCapabilityGate,
  StoryVoiceDataPolicy,
  StoryVoicePreviewMode,
} from "@shared/storyVoiceCapabilities";
import { canonicalJsonStringify } from "@shared/canonicalJson";
import { ENV } from "../_core/env";

const TTS_ENDPOINT =
  "https://openspeech.bytedance.com/api/v3/tts/unidirectional";
const CLONE_ENDPOINT =
  "https://openspeech.bytedance.com/api/v3/tts/voice_clone";
const CLONE_STATUS_ENDPOINT =
  "https://openspeech.bytedance.com/api/v3/tts/get_voice";

const SUPPORTED_TTS_RESOURCES = new Set([
  "seed-tts-1.0",
  "seed-tts-1.0-concurr",
  "seed-tts-2.0",
]);
const SUPPORTED_CLONE_RESOURCES = new Set([
  "seed-icl-1.0",
  "seed-icl-1.0-concurr",
  "seed-icl-2.0",
]);

type ProviderTrainingUse = StoryVoiceDataPolicy["providerTrainingUse"];
type SampleRetention = StoryVoiceDataPolicy["sampleRetention"];
type DeletionMode = StoryVoiceDataPolicy["deletionMode"];

export type DoubaoSpeechCapabilityConfig = {
  apiKey: string;
  nextApiKey: string;
  activeKeySlot: string;
  primaryCredentialStatus: string;
  nextCredentialStatus: string;
  ttsEntitlementVerified: boolean;
  cloneEntitlementVerified: boolean;
  ttsResourceId: string;
  cloneResourceId: string;
  contractVersion: string;
  priceVersion: string;
  officialVoiceAllowlistJson: string;
  previewModes: string;
  policyVerified: boolean;
  policyRegion: string;
  retentionPolicyVersion: string;
  providerTrainingUse: string;
  sampleRetention: string;
  deletionMode: string;
  deletionSla: string;
  dsarSupported: boolean;
};

type RawEmotion = {
  id: string;
  label: string;
  providerValue: string;
};

type RawOfficialVoice = {
  id: string;
  label: string;
  providerVoiceId: string;
  previewVerified: boolean;
  controls: {
    rate: boolean;
    intensity: boolean;
    emotions: RawEmotion[];
  };
};

const OPAQUE_VOICE_ID = /^voice_[a-z0-9][a-z0-9_-]{2,63}$/;
const OPAQUE_EMOTION_ID = /^emotion_[a-z0-9][a-z0-9_-]{2,63}$/;

const text = (value: unknown, max = 256): string | null =>
  typeof value === "string" && value.trim() && value.trim().length <= max
    ? value.trim()
    : null;

const enabled = (): StoryVoiceCapabilityGate => ({ enabled: true });
const disabled = (
  disabledReason: StoryVoiceCapabilityDisabledReason
): StoryVoiceCapabilityGate => ({ enabled: false, disabledReason });

function enumValue<T extends string>(
  value: string,
  allowed: readonly T[],
  fallback: T
): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function parseOfficialVoiceAllowlist(
  json: string
):
  | { ok: true; voices: RawOfficialVoice[] }
  | { ok: false; reason: "missing" | "invalid" } {
  if (!json.trim()) return { ok: false, reason: "missing" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 100) {
    return { ok: false, reason: "invalid" };
  }

  const voices: RawOfficialVoice[] = [];
  const opaqueIds = new Set<string>();
  const providerIds = new Set<string>();
  for (const item of parsed) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { ok: false, reason: "invalid" };
    }
    const raw = item as Record<string, unknown>;
    const id = text(raw.id, 70);
    const label = text(raw.label, 80);
    const providerVoiceId = text(raw.providerVoiceId, 256);
    if (
      !id ||
      !OPAQUE_VOICE_ID.test(id) ||
      !label ||
      !providerVoiceId ||
      id === providerVoiceId ||
      opaqueIds.has(id) ||
      providerIds.has(providerVoiceId)
    ) {
      return { ok: false, reason: "invalid" };
    }

    const rawControls =
      raw.controls &&
      typeof raw.controls === "object" &&
      !Array.isArray(raw.controls)
        ? (raw.controls as Record<string, unknown>)
        : {};
    const rawEmotions = rawControls.emotions ?? [];
    if (!Array.isArray(rawEmotions) || rawEmotions.length > 30) {
      return { ok: false, reason: "invalid" };
    }
    const emotions: RawEmotion[] = [];
    const emotionIds = new Set<string>();
    for (const emotion of rawEmotions) {
      if (!emotion || typeof emotion !== "object" || Array.isArray(emotion)) {
        return { ok: false, reason: "invalid" };
      }
      const rawEmotion = emotion as Record<string, unknown>;
      const emotionId = text(rawEmotion.id, 70);
      const emotionLabel = text(rawEmotion.label, 40);
      const providerValue = text(rawEmotion.providerValue, 80);
      if (
        !emotionId ||
        !OPAQUE_EMOTION_ID.test(emotionId) ||
        !emotionLabel ||
        !providerValue ||
        emotionId === providerValue ||
        emotionIds.has(emotionId)
      ) {
        return { ok: false, reason: "invalid" };
      }
      emotionIds.add(emotionId);
      emotions.push({ id: emotionId, label: emotionLabel, providerValue });
    }
    const intensity = rawControls.intensity === true;
    if (intensity && emotions.length === 0) {
      return { ok: false, reason: "invalid" };
    }

    opaqueIds.add(id);
    providerIds.add(providerVoiceId);
    voices.push({
      id,
      label,
      providerVoiceId,
      previewVerified: raw.previewVerified === true,
      controls: {
        rate: rawControls.rate === true,
        intensity,
        emotions,
      },
    });
  }
  return { ok: true, voices };
}

function publicVoice(
  voice: RawOfficialVoice,
  officialPreviewConfigured: boolean
): StoryOfficialVoiceCapability {
  return {
    id: voice.id,
    label: voice.label,
    previewAvailable: officialPreviewConfigured && voice.previewVerified,
    controls: {
      ...(voice.controls.rate
        ? { rate: { min: -50, max: 100, default: 0 } }
        : {}),
      ...(voice.controls.intensity
        ? { intensity: { min: 1, max: 5, default: 4 } }
        : {}),
      emotions: voice.controls.emotions.map(({ id, label }) => ({ id, label })),
    },
  };
}

function parsePreviewModes(value: string): StoryVoicePreviewMode[] {
  const allowed = new Set<StoryVoicePreviewMode>([
    "official_tts",
    "clone_demo",
  ]);
  return Array.from(
    new Set(
      value
        .split(",")
        .map(item => item.trim())
        .filter((item): item is StoryVoicePreviewMode =>
          allowed.has(item as StoryVoicePreviewMode)
        )
    )
  );
}

export function selectDoubaoSpeechCredential(
  config: DoubaoSpeechCapabilityConfig
): {
  slot: "primary" | "next";
  apiKey: string;
  status: string;
} | null {
  if (config.activeKeySlot !== "primary" && config.activeKeySlot !== "next") {
    return null;
  }
  const slot = config.activeKeySlot;
  const apiKey = (slot === "next" ? config.nextApiKey : config.apiKey).trim();
  const status =
    slot === "next"
      ? config.nextCredentialStatus
      : config.primaryCredentialStatus;
  return apiKey ? { slot, apiKey, status } : null;
}

function credentialGate(
  config: DoubaoSpeechCapabilityConfig
): StoryVoiceCapabilityGate {
  if (config.activeKeySlot !== "primary" && config.activeKeySlot !== "next") {
    return disabled("credential_slot_invalid");
  }
  const credential = selectDoubaoSpeechCredential(config);
  if (!credential) return disabled("credential_missing");
  if (credential.status === "revoked") return disabled("credential_revoked");
  if (credential.status !== "active") {
    return disabled("credential_unverified");
  }
  return enabled();
}

function speechGate(
  config: DoubaoSpeechCapabilityConfig
): StoryVoiceCapabilityGate {
  const credential = credentialGate(config);
  if (!credential.enabled) return credential;
  if (!config.contractVersion.trim())
    return disabled("contract_version_missing");
  if (!config.priceVersion.trim()) return disabled("price_version_missing");
  if (!config.ttsResourceId.trim()) return disabled("tts_resource_missing");
  if (!SUPPORTED_TTS_RESOURCES.has(config.ttsResourceId.trim())) {
    return disabled("tts_resource_unsupported");
  }
  if (!config.ttsEntitlementVerified) {
    return disabled("tts_entitlement_unverified");
  }
  return enabled();
}

function dataPolicy(
  config: DoubaoSpeechCapabilityConfig
): StoryVoiceDataPolicy {
  const providerTrainingUse = enumValue<ProviderTrainingUse>(
    config.providerTrainingUse.trim(),
    ["not_used_for_provider_training", "contractually_restricted"],
    "unverified"
  );
  const sampleRetention = enumValue<SampleRetention>(
    config.sampleRetention.trim(),
    ["temporary_until_terminal", "provider_documented"],
    "unverified"
  );
  const deletionMode = enumValue<DeletionMode>(
    config.deletionMode.trim(),
    ["provider_api", "support_dsar"],
    "unverified"
  );
  const region = text(config.policyRegion, 120);
  const retentionPolicyVersion = text(config.retentionPolicyVersion, 120);
  const deletionSla = text(config.deletionSla, 120);
  const verifiedForSampleSubmission = Boolean(
    config.policyVerified &&
      region &&
      retentionPolicyVersion &&
      providerTrainingUse !== "unverified" &&
      sampleRetention !== "unverified" &&
      deletionMode !== "unverified" &&
      deletionSla &&
      config.dsarSupported
  );
  return {
    verifiedForSampleSubmission,
    region,
    retentionPolicyVersion,
    providerTrainingUse,
    sampleRetention,
    deletionMode,
    deletionSla,
    dsarSupported: config.dsarSupported,
  };
}

function cloneGate(
  config: DoubaoSpeechCapabilityConfig,
  policy: StoryVoiceDataPolicy
): StoryVoiceCapabilityGate {
  const credential = credentialGate(config);
  if (!credential.enabled) return credential;
  if (!config.contractVersion.trim())
    return disabled("contract_version_missing");
  if (!config.priceVersion.trim()) return disabled("price_version_missing");
  if (!config.cloneResourceId.trim()) return disabled("clone_resource_missing");
  if (!SUPPORTED_CLONE_RESOURCES.has(config.cloneResourceId.trim())) {
    return disabled("clone_resource_unsupported");
  }
  if (!config.cloneEntitlementVerified) {
    return disabled("clone_entitlement_unverified");
  }
  if (!policy.verifiedForSampleSubmission) {
    return disabled("clone_data_policy_incomplete");
  }
  return enabled();
}

export function buildDoubaoSpeechCapabilities(
  config: DoubaoSpeechCapabilityConfig = doubaoSpeechCapabilityConfigFromEnv()
): StoryVoiceCapabilities {
  const credential = selectDoubaoSpeechCredential(config);
  const speechSynthesis = speechGate(config);
  const policy = dataPolicy(config);
  const voiceClone = cloneGate(config, policy);
  const allowlist = parseOfficialVoiceAllowlist(
    config.officialVoiceAllowlistJson
  );
  const officialVoiceCatalog: StoryVoiceCapabilityGate =
    !speechSynthesis.enabled
      ? speechSynthesis
      : !allowlist.ok
        ? disabled(
            allowlist.reason === "missing"
              ? "official_voice_allowlist_missing"
              : "official_voice_allowlist_invalid"
          )
        : enabled();
  const configuredPreviewModes = parsePreviewModes(config.previewModes);
  const officialPreviewConfigured =
    configuredPreviewModes.includes("official_tts");
  const officialVoices =
    allowlist.ok && officialVoiceCatalog.enabled
      ? allowlist.voices.map(voice =>
          publicVoice(voice, officialPreviewConfigured)
        )
      : [];
  const previewModes = configuredPreviewModes.filter(mode => {
    if (mode === "official_tts") {
      return (
        officialVoiceCatalog.enabled &&
        officialVoices.some(voice => voice.previewAvailable)
      );
    }
    return voiceClone.enabled;
  });
  const preview = {
    ...(previewModes.length > 0 ? enabled() : disabled("preview_unverified")),
    modes: previewModes,
  };

  const privateExecutionIdentity = {
    ttsResourceId: config.ttsResourceId.trim() || null,
    cloneResourceId: config.cloneResourceId.trim() || null,
    voices: allowlist.ok
      ? allowlist.voices.map(voice => ({
          id: voice.id,
          providerVoiceId: voice.providerVoiceId,
          emotions: voice.controls.emotions.map(emotion => ({
            id: emotion.id,
            providerValue: emotion.providerValue,
          })),
        }))
      : [],
  };
  const executionIdentityDigest = createHash("sha256")
    .update(canonicalJsonStringify(privateExecutionIdentity))
    .digest("hex");
  const fingerprintSource = {
    provider: "doubao",
    contractVersion: config.contractVersion.trim() || null,
    priceVersion: config.priceVersion.trim() || null,
    capabilities: {
      speechSynthesis,
      officialVoiceCatalog,
      voiceClone,
      preview,
    },
    officialVoices,
    dataPolicy: policy,
    executionIdentityDigest,
  };
  const fingerprint = `doubao-cap-${createHash("sha256")
    .update(canonicalJsonStringify(fingerprintSource))
    .digest("hex")}`;

  return {
    provider: "doubao",
    configured: Boolean(credential),
    contractVersion: config.contractVersion.trim() || null,
    priceVersion: config.priceVersion.trim() || null,
    fingerprint,
    manualAudioImportAvailable: true,
    capabilities: {
      speechSynthesis,
      officialVoiceCatalog,
      voiceClone,
      preview,
    },
    officialVoices,
    dataPolicy: policy,
  };
}

export function resolveDoubaoOfficialVoice(
  config: DoubaoSpeechCapabilityConfig,
  opaqueVoiceId: string
): {
  providerVoiceId: string;
  resourceId: string;
  endpoint: string;
  emotions: Record<string, string>;
} | null {
  const contract = buildDoubaoSpeechCapabilities(config);
  if (!contract.capabilities.officialVoiceCatalog.enabled) return null;
  const allowlist = parseOfficialVoiceAllowlist(
    config.officialVoiceAllowlistJson
  );
  if (!allowlist.ok) return null;
  const voice = allowlist.voices.find(item => item.id === opaqueVoiceId);
  if (!voice) return null;
  return {
    providerVoiceId: voice.providerVoiceId,
    resourceId: config.ttsResourceId.trim(),
    endpoint: TTS_ENDPOINT,
    emotions: Object.fromEntries(
      voice.controls.emotions.map(emotion => [
        emotion.id,
        emotion.providerValue,
      ])
    ),
  };
}

export function doubaoSpeechCapabilityConfigFromEnv(): DoubaoSpeechCapabilityConfig {
  return {
    apiKey: ENV.doubaoSpeechApiKey,
    nextApiKey: ENV.doubaoSpeechNextApiKey,
    activeKeySlot: ENV.doubaoSpeechActiveKeySlot,
    primaryCredentialStatus: ENV.doubaoSpeechPrimaryCredentialStatus,
    nextCredentialStatus: ENV.doubaoSpeechNextCredentialStatus,
    ttsEntitlementVerified: ENV.doubaoTtsEntitlementVerified,
    cloneEntitlementVerified: ENV.doubaoVoiceCloneEntitlementVerified,
    ttsResourceId: ENV.doubaoTtsResourceId,
    cloneResourceId: ENV.doubaoVoiceCloneResourceId,
    contractVersion: ENV.doubaoSpeechContractVersion,
    priceVersion: ENV.doubaoSpeechPriceVersion,
    officialVoiceAllowlistJson: ENV.doubaoOfficialVoiceAllowlistJson,
    previewModes: ENV.doubaoSpeechPreviewModes,
    policyVerified: ENV.doubaoVoiceClonePolicyVerified,
    policyRegion: ENV.doubaoSpeechPolicyRegion,
    retentionPolicyVersion: ENV.doubaoSpeechRetentionPolicyVersion,
    providerTrainingUse: ENV.doubaoVoiceCloneProviderTrainingUse,
    sampleRetention: ENV.doubaoVoiceCloneSampleRetention,
    deletionMode: ENV.doubaoVoiceCloneDeletionMode,
    deletionSla: ENV.doubaoVoiceCloneDeletionSla,
    dsarSupported: ENV.doubaoVoiceCloneDsarSupported,
  };
}

/** Documented endpoints are exported for server adapters, never client payloads. */
export const DOUBAO_SPEECH_ENDPOINTS = Object.freeze({
  tts: TTS_ENDPOINT,
  voiceClone: CLONE_ENDPOINT,
  voiceCloneStatus: CLONE_STATUS_ENDPOINT,
});
