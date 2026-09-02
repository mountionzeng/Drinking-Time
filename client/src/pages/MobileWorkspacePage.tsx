import React, { useEffect, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { MobileWorkspace } from "@/features/mobileWorkspace/MobileWorkspace";
import { reconcileMobileRecoveryOwner } from "@/features/mobileWorkspace/mobileRecoveryIdentity";

export default function MobileWorkspacePage() {
  const { user } = useAuth();
  const [readyUserId, setReadyUserId] = useState<number | null>(null);

  useEffect(() => {
    if (!user) {
      setReadyUserId(null);
      return;
    }
    try {
      reconcileMobileRecoveryOwner(window.localStorage, user.id);
    } catch {
      // The workspace still works without browser-side recovery storage.
    }
    setReadyUserId(user.id);
  }, [user]);

  if (!user || readyUserId !== user.id) return null;
  return <MobileWorkspace userId={user.id} />;
}
