/**
 * Edit diff computation service
 * Detects additions, deletions, and modifications across cards, script, and shots
 * while ignoring metadata changes (createdAt, updatedAt, etc.)
 */

export interface StoryCard {
  id: string;
  title?: string;
  content?: string;
  tags?: string[];
  [key: string]: unknown;
}

export interface ScriptScene {
  id: string;
  sceneNumber?: number;
  heading?: string;
  action?: string;
  dialogue?: string;
  [key: string]: unknown;
}

export interface ShotRow {
  shotNo: number;
  shotType?: string;
  cameraAngle?: string;
  description?: string;
  [key: string]: unknown;
}

export interface ProjectState {
  cards?: StoryCard[];
  script?: ScriptScene[];
  shots?: ShotRow[];
  /** Visual anchor canvas state is stored with snapshots, but not diffed yet. */
  visualCanvasItems?: Record<string, unknown>[];
  /** Project-local aesthetic memory used by the Art Agent. */
  visualPreference?: string;
}

export interface EditDiff {
  cards: {
    deleted: StoryCard[];
    added: StoryCard[];
    modified: Array<{ old: StoryCard; new: StoryCard }>;
  };
  script: {
    deleted: ScriptScene[];
    added: ScriptScene[];
    modified: Array<{ old: ScriptScene; new: ScriptScene }>;
  };
  shots: {
    deleted: ShotRow[];
    added: ShotRow[];
    modified: Array<{ old: ShotRow; new: ShotRow }>;
  };
}

// Metadata fields to ignore when comparing objects
const IGNORED_FIELDS = new Set([
  'createdAt',
  'updatedAt',
  'timestamp',
  'lastModified',
  'readinessScore', // UI-only field for shots
]);

/**
 * Remove ignored metadata fields from an object for comparison
 */
function stripMetadata<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const result: Partial<T> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!IGNORED_FIELDS.has(key)) {
      result[key as keyof T] = value as T[keyof T];
    }
  }
  return result;
}

/**
 * Deep equality check for two objects (ignoring metadata fields)
 */
function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;

  if (typeof a === 'object' && typeof b === 'object') {
    const aObj = stripMetadata(a as Record<string, unknown>);
    const bObj = stripMetadata(b as Record<string, unknown>);

    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);

    if (aKeys.length !== bKeys.length) return false;

    for (const key of aKeys) {
      if (!isEqual(aObj[key], bObj[key])) return false;
    }

    return true;
  }

  return false;
}

/**
 * Compute diff for an array of items with stable identity
 */
function diffArray<T extends Record<string, unknown>>(
  oldItems: T[] | undefined,
  newItems: T[] | undefined,
  getKey: (item: T) => string | number,
): {
  deleted: T[];
  added: T[];
  modified: Array<{ old: T; new: T }>;
} {
  const deleted: T[] = [];
  const added: T[] = [];
  const modified: Array<{ old: T; new: T }> = [];

  const oldArray = oldItems ?? [];
  const newArray = newItems ?? [];

  // Build maps for efficient lookup
  const oldMap = new Map<string | number, T>();
  const newMap = new Map<string | number, T>();

  for (const item of oldArray) {
    oldMap.set(getKey(item), item);
  }

  for (const item of newArray) {
    newMap.set(getKey(item), item);
  }

  // Find deleted and modified items
  oldMap.forEach((oldItem, key) => {
    const newItem = newMap.get(key);
    if (!newItem) {
      deleted.push(oldItem);
    } else if (!isEqual(oldItem, newItem)) {
      modified.push({ old: oldItem, new: newItem });
    }
  });

  // Find added items
  newMap.forEach((newItem, key) => {
    if (!oldMap.has(key)) {
      added.push(newItem);
    }
  });

  return { deleted, added, modified };
}

/**
 * Compute diff between two project states
 * Returns structured diff identifying additions, deletions, and modifications
 */
export function computeDiff(
  oldState: ProjectState | null,
  newState: ProjectState,
): EditDiff {
  // Handle first snapshot case (no previous state)
  if (!oldState) {
    return {
      cards: {
        deleted: [],
        added: newState.cards ?? [],
        modified: [],
      },
      script: {
        deleted: [],
        added: newState.script ?? [],
        modified: [],
      },
      shots: {
        deleted: [],
        added: newState.shots ?? [],
        modified: [],
      },
    };
  }

  // Compute diffs for each entity type
  const cardsDiff = diffArray(
    oldState.cards,
    newState.cards,
    (card) => card.id,
  );

  const scriptDiff = diffArray(
    oldState.script,
    newState.script,
    (scene) => scene.id,
  );

  const shotsDiff = diffArray(
    oldState.shots,
    newState.shots,
    (shot) => shot.shotNo,
  );

  return {
    cards: cardsDiff,
    script: scriptDiff,
    shots: shotsDiff,
  };
}

/**
 * Check if a diff is empty (no changes detected)
 */
export function isDiffEmpty(diff: EditDiff): boolean {
  return (
    diff.cards.deleted.length === 0 &&
    diff.cards.added.length === 0 &&
    diff.cards.modified.length === 0 &&
    diff.script.deleted.length === 0 &&
    diff.script.added.length === 0 &&
    diff.script.modified.length === 0 &&
    diff.shots.deleted.length === 0 &&
    diff.shots.added.length === 0 &&
    diff.shots.modified.length === 0
  );
}
