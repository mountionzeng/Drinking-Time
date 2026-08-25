export type VisualEditSessionActivationResult =
  | { status: "ok"; activeEpoch: string; replacedEpoch?: string }
  | { status: "error"; error: string };

type EpochState = { editorClientId: string; status: "active" | "invalid" };

const activeEpochByClient = new Map<
  string,
  { epoch: string; sequence: number }
>();
const epochStateByScope = new Map<string, EpochState>();

const clientKey = (input: {
  storyId: number;
  userId: number;
  editorClientId: string;
}) => `${input.userId}:${input.storyId}:${input.editorClientId}`;

const epochKey = (input: {
  storyId: number;
  userId: number;
  editorSessionEpoch: string;
}) => `${input.userId}:${input.storyId}:${input.editorSessionEpoch}`;

function retireEpoch(key: string, editorClientId: string): void {
  epochStateByScope.set(key, {
    editorClientId,
    status: "invalid",
  });
}

/**
 * Activating a new epoch permanently retires the previous epoch for this
 * editor client. Other browser tabs use their own client id and remain active.
 */
export function activateVisualEditSession(input: {
  storyId: number;
  userId: number;
  editorClientId: string;
  editorSessionEpoch: string;
  activationSequence: number;
}): VisualEditSessionActivationResult {
  const client = input.editorClientId.trim();
  const epoch = input.editorSessionEpoch.trim();
  if (!client || !epoch) return { status: "error", error: "剪辑会话标识无效" };
  if (
    !Number.isSafeInteger(input.activationSequence) ||
    input.activationSequence < 0
  )
    return { status: "error", error: "剪辑会话激活序号无效" };

  const key = clientKey({ ...input, editorClientId: client });
  const current = activeEpochByClient.get(key);
  if (current && input.activationSequence < current.sequence) {
    if (epoch !== current.epoch) {
      const staleKey = epochKey({ ...input, editorSessionEpoch: epoch });
      const staleState = epochStateByScope.get(staleKey);
      if (!staleState || staleState.editorClientId === client)
        retireEpoch(staleKey, client);
    }
    return { status: "error", error: "较旧的剪辑会话激活请求已失效" };
  }
  if (current && input.activationSequence === current.sequence) {
    if (epoch === current.epoch)
      return { status: "ok", activeEpoch: current.epoch };
    const staleKey = epochKey({ ...input, editorSessionEpoch: epoch });
    const staleState = epochStateByScope.get(staleKey);
    if (!staleState || staleState.editorClientId === client)
      retireEpoch(staleKey, client);
    return { status: "error", error: "相同激活序号不能用于另一个剪辑会话" };
  }

  const nextEpochKey = epochKey({ ...input, editorSessionEpoch: epoch });
  const existingEpoch = epochStateByScope.get(nextEpochKey);
  if (existingEpoch?.status === "invalid")
    return { status: "error", error: "这个剪辑会话已经失效，请刷新后重试" };
  if (existingEpoch && existingEpoch.editorClientId !== client)
    return { status: "error", error: "剪辑会话标识已被另一个编辑器使用" };

  const previous = current?.epoch;
  if (previous && previous !== epoch) {
    retireEpoch(epochKey({ ...input, editorSessionEpoch: previous }), client);
  }
  activeEpochByClient.set(key, {
    epoch,
    sequence: input.activationSequence,
  });
  epochStateByScope.set(nextEpochKey, {
    editorClientId: client,
    status: "active",
  });
  return {
    status: "ok",
    activeEpoch: epoch,
    ...(previous && previous !== epoch ? { replacedEpoch: previous } : {}),
  };
}

/** Unregistered epochs remain allowed for compatibility with older clients. */
export function isVisualEditSessionEpochAllowed(input: {
  storyId: number;
  userId: number;
  editorSessionEpoch: string;
}): boolean {
  return epochStateByScope.get(epochKey(input))?.status !== "invalid";
}

export function clearVisualEditSessionsForTesting(): void {
  activeEpochByClient.clear();
  epochStateByScope.clear();
}
