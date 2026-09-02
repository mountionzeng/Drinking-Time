export const FINISHED_PRODUCT_SCHEMA_VERSION = 1 as const;

export type FinishedProductLayer = "text" | "image" | "video";
export type FinishedProductStatus = "editing" | "completed";

export type FinishedProductImageReference = {
  stableShotId: string;
  imageId: number;
};

export type FinishedProductVideoReference = {
  stableShotId: string;
  role: "primary" | "visual_clip";
  takeId: number;
  clipId?: string;
  rangeId?: number;
  sourceStartSec: number;
  sourceEndSec: number;
};

export type FinishedProductVersion = {
  id: string;
  sequence: number;
  status: FinishedProductStatus;
  purpose: string;
  textVersionId: string;
  images: FinishedProductImageReference[];
  videos: FinishedProductVideoReference[];
  imageVersion: number | null;
  videoVersion: number | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
};

export type FinishedProductState = {
  schemaVersion: typeof FINISHED_PRODUCT_SCHEMA_VERSION;
  revision: number;
  versions: FinishedProductVersion[];
  receipts: Record<string, FinishedProductReceipt>;
};

export type FinishedProductReceipt = {
  requestHash: string;
  command: FinishedProductCommand["type"];
  versionId: string | null;
  stateRevision: number;
  committedAt: number;
};

export type FinishedProductCurrentSnapshot = {
  textVersionId: string;
  images: readonly FinishedProductImageReference[];
  videos: readonly FinishedProductVideoReference[];
};

export type FinishedProductCommand =
  | {
      type: "save_layer";
      layer: FinishedProductLayer;
      purpose?: string;
      current: FinishedProductCurrentSnapshot;
    }
  | { type: "update_purpose"; purpose: string }
  | { type: "complete" }
  | { type: "abandon" };

export function emptyFinishedProductState(): FinishedProductState {
  return {
    schemaVersion: FINISHED_PRODUCT_SCHEMA_VERSION,
    revision: 0,
    versions: [],
    receipts: {},
  };
}

export function normalizeFinishedProductState(value: unknown): FinishedProductState {
  if (value == null) return emptyFinishedProductState();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Finished product state is malformed");
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== FINISHED_PRODUCT_SCHEMA_VERSION) {
    throw new Error("Finished product schema version is unsupported");
  }
  const revision =
    typeof record.revision === "number" &&
    Number.isSafeInteger(record.revision) &&
    record.revision >= 0
      ? record.revision
      : null;
  if (revision == null || !Array.isArray(record.versions)) {
    throw new Error("Finished product state is malformed");
  }
  const versions = record.versions.map(raw => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("Finished product version is malformed");
    }
    const version = raw as Record<string, unknown>;
    const id = typeof version.id === "string" ? version.id.trim() : "";
    const sequence = positiveInteger(version.sequence);
    const purpose = typeof version.purpose === "string" ? version.purpose.trim() : "";
    const textVersionId =
      typeof version.textVersionId === "string" ? version.textVersionId.trim() : "";
    const status = version.status;
    if (
      !id ||
      sequence == null ||
      !purpose ||
      !textVersionId ||
      (status !== "editing" && status !== "completed") ||
      !Array.isArray(version.images) ||
      !Array.isArray(version.videos)
    ) {
      throw new Error("Finished product version is malformed");
    }
    const createdAt = finiteNonNegative(version.createdAt);
    const updatedAt = finiteNonNegative(version.updatedAt);
    const completedAt =
      version.completedAt == null ? null : finiteNonNegative(version.completedAt);
    if (
      createdAt == null ||
      updatedAt == null ||
      (status === "completed" && completedAt == null)
    ) {
      throw new Error("Finished product timestamps are malformed");
    }
    return {
      id,
      sequence,
      status,
      purpose,
      textVersionId,
      images: normalizeFinishedProductImageSnapshot(
        version.images as FinishedProductImageReference[]
      ),
      videos: normalizeFinishedProductVideoSnapshot(
        version.videos as FinishedProductVideoReference[]
      ),
      imageVersion:
        version.imageVersion == null ? null : positiveInteger(version.imageVersion),
      videoVersion:
        version.videoVersion == null ? null : positiveInteger(version.videoVersion),
      createdAt,
      updatedAt,
      completedAt,
    } satisfies FinishedProductVersion;
  });
  if (new Set(versions.map(version => version.id)).size !== versions.length) {
    throw new Error("Finished product version ids are duplicated");
  }
  if (versions.filter(version => version.status === "editing").length > 1) {
    throw new Error("Finished product state has multiple editing versions");
  }
  const rawReceipts =
    record.receipts && typeof record.receipts === "object" && !Array.isArray(record.receipts)
      ? (record.receipts as Record<string, FinishedProductReceipt>)
      : {};
  return {
    schemaVersion: FINISHED_PRODUCT_SCHEMA_VERSION,
    revision,
    versions: versions.sort((left, right) => left.sequence - right.sequence),
    receipts: structuredClone(rawReceipts),
  };
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function finiteNonNegative(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

export function normalizeFinishedProductImageSnapshot(
  value: readonly FinishedProductImageReference[]
): FinishedProductImageReference[] {
  const byKey = new Map<string, FinishedProductImageReference>();
  for (const raw of value) {
    const stableShotId = raw.stableShotId.trim();
    const imageId = positiveInteger(raw.imageId);
    if (!stableShotId || imageId == null) continue;
    const reference = { stableShotId, imageId };
    byKey.set(`${stableShotId}:${imageId}`, reference);
  }
  return [...byKey.values()].sort(
    (left, right) =>
      left.stableShotId.localeCompare(right.stableShotId) ||
      left.imageId - right.imageId
  );
}

export function normalizeFinishedProductVideoSnapshot(
  value: readonly FinishedProductVideoReference[]
): FinishedProductVideoReference[] {
  const byKey = new Map<string, FinishedProductVideoReference>();
  for (const raw of value) {
    const stableShotId = raw.stableShotId.trim();
    const takeId = positiveInteger(raw.takeId);
    const sourceStartSec = finiteNonNegative(raw.sourceStartSec);
    const sourceEndSec = finiteNonNegative(raw.sourceEndSec);
    const role = raw.role;
    const clipId = raw.clipId?.trim();
    const rangeId = raw.rangeId == null ? null : positiveInteger(raw.rangeId);
    if (
      !stableShotId ||
      takeId == null ||
      sourceStartSec == null ||
      sourceEndSec == null ||
      sourceEndSec <= sourceStartSec ||
      (role !== "primary" && role !== "visual_clip") ||
      (role === "visual_clip" && !clipId)
    ) {
      continue;
    }
    const reference: FinishedProductVideoReference = {
      stableShotId,
      role,
      takeId,
      ...(clipId ? { clipId } : {}),
      ...(rangeId == null ? {} : { rangeId }),
      sourceStartSec,
      sourceEndSec,
    };
    const key = [
      stableShotId,
      role,
      clipId ?? "",
      takeId,
      rangeId ?? "",
      sourceStartSec,
      sourceEndSec,
    ].join(":");
    byKey.set(key, reference);
  }
  return [...byKey.values()].sort(
    (left, right) =>
      left.stableShotId.localeCompare(right.stableShotId) ||
      left.role.localeCompare(right.role) ||
      (left.clipId ?? "").localeCompare(right.clipId ?? "") ||
      left.takeId - right.takeId ||
      left.sourceStartSec - right.sourceStartSec ||
      left.sourceEndSec - right.sourceEndSec
  );
}

function snapshotKey(value: readonly unknown[]): string {
  return JSON.stringify(value);
}

export function completedFinishedProductLabels(
  versions: readonly FinishedProductVersion[]
): Array<{
  id: string;
  imageVersion: number | null;
  videoVersion: number | null;
}> {
  const imageNumbers = new Map<string, number>();
  const videoNumbers = new Map<string, number>();
  return [...versions]
    .sort((left, right) => left.sequence - right.sequence)
    .map(version => {
      if (version.status !== "completed") {
        return { id: version.id, imageVersion: null, videoVersion: null };
      }
      const images = normalizeFinishedProductImageSnapshot(version.images);
      const videos = normalizeFinishedProductVideoSnapshot(version.videos);
      const imageKey = snapshotKey(images);
      const videoKey = snapshotKey(videos);
      if (images.length > 0 && !imageNumbers.has(imageKey)) {
        imageNumbers.set(imageKey, imageNumbers.size + 1);
      }
      if (videos.length > 0 && !videoNumbers.has(videoKey)) {
        videoNumbers.set(videoKey, videoNumbers.size + 1);
      }
      return {
        id: version.id,
        imageVersion: images.length > 0 ? imageNumbers.get(imageKey)! : null,
        videoVersion: videos.length > 0 ? videoNumbers.get(videoKey)! : null,
      };
    });
}

export function replaceFinishedProductLayer(
  version: FinishedProductVersion,
  layer: FinishedProductLayer,
  replacement: {
    textVersionId?: string;
    images?: readonly FinishedProductImageReference[];
    videos?: readonly FinishedProductVideoReference[];
  }
): FinishedProductVersion {
  const textVersionId = replacement.textVersionId?.trim();
  return {
    ...version,
    textVersionId:
      layer === "text" && textVersionId ? textVersionId : version.textVersionId,
    images:
      layer === "image" && replacement.images
        ? normalizeFinishedProductImageSnapshot(replacement.images)
        : structuredClone(version.images),
    videos:
      layer === "video" && replacement.videos
        ? normalizeFinishedProductVideoSnapshot(replacement.videos)
        : structuredClone(version.videos),
  };
}

function requiredPurpose(value: string | undefined): string {
  const purpose = value?.trim() ?? "";
  if (!purpose) throw new Error("Finished product purpose is required");
  return purpose;
}

function editingVersion(state: FinishedProductState): FinishedProductVersion | null {
  return state.versions.find(version => version.status === "editing") ?? null;
}

export function applyFinishedProductCommand(
  state: FinishedProductState,
  command: FinishedProductCommand,
  now: number
): FinishedProductState {
  const editing = editingVersion(state);

  if (command.type === "abandon") {
    if (!editing) return state;
    return {
      ...state,
      revision: state.revision + 1,
      versions: state.versions.filter(version => version.id !== editing.id),
    };
  }

  if (command.type === "complete") {
    if (!editing) throw new Error("No editing finished product version exists");
    const completed = state.versions.map(version =>
      version.id === editing.id
        ? {
            ...version,
            status: "completed" as const,
            completedAt: now,
            updatedAt: now,
          }
        : version
    );
    const labels = new Map(
      completedFinishedProductLabels(completed).map(label => [label.id, label])
    );
    return {
      ...state,
      revision: state.revision + 1,
      versions: completed.map(version => {
        const label = labels.get(version.id);
        return version.status === "completed" && label
          ? {
              ...version,
              imageVersion: label.imageVersion,
              videoVersion: label.videoVersion,
            }
          : version;
      }),
    };
  }

  if (command.type === "update_purpose") {
    if (!editing) throw new Error("No editing finished product version exists");
    const purpose = requiredPurpose(command.purpose);
    return {
      ...state,
      revision: state.revision + 1,
      versions: state.versions.map(version =>
        version.id === editing.id
          ? { ...version, purpose, updatedAt: now }
          : version
      ),
    };
  }

  const current = {
    textVersionId: command.current.textVersionId.trim(),
    images: normalizeFinishedProductImageSnapshot(command.current.images),
    videos: normalizeFinishedProductVideoSnapshot(command.current.videos),
  };
  if (!current.textVersionId) {
    throw new Error("Finished product text version is required");
  }

  if (editing) {
    const updated = replaceFinishedProductLayer(editing, command.layer, current);
    return {
      ...state,
      revision: state.revision + 1,
      versions: state.versions.map(version =>
        version.id === editing.id
          ? {
              ...updated,
              ...(command.purpose == null
                ? {}
                : { purpose: requiredPurpose(command.purpose) }),
              updatedAt: now,
            }
          : version
      ),
    };
  }

  const previous = [...state.versions]
    .filter(version => version.status === "completed")
    .sort((left, right) => right.sequence - left.sequence)[0];
  const sequence = Math.max(0, ...state.versions.map(version => version.sequence)) + 1;
  const base: FinishedProductVersion = previous
    ? {
        ...structuredClone(previous),
        id: `finished-${sequence}`,
        sequence,
        status: "editing",
        purpose: requiredPurpose(command.purpose),
        imageVersion: null,
        videoVersion: null,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      }
    : {
        id: `finished-${sequence}`,
        sequence,
        status: "editing",
        purpose: requiredPurpose(command.purpose),
        textVersionId: current.textVersionId,
        images: current.images,
        videos: current.videos,
        imageVersion: null,
        videoVersion: null,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      };
  const next = previous
    ? replaceFinishedProductLayer(base, command.layer, current)
    : base;
  return {
    ...state,
    revision: state.revision + 1,
    versions: [...state.versions, next],
  };
}
