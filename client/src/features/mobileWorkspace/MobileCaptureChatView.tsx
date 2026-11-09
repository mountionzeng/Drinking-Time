import React, { createContext, useContext, useState } from "react";
import { MobileChatView } from "./MobileChatView";
import { useMaterialCapture } from "./useMaterialCapture";
import { CaptureShareSetup } from "./CaptureShareSetup";

const CaptureContext = createContext<ReturnType<typeof useMaterialCapture> | null>(null);
/** Secondary collection actions live inside the existing more menu. */
export function MobileCaptureMoreActions({disabled=false}:{disabled?:boolean}) {
  const capture = useContext(CaptureContext);
  const [showShare,setShowShare] = useState(false);
  if (!capture) return null;
  const blocked = disabled || capture.busy || capture.locked || capture.recording;
  return <div>
    <div className="flex flex-wrap gap-4">
      {capture.active && <button type="button" className="min-h-11 text-xs text-primary disabled:opacity-40" disabled={blocked} onClick={capture.cancel}>返回聊天</button>}
      <button type="button" className="min-h-11 text-xs text-primary disabled:opacity-40" disabled={blocked} aria-expanded={showShare} onClick={() => setShowShare(value=>!value)}>从其他 App 发送</button>
    </div>
    {showShare && <CaptureShareSetup userId={capture.userId} />}
  </div>;
}
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
