import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { useEffect } from "react";

const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_DEDUP_MS = 25_000;
const NEW_VISIT_AFTER_MS = 30 * 60_000;

type StoredVisit = {
  visitId: string;
  lastHeartbeatAt: number;
};

function createVisitId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function parseStoredVisit(raw: string | null): StoredVisit | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredVisit>;
    if (
      typeof value.visitId !== "string" ||
      value.visitId.length < 8 ||
      typeof value.lastHeartbeatAt !== "number"
    ) {
      return null;
    }
    return {
      visitId: value.visitId,
      lastHeartbeatAt: value.lastHeartbeatAt,
    };
  } catch {
    return null;
  }
}

function resolveVisit(storageKey: string, currentTime: number) {
  const previous = parseStoredVisit(localStorage.getItem(storageKey));
  if (
    previous &&
    currentTime - previous.lastHeartbeatAt <= NEW_VISIT_AFTER_MS
  ) {
    return previous;
  }
  return {
    visitId: createVisitId(),
    lastHeartbeatAt: 0,
  };
}

export default function AccessTracker() {
  const { user, isAuthenticated } = useAuth();
  const { mutate: sendAccessHeartbeat } =
    trpc.accessAnalytics.heartbeat.useMutation();

  useEffect(() => {
    if (
      !isAuthenticated ||
      !user ||
      user.loginMethod === "guest" ||
      typeof window === "undefined"
    ) {
      return;
    }

    const siteHost = window.location.hostname.toLowerCase();
    const storageKey = `dt:access-visit:${user.id}:${siteHost}`;

    const sendHeartbeat = (force = false) => {
      if (document.visibilityState !== "visible") return;
      const currentTime = Date.now();
      const visit = resolveVisit(storageKey, currentTime);
      if (
        !force &&
        currentTime - visit.lastHeartbeatAt < HEARTBEAT_DEDUP_MS
      ) {
        return;
      }
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          visitId: visit.visitId,
          lastHeartbeatAt: currentTime,
        } satisfies StoredVisit)
      );
      sendAccessHeartbeat({
        visitId: visit.visitId,
        siteHost,
      });
    };

    sendHeartbeat(true);
    const intervalId = window.setInterval(
      () => sendHeartbeat(),
      HEARTBEAT_INTERVAL_MS
    );
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") sendHeartbeat();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [
    isAuthenticated,
    sendAccessHeartbeat,
    user?.id,
    user?.loginMethod,
  ]);

  return null;
}
