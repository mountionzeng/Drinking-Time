import type { ImageClipEditorTarget } from "./imageClipEditorModel";

export type PreviewObjectMask = {
  maskKey: string;
  maskUrl: string;
  previewMaskUrl: string;
  width: number;
  height: number;
};

export type PreviewObjectMaskCandidate = {
  imageId: number;
  imageUrl: string;
};

export type PreviewObjectMaskState = {
  phase:
    | "idle"
    | "extracting"
    | "selecting"
    | "segmenting"
    | "mask-ready"
    | "generating"
    | "uncertain"
    | "candidate-ready"
    | "adopting";
  target: ImageClipEditorTarget | null;
  requestId: number;
  mask: PreviewObjectMask | null;
  maskConfirmed: boolean;
  candidate: PreviewObjectMaskCandidate | null;
  error: string | null;
};

export const INITIAL_PREVIEW_OBJECT_MASK_STATE: PreviewObjectMaskState = {
  phase: "idle",
  target: null,
  requestId: 0,
  mask: null,
  maskConfirmed: false,
  candidate: null,
  error: null,
};

/** Monotonic fence for async work whose result must not survive a session reset. */
export function createPreviewMaskRequestFence() {
  let current = 0;
  return {
    begin: () => ++current,
    invalidate: () => { current += 1; },
    isCurrent: (token: number) => token === current,
  };
}

export function previewMaskTargetChanged(
  sessionTarget: ImageClipEditorTarget | null,
  visibleTarget: ImageClipEditorTarget | null
): boolean {
  if (!sessionTarget) return false;
  if (!visibleTarget) return true;
  return (
    sessionTarget.imageId !== visibleTarget.imageId ||
    sessionTarget.targetKind !== visibleTarget.targetKind ||
    sessionTarget.clipId !== visibleTarget.clipId ||
    sessionTarget.stableShotId !== visibleTarget.stableShotId
  );
}

/** Reset an active session as soon as its Preview target is replaced or
 * disappears.  The caller owns the reset because it also clears component
 * state, while this boundary keeps the target-change contract testable. */
export function resetPreviewMaskSessionForTargetChange(input: {
  sessionTarget: ImageClipEditorTarget | null;
  visibleTarget: ImageClipEditorTarget | null;
  reset: () => void;
}): boolean {
  if (!previewMaskTargetChanged(input.sessionTarget, input.visibleTarget)) {
    return false;
  }
  input.reset();
  return true;
}

/** Resolve an extracted frame only while its owning Preview session remains
 * current. Keeping this small async boundary pure makes cancellation behavior
 * testable without coupling it to the full editor component. */
export async function completePreviewMaskExtraction<T>(input: {
  fence: ReturnType<typeof createPreviewMaskRequestFence>;
  token: number;
  extract: () => Promise<T | null>;
  onStart: (target: T) => void;
  onError: (error: unknown) => void;
}): Promise<void> {
  try {
    const target = await input.extract();
    if (!target) throw new Error("当前帧抽取失败");
    if (input.fence.isCurrent(input.token)) input.onStart(target);
  } catch (error) {
    if (input.fence.isCurrent(input.token)) input.onError(error);
  }
}

type Action =
  | { type: "extracting" }
  | { type: "start"; target: ImageClipEditorTarget }
  | { type: "segment"; requestId: number }
  | { type: "mask"; requestId: number; mask: PreviewObjectMask }
  | { type: "confirm-mask" }
  | { type: "generate"; requestId: number }
  | { type: "candidate"; requestId: number; candidate: PreviewObjectMaskCandidate }
  | {
      type: "restore-candidate";
      target: ImageClipEditorTarget;
      candidate: PreviewObjectMaskCandidate;
    }
  | { type: "uncertain"; requestId: number; message: string }
  | { type: "adopt"; requestId: number }
  | { type: "error"; requestId?: number; message: string }
  | { type: "reselect" }
  | { type: "reset" };

export function previewObjectMaskReducer(
  state: PreviewObjectMaskState,
  action: Action
): PreviewObjectMaskState {
  if (
    action.type !== "segment" &&
    action.type !== "generate" &&
    action.type !== "adopt" &&
    "requestId" in action &&
    action.requestId !== undefined &&
    action.requestId !== state.requestId
  ) return state;
  switch (action.type) {
    case "extracting":
      return {
        ...INITIAL_PREVIEW_OBJECT_MASK_STATE,
        phase: "extracting",
        requestId: state.requestId + 1,
      };
    case "start":
      return {
        ...INITIAL_PREVIEW_OBJECT_MASK_STATE,
        phase: "selecting",
        target: action.target,
        requestId: state.requestId + 1,
      };
    case "segment":
      return {
        ...state,
        phase: "segmenting",
        requestId: action.requestId,
        mask: null,
        maskConfirmed: false,
        candidate: null,
        error: null,
      };
    case "mask":
      return { ...state, phase: "mask-ready", mask: action.mask, error: null };
    case "confirm-mask":
      return { ...state, maskConfirmed: true, error: null };
    case "generate":
      return { ...state, phase: "generating", requestId: action.requestId, error: null };
    case "candidate":
      return { ...state, phase: "candidate-ready", candidate: action.candidate, error: null };
    case "restore-candidate":
      if (!state.target || previewMaskTargetChanged(state.target, action.target)) {
        return state;
      }
      return {
        ...state,
        phase: "candidate-ready",
        candidate: action.candidate,
        error: null,
      };
    case "uncertain":
      return { ...state, phase: "uncertain", error: action.message };
    case "adopt":
      return { ...state, phase: "adopting", requestId: action.requestId, error: null };
    case "error":
      return {
        ...state,
        phase: state.mask ? "mask-ready" : state.target ? "selecting" : "idle",
        error: action.message,
      };
    case "reselect":
      return {
        ...state,
        phase: "selecting",
        requestId: state.requestId + 1,
        mask: null,
        maskConfirmed: false,
        candidate: null,
        error: null,
      };
    case "reset":
      return {
        ...INITIAL_PREVIEW_OBJECT_MASK_STATE,
        requestId: state.requestId + 1,
      };
  }
}
