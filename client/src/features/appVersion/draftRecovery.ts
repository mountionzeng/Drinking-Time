/** Copy the live book draft into a separate recovery record; never overwrite a sibling tab's cache. */
export type RecoveryDraft = { scope: string; chapterId: number; storyId: number; raw: string };
const parameter = 'recoverBookDraft';
const prefix = 'app-update-book-draft:';
let capture: (() => RecoveryDraft) | undefined;

export function registerDraftRecovery(reader: () => RecoveryDraft) {
  capture = reader;
  return () => { if (capture === reader) capture = undefined; };
}

export function prepareDraftRecoveryUrl(href: string): string {
  const url = new URL(href);
  const draft = capture?.();
  if (!draft) return url.toString();
  const token = crypto.randomUUID();
  const key = prefix + token;
  const serialized = JSON.stringify(draft);
  localStorage.setItem(key, serialized);
  if (localStorage.getItem(key) !== serialized) throw new Error('草稿备份未成功，当前页面仍保留，请勿关闭。');
  url.searchParams.set(parameter, token);
  url.searchParams.set('storyId', String(draft.storyId));
  return url.toString();
}

export function readRecoveredDraft(scope: string, chapterId: number): string | null {
  const token = new URLSearchParams(window.location?.search ?? '').get(parameter);
  if (!token) return null;
  try {
    const record = JSON.parse(localStorage.getItem(prefix + token) ?? 'null');
    if (record?.scope !== scope || record.chapterId !== chapterId || typeof record.raw !== 'string') return null;
    const draft = JSON.parse(record.raw);
    return typeof draft?.title === 'string' && typeof draft.body === 'string' ? record.raw : null;
  } catch { return null; }
}

/** Only remove the recovery record after its exact content was acknowledged by the server. */
export function clearRecoveredDraft(scope: string, chapterId: number, raw: string) {
  if (readRecoveredDraft(scope, chapterId) !== raw) return;
  const token = new URLSearchParams(window.location?.search ?? '').get(parameter);
  if (token) localStorage.removeItem(prefix + token);
}

export function updateRecoveredDraft(scope: string, chapterId: number, raw: string) {
  if (readRecoveredDraft(scope, chapterId) === null) return;
  const token = new URLSearchParams(window.location?.search ?? '').get(parameter)!;
  const key = prefix + token;
  const record = JSON.parse(localStorage.getItem(key)!);
  localStorage.setItem(key, JSON.stringify({ ...record, raw }));
}
