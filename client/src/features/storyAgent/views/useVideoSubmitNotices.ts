import { useCallback, useEffect, useState } from "react";
import { useStorySpine } from "../spine/storySpine";
import { readVideoSubmitNotices, updateVideoSubmitNotices } from "./videoSubmitNotice";

function storage() {
  try { return window.sessionStorage; } catch { return null; }
}

export function useVideoSubmitNotices() {
  const accountId = useStorySpine(state => state.accountId);
  const [state, setState] = useState(() => ({ accountId, notices: readVideoSubmitNotices(accountId, storage()) }));
  useEffect(() => {
    setState({ accountId, notices: readVideoSubmitNotices(accountId, storage()) });
  }, [accountId]);
  const recordVideoSubmitNotice = useCallback((key: string, message: string | null) => {
    setState(current => {
      const sameAccount = current.accountId === accountId;
      const notices = updateVideoSubmitNotices(sameAccount ? current.notices : readVideoSubmitNotices(accountId, storage()), key, message, accountId, storage());
      // A late response belongs to the account that submitted it, never its successor.
      return sameAccount ? { accountId, notices } : current;
    });
  }, [accountId]);
  return { videoSubmitNotices: state.accountId === accountId ? state.notices : [], recordVideoSubmitNotice };
}
