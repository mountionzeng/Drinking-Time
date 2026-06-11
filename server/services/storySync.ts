type StoryBodyRecord = Record<string, unknown>;

const REVISION_KEY = "_revision";

function asRecord(value: unknown): StoryBodyRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as StoryBodyRecord)
    : {};
}

function stringPart(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberPart(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
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
    const shotNo = numberPart(item.shotNo) || stringPart(item.shotNo);
    return shotNo ? `shot:${shotNo}` : `index:${index}`;
  }
  if (collection === "characters") {
    const name = stringPart(item.name);
    return name ? `character:${name}` : `index:${index}`;
  }

  return `index:${index}`;
}

function mergeStableArray(
  collection: string,
  serverValue: unknown,
  incomingValue: unknown
): unknown[] {
  const serverItems = Array.isArray(serverValue) ? serverValue : [];
  const incomingItems = Array.isArray(incomingValue) ? incomingValue : [];
  const merged = [...serverItems];
  const known = new Set(
    serverItems.map((item, index) => itemKey(collection, item, index))
  );

  incomingItems.forEach((item, index) => {
    const key = itemKey(collection, item, index);
    if (!known.has(key)) {
      known.add(key);
      merged.push(item);
    }
  });

  return merged;
}

export function getStoryRevision(body: unknown): number {
  const revision = asRecord(body)[REVISION_KEY];
  return typeof revision === "number" && Number.isInteger(revision) && revision >= 0
    ? revision
    : 0;
}

export function prepareStoryBody(body: unknown, revision: number): StoryBodyRecord {
  const prepared = { ...asRecord(body) };
  // 图片以 generatedImages 表为唯一权威来源，避免故事 blob 再保存一份陈旧副本。
  delete prepared.mobileImages;
  delete prepared.images;
  prepared[REVISION_KEY] = revision;
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
      merged[collection] = mergeStableArray(
        collection,
        server[collection],
        incoming[collection]
      );
    }
  }

  return prepareStoryBody(merged, revision);
}
