import { useEffect, useRef } from "react";
import { storySpineStore } from "@/features/storyAgent/spine/storySpine";
import { useDesktopWritingSession } from "./desktopWritingSession";
import type { WritingCompanionSnapshot } from "./writingCompanionText";

type Props = {
  storyId: number;
  getSnapshot: () => WritingCompanionSnapshot;
};

/** The visible editor is the context of the existing chat; registering it makes no request. */
export function DesktopWritingContext(props: Props) {
  const latest = useRef(props);
  latest.current = props;
  const owner = useRef(crypto.randomUUID());
  const sync = () => {
    const snapshot = latest.current.getSnapshot();
    const current = useDesktopWritingSession.getState().session;
    const spine = storySpineStore.getState();
    if (
      current?.id === owner.current &&
      current.storyId === latest.current.storyId &&
      current.accountId === spine.accountId &&
      current.epoch === spine.storyScopeEpoch &&
      current.snapshot.draft === snapshot.draft &&
      current.snapshot.scope === snapshot.scope &&
      current.snapshot.cursor === snapshot.cursor &&
      current.snapshot.selection?.start === snapshot.selection?.start &&
      current.snapshot.selection?.end === snapshot.selection?.end
    )
      return;
    useDesktopWritingSession.getState().setSession({
      id: owner.current,
      storyId: latest.current.storyId,
      accountId: spine.accountId,
      epoch: spine.storyScopeEpoch,
      snapshot,
      getSnapshot: () => latest.current.getSnapshot(),
    });
  };
  useEffect(sync);
  useEffect(() => {
    const handleSelection = () => sync();
    window.addEventListener("dt:writing-selection-change", handleSelection);
    return () => {
      window.removeEventListener(
        "dt:writing-selection-change",
        handleSelection
      );
      if (useDesktopWritingSession.getState().session?.id === owner.current) {
        useDesktopWritingSession.getState().setSession(null);
      }
    };
  }, []);
  return null;
}
