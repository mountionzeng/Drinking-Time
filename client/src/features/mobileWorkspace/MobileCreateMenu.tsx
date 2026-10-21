import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { StudioCreateMenu, type StudioCreateRequest } from "@/features/publishingDraft/StudioCreateMenu";
import { saveStudioCreateHandoff, clearStudioCreateHandoff } from "@/features/publishingDraft/studioCreateHandoff";
import { MobileImageStudio } from "./MobileImageStudio";

export function MobileCreateMenu({ userId, storyId, instruction, blocked }: {
  userId: number; storyId: number; instruction: string; blocked: boolean;
}) {
  const [request, setRequest] = useState<StudioCreateRequest | null>(null);
  const [error, setError] = useState("");
  const materials = trpc.storyAgent.storyMaterialState.useQuery({ storyId }, { retry: false });
  function create(next: StudioCreateRequest) {
    setError("");
    if (next.kind === "image" || next.kind === "layout") {
      setRequest(next);
      return;
    }
    try {
      // A same-origin new tab copies session storage, preserving the mobile chat
      // and keeping private instructions out of URLs and persistent local storage.
      const url = saveStudioCreateHandoff(sessionStorage, userId, next);
      const tab = window.open(url, "_blank");
      if (!tab) throw new Error("浏览器阻止了制作窗口，请允许打开新标签页后重试。");
      clearStudioCreateHandoff(sessionStorage, next.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "制作窗口未打开，请重试。");
    }
  }
  return <>
    <StudioCreateMenu storyId={storyId} input={instruction} blocked={blocked}
      hasShots={Boolean(materials.data?.shots.length)} onCreate={create} />
    {materials.isError && <button type="button" className="px-2 text-xs text-destructive" onClick={() => void materials.refetch()}>重新读取制作素材</button>}
    {error && <p role="alert" className="text-left text-xs text-destructive">{error}</p>}
    <Dialog open={Boolean(request)} onOpenChange={open => { if (!open) setRequest(null); }}>
      <DialogContent className="flex h-[94dvh] w-[calc(100%-1rem)] max-w-xl flex-col overflow-hidden p-0">
        <DialogHeader className="sr-only"><DialogTitle>基于当前故事制作图文</DialogTitle><DialogDescription>使用已保存正文；生成图片前确认要求与费用。</DialogDescription></DialogHeader>
        {request && <MobileImageStudio key={request.id} userId={userId} storyId={storyId}
          createRequest={request} onBack={() => setRequest(null)} />}
      </DialogContent>
    </Dialog>
  </>;
}
