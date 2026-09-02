import {
  selectionIdentity,
  selectionReadiness,
  type SelectionContext,
  type SelectionReadiness,
} from "@shared/selectionContext";

export function activeSelectionReadiness(
  selection: SelectionContext | null | undefined,
  activeStoryId: number | null | undefined
): SelectionReadiness | null {
  return selection ? selectionReadiness(selection, activeStoryId) : null;
}

export function sameSelection(
  left: SelectionContext | null | undefined,
  right: SelectionContext | null | undefined
): boolean {
  return Boolean(
    left && right && selectionIdentity(left) === selectionIdentity(right)
  );
}

/** Consume only the snapshot that actually completed; a newer selection wins. */
export function consumeSubmittedSelection(
  current: SelectionContext | null,
  submitted: SelectionContext
): SelectionContext | null {
  return sameSelection(current, submitted) ? null : current;
}

export function executableSelection(
  selection: SelectionContext | null | undefined,
  activeStoryId: number | null | undefined
): SelectionContext | null {
  if (!selection) return null;
  return selectionReadiness(selection, activeStoryId).status === "executable"
    ? selection
    : null;
}
