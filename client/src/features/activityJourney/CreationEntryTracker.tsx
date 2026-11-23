import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { signalActivity } from "./activityJourney";

export default function CreationEntryTracker() {
  const [path] = useLocation();
  const { user, isAuthenticated } = useAuth();
  const isCreation = /^\/(editing|creation|m|stories)(\/|$)/.test(path);
  useEffect(() => {
    if (isCreation && isAuthenticated && user?.id) {
      signalActivity({ eventName: "creation.entered" });
    }
  }, [isCreation, isAuthenticated, user?.id]);
  return null;
}
