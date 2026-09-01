import React from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { MobileWorkspace } from "@/features/mobileWorkspace/MobileWorkspace";

export default function MobileWorkspacePage() {
  const { user } = useAuth();
  if (!user) return null;
  return <MobileWorkspace userId={user.id} />;
}
