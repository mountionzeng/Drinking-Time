import { createContext } from "react";

// Only the mounted story home may enable unsolicited companion gestures.
export const MobileCompanionActivity = createContext<(active: boolean) => void>(
  () => {}
);
