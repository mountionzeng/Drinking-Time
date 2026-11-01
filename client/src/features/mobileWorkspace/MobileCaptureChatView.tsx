import React, { createContext, useContext, useState } from "react";
import { MobileChatView } from "./MobileChatView";
import { useMaterialCapture } from "./useMaterialCapture";

const CaptureContext = createContext<ReturnType<typeof useMaterialCapture> | null>(null);
export function MobileCaptureProvider({userId,children}:React.PropsWithChildren<{userId:number}>) {
  const capture=useMaterialCapture(userId);
  return <CaptureContext.Provider value={capture}>{children}</CaptureContext.Provider>;
}
/** A single account-scoped collector, independent of ordinary conversation drafts. */
export function MobileCaptureChatView({userId,...props}:React.ComponentProps<typeof MobileChatView> & {userId:number}) {
  const capture=useContext(CaptureContext);
  const [local,setLocal] = useState("");
  const draft = props.draftValue ?? local, setDraft = props.onDraftChange ?? setLocal;
  if(!capture || capture.userId!==userId)return <MobileChatView {...props}/>;
  return <MobileChatView {...props} draftValue={capture.active?capture.text:draft} onDraftChange={capture.active?capture.setText:setDraft} capture={{...capture,activate:()=>{capture.activate(draft);if(capture.ready&&!capture.hasDraft&&!capture.busy)setDraft("");}}}/>;
}
