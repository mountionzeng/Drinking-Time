import {
  ensureShotIdentities,
  shotIdentityFromShot,
} from "../../shared/shotIdentity";
import { STORY_SHOT_EDITABLE_FIELDS } from "../../shared/shotDirector";
import { assertPersistedStoryBodyEnvelope } from "../../shared/storyContract";

type StoryBodyRecord = Record<string, unknown>;

const REVISION_KEY = "_revision";
const SHOT_FIELDS_TO_PRESERVE = [
  "stableShotId",
  "shotIdentity",
  "sceneNo",
  "sceneTitle",
  "sceneArtBrief",
  "scriptText",
  "publishingVideo",
  "voiceAudioUrl",
  "voiceAudioText",
  "voiceAudioProvider",
  "voiceAudioVoice",
  "voiceAudioGeneratedAt",
  "intent",
  "rationale",
  "videoStart",
  "videoEnd",
  "transitionIn",
  "transitionOut",
  "videoPrompt",
] as const;

const SHOT_CONTENT_FIELDS_FOR_PROMPT_METADATA = [
  "shotNo",
  "sceneNo",
  "sceneTitle",
  "sceneArtBrief",
  "subject",
  "action",
  "scriptText",
  "dialogue",
  "shotType",
  "beat",
  "cameraAngle",
  "cameraMove",
  "location",
  "timeLight",
  "mood",
  "sound",
  "styleRef",
  "note",
  "emotion",
  "sourceCardContent",
  "intent",
  "rationale",
  "videoStart",
  "videoEnd",
  "transitionIn",
  "transitionOut",
  "videoPrompt",
  "emotionCharge",
  "emotionDelta",
  "visualAnchorText",
] as const;

const SHOT_STABLE_EDITOR_FIELDS = ["durationMs", "fragmentRefs"] as const;

const SHOT_DIRECTOR_FIELDS_TO_PRESERVE = [
  ...STORY_SHOT_EDITABLE_FIELDS,
  "chatCutMapping",
] as const;

const BODY_FIELDS_TO_PRESERVE = [
  "scenes",
  "materialReusePolicy",
  "sourceStoryId",
  "sourceStoryTitle",
  "chatCutImport",
] as const;

// Dedicated mutations own these slices. Generic whole-Story saves may carry an
// older browser snapshot and must never replace the latest server copy.
const SERVER_OWNED_BODY_FIELDS = [
  "publishing",
  "visualAssets",
  "finishedProduct",
] as const;

const SHOT_PROMPT_METADATA_FIELDS = [
  "promptOverrides",
  "promptRun",
  "promptDraft",
  "negativePrompt",
] as const;

function asRecord(value: unknown): StoryBodyRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as StoryBodyRecord)
    : {};
}

function stringPart(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberPart(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : "";
}

function itemKey(collection: string, value: unknown, index: number): string {
  const item = asRecord(value);
  const id = stringPart(item.id);
  if (id) return `id:${id}`;

  if (collection === "messages") {
    return [
      "message",
      numberPart(item.timestamp),
      stringPart(item.role) || stringPart(item.who),
      stringPart(item.content) || stringPart(item.text),
      stringPart(item.photoUrl),
    ].join(":");
  }
  if (collection === "cards") {
    return [
      "card",
      numberPart(item.createdAt),
      stringPart(item.content),
      stringPart(item.title),
    ].join(":");
  }
  if (collection === "shots") {
    const identity = shotIdentityFromShot(item, index);
    if (identity) return `shotIdentity:${identity}`;
    const shotNo = numberPart(item.shotNo) || stringPart(item.shotNo);
    return shotNo ? `shot:${shotNo}` : `index:${index}`;
  }
  if (collection === "characters") {
    const name = stringPart(item.name);
    return name ? `character:${name}` : `index:${index}`;
  }

  return `index:${index}`;
}

function mergeStaleMessageState(serverValue: unknown, incomingValue: unknown) {
  const serverMessage = asRecord(serverValue);
  const incomingMessage = asRecord(incomingValue);
  const serverCandidate = asRecord(serverMessage.editingTransitionCandidate);
  const incomingCandidate = asRecord(incomingMessage.editingTransitionCandidate);
  const serverCandidateId = stringPart(serverCandidate.candidateId);
  const incomingCandidateId = stringPart(incomingCandidate.candidateId);
  if (!serverCandidateId || serverCandidateId !== incomingCandidateId) {
    return serverValue;
  }

  const terminal = new Set(["applied", "rejected"]);
  const serverStatus = stringPart(serverCandidate.status);
  const incomingStatus = stringPart(incomingCandidate.status);
  if (terminal.has(serverStatus) || !terminal.has(incomingStatus)) {
    return serverValue;
  }

  return {
    ...serverMessage,
    editingTransitionCandidate: {
      ...serverCandidate,
      ...incomingCandidate,
    },
  };
}

function mergeStableArray(
  collection: string,
  serverValue: unknown,
  incomingValue: unknown
): unknown[] {
  const serverItems = Array.isArray(serverValue) ? serverValue : [];
  const incomingItems = Array.isArray(incomingValue) ? incomingValue : [];
  const merged = [...serverItems];
  const known = new Map(
    serverItems.map((item, index) => [itemKey(collection, item, index), index])
  );

  incomingItems.forEach((item, index) => {
    const key = itemKey(collection, item, index);
    const existingIndex = known.get(key);
    if (existingIndex === undefined) {
      known.set(key, merged.length);
      merged.push(item);
    } else if (collection === "messages") {
      merged[existingIndex] = mergeStaleMessageState(
        merged[existingIndex],
        item
      );
    }
  });

  return merged;
}

function hasOwn(record: StoryBodyRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function comparableShotValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return JSON.stringify(value);
}

function sameShotContentForPromptMetadata(
  serverShot: StoryBodyRecord,
  incomingShot: StoryBodyRecord
): boolean {
  return SHOT_CONTENT_FIELDS_FOR_PROMPT_METADATA.every(
    field =>
      comparableShotValue(serverShot[field]) ===
      comparableShotValue(incomingShot[field])
  );
}

// shotNo/shotKey 会被 reindexStoryShots 重编号，身份字段会被 ensureShotIdentities
// 重新生成，都不能参与内容比较——否则同一镜头换个编号就认不出来了。
function shotContentKey(value: unknown): string | null {
  const shot = asRecord(value);
  const parts = SHOT_CONTENT_FIELDS_FOR_PROMPT_METADATA.filter(
    field => field !== "shotNo"
  ).map(field => comparableShotValue(shot[field]));
  if (parts.every(part => part === "")) return null;
  return parts.join("\u0000");
}

type MergeShotOptions = {
  preserveNonEmptyDialogue?: boolean;
  preserveServerDirectorFields?: boolean;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function mergeShotPreservedFields(
  serverValue: unknown,
  incomingValue: unknown,
  options: MergeShotOptions = {}
): unknown {
  const serverShot = asRecord(serverValue);
  const incomingShot = asRecord(incomingValue);
  const merged: StoryBodyRecord = { ...incomingShot };

  for (const field of SHOT_FIELDS_TO_PRESERVE) {
    if (!hasOwn(merged, field) && hasOwn(serverShot, field)) {
      merged[field] = serverShot[field];
    }
  }

  for (const field of SHOT_STABLE_EDITOR_FIELDS) {
    if (!hasOwn(merged, field) && hasOwn(serverShot, field)) {
      merged[field] = serverShot[field];
    }
  }

  for (const field of SHOT_DIRECTOR_FIELDS_TO_PRESERVE) {
    const isPromptMetadata =
      field === "promptDraft" || field === "negativePrompt";
    if (options.preserveServerDirectorFields && hasOwn(serverShot, field)) {
      merged[field] = serverShot[field];
    } else if (
      !isPromptMetadata &&
      !hasOwn(merged, field) &&
      hasOwn(serverShot, field)
    ) {
      merged[field] = serverShot[field];
    }
  }

  if (sameShotContentForPromptMetadata(serverShot, incomingShot)) {
    for (const field of SHOT_PROMPT_METADATA_FIELDS) {
      if (!hasOwn(merged, field) && hasOwn(serverShot, field)) {
        merged[field] = serverShot[field];
      }
    }
  }

  if (
    options.preserveNonEmptyDialogue &&
    isNonEmptyString(serverShot.dialogue) &&
    !isNonEmptyString(incomingShot.dialogue)
  ) {
    merged.dialogue = serverShot.dialogue;
  }

  return merged;
}

function reindexStoryShots(items: unknown[]): unknown[] {
  return items.map((item, index) => {
    const shot = asRecord(item);
    if (!shot) return item;
    return {
      ...shot,
      shotNo: index + 1,
      shotKey: `SH${String(index + 1).padStart(2, "0")}`,
    };
  });
}

function mergeStoryShotsPreservingFields(
  serverValue: unknown,
  incomingValue: unknown,
  options: { preserveServerOnly?: boolean } = {}
): unknown[] {
  const serverItems = Array.isArray(serverValue) ? serverValue : [];
  const incomingItems = Array.isArray(incomingValue) ? incomingValue : [];
  if (incomingItems.length === 0) return [...serverItems];

  const serverEntries = serverItems.map((item, index) => ({
    item,
    key: itemKey("shots", item, index),
  }));
  const incomingEntries = incomingItems.map((item, index) => ({
    item,
    key: itemKey("shots", item, index),
  }));
  const serverByKey = new Map(
    serverEntries.map(entry => [entry.key, entry.item])
  );
  const incomingByKey = new Map(
    incomingEntries.map(entry => [entry.key, entry.item])
  );

  if (options.preserveServerOnly) {
    const knownServerKeys = new Set(serverEntries.map(entry => entry.key));
    // 身份没匹配上但内容和服务端某个镜头一致的，视为同一镜头的旧快照副本，
    // 直接丢弃——过期客户端反复回传整张镜头表时，这里是防止列表滚雪球的闸门。
    const serverContentKeys = new Set(
      serverEntries
        .map(entry => shotContentKey(entry.item))
        .filter((key): key is string => key !== null)
    );
    const insertionsByPreviousKnownKey = new Map<
      string,
      typeof incomingEntries
    >();
    const leadingInsertions: typeof incomingEntries = [];
    let previousKnownKey: string | null = null;

    incomingEntries.forEach(entry => {
      if (knownServerKeys.has(entry.key)) {
        previousKnownKey = entry.key;
        return;
      }
      const contentKey = shotContentKey(entry.item);
      if (contentKey !== null && serverContentKeys.has(contentKey)) {
        return;
      }
      if (previousKnownKey) {
        const bucket = insertionsByPreviousKnownKey.get(previousKnownKey) ?? [];
        bucket.push(entry);
        insertionsByPreviousKnownKey.set(previousKnownKey, bucket);
      } else {
        leadingInsertions.push(entry);
      }
    });

    const merged = leadingInsertions.map(entry =>
      mergeShotPreservedFields(serverByKey.get(entry.key), entry.item, {
        preserveNonEmptyDialogue: true,
      })
    );

    serverEntries.forEach(entry => {
      const incoming = incomingByKey.get(entry.key);
      if (incoming !== undefined) {
        merged.push(
          mergeShotPreservedFields(entry.item, incoming, {
            preserveNonEmptyDialogue: true,
            preserveServerDirectorFields: true,
          })
        );
      } else {
        merged.push(entry.item);
      }
      const inserted = insertionsByPreviousKnownKey.get(entry.key) ?? [];
      inserted.forEach(insertedEntry => {
        merged.push(
          mergeShotPreservedFields(
            serverByKey.get(insertedEntry.key),
            insertedEntry.item,
            { preserveNonEmptyDialogue: true }
          )
        );
      });
    });

    return reindexStoryShots(merged);
  }

  const merged = incomingEntries.map(entry => {
    return mergeShotPreservedFields(serverByKey.get(entry.key), entry.item);
  });

  return merged;
}

function cleanShotForPersistence(value: unknown): unknown {
  const shot = asRecord(value);
  const cleaned: StoryBodyRecord = { ...shot };
  if (
    typeof cleaned.promptDraft === "string" &&
    cleaned.promptDraft.trim() === ""
  ) {
    delete cleaned.promptDraft;
  }
  return cleaned;
}

function cleanStoryShotsForPersistence(value: unknown): unknown[] {
  const shots = Array.isArray(value) ? value : [];
  return ensureShotIdentities(
    shots
      .map(cleanShotForPersistence)
      .filter((shot): shot is StoryBodyRecord => Boolean(shot))
  );
}

export function getStoryRevision(body: unknown): number {
  const revision = asRecord(body)[REVISION_KEY];
  return typeof revision === "number" &&
    Number.isInteger(revision) &&
    revision >= 0
    ? revision
    : 0;
}

export function prepareStoryBody(
  body: unknown,
  revision: number,
  existingBody?: unknown
): StoryBodyRecord {
  const prepared = { ...asRecord(body) };
  const existing = asRecord(existingBody);
  for (const field of BODY_FIELDS_TO_PRESERVE) {
    if (!hasOwn(prepared, field) && hasOwn(existing, field)) {
      prepared[field] = existing[field];
    }
  }
  for (const field of SERVER_OWNED_BODY_FIELDS) {
    if (hasOwn(existing, field)) {
      prepared[field] = existing[field];
    }
  }
  prepared.shots = cleanStoryShotsForPersistence(
    mergeStoryShotsPreservingFields(existing.shots, prepared.shots)
  );
  // 图片以 generatedImages 表为唯一权威来源，避免故事 blob 再保存一份陈旧副本。
  delete prepared.mobileImages;
  delete prepared.images;
  prepared[REVISION_KEY] = revision;
  assertPersistedStoryBodyEnvelope(prepared);
  return prepared;
}

export function mergeStaleStoryBody(
  serverBody: unknown,
  incomingBody: unknown,
  revision: number
): StoryBodyRecord {
  const server = asRecord(serverBody);
  const incoming = asRecord(incomingBody);
  const merged: StoryBodyRecord = { ...server };

  for (const collection of [
    "messages",
    "cards",
    "shots",
    "characters",
    "visualCanvasItems",
  ]) {
    if (Array.isArray(incoming[collection])) {
      merged[collection] =
        collection === "shots"
          ? mergeStoryShotsPreservingFields(
              server[collection],
              incoming[collection],
              {
                preserveServerOnly: true,
              }
            )
          : mergeStableArray(
              collection,
              server[collection],
              incoming[collection]
            );
    }
  }

  return prepareStoryBody(merged, revision);
}
