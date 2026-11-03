import { bookRewriteSource } from '@shared/bookRewrite';
import type { WritingCompanionSnapshot } from '../writingCompanion/writingCompanionText';
import type { BookModuleActions } from './bookModuleActions';

/** Capture at enqueue time, so an asynchronous reply cannot follow a later selection. */
export function bookRewriteChatSnapshot(snapshot: WritingCompanionSnapshot | undefined, editor: BookModuleActions | null) {
  if (!snapshot?.module) return snapshot;
  try {
    const target = editor?.captureRewrite?.(snapshot.module);
    return target ? { ...snapshot, bookRewriteTarget: target, rewriteSource: bookRewriteSource(target) } : snapshot;
  } catch {
    // A closing/stale editor must not block an ordinary discussion.
    return snapshot;
  }
}
