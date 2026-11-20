import { useRef, useState, type ComponentProps } from "react";
import { trpc } from "@/lib/trpc";
import { ChatImageEditPlanCard } from "./ChatImageEditPlanCard";

type Receipt = { id: string; text: string; timestamp: number };
type Props = ComponentProps<typeof ChatImageEditPlanCard> & { storyId?: number | null; planId?: string; onErased?: (receipt: Receipt) => void };
export function SourceReviewedPlanCard({storyId,planId,onErased,...props}:Props) {
  const eligible = Boolean(planId?.startsWith("region-scan:") && props.plan.regionScanSourceId && props.plan.status === "draft" && storyId && onErased);
  const [preferLocal, setPreferLocal] = useState(!props.plan.renderRoute && /移除|去掉|擦掉|不想要|remove|erase/i.test(props.plan.changes));
  const local = eligible && preferLocal;
  const mutation = trpc.storyAgent.visualUnderstanding.eraseKeyframes.useMutation();
  const utils = trpc.useUtils();
  const pending = useRef(false);
  const erase = async () => {
    if (!storyId || !planId || !local || pending.current || props.disabled) return;
    const targets = props.plan.images.flatMap(image => image.role === "target" && image.region ? [{ imageId: image.imageId, region: image.region }] : []);
    if (!targets.length) return;
    pending.current = true;
    try {
      const receipt = await mutation.mutateAsync({ storyId, planId, targets });
      onErased?.(receipt);
      await Promise.all([utils.storyAgent.storyImages.invalidate({storyId}), utils.storyAgent.storyMaterialState.invalidate({storyId})]);
    } catch { /* The mutation exposes its error on the same card. The selected route stays local. */ }
    finally { pending.current = false; }
  };
  const imageIds = props.plan.images.filter(i=>i.role!=="omit").map(i=>i.imageId);
  const draft = props.plan.status==="draft" && Boolean(storyId) && imageIds.length>0;
  const read = trpc.storyAgent.visualUnderstanding.sourceFrames.useQuery({storyId:storyId ?? 0,imageIds},
    {enabled:draft && !local,staleTime:60_000,retry:false,refetchOnWindowFocus:false});
  const ready = !draft || (!read.error && read.data?.length===imageIds.length);
  const sourceReview = !draft ? null : read.error ? <p role="alert">原图读取失败。{read.error.message} <button type="button" onClick={()=>void read.refetch()}>重新读图</button></p>
    : !ready ? <p role="status">正在读取原图，核对明暗和交界…</p> :
      <details><summary className="cursor-pointer">已读取 {imageIds.length} 张原图 · 查看画面依据</summary>
        {read.data?.map(row=><p key={row.imageId}>#{row.imageId} · {props.plan.images.find(i=>i.imageId===row.imageId)?.role==="reference"?"参考":"原图"} · {row.summary}</p>)}
      </details>;
  // Only the submit action waits. The draft stays editable and unreadable sources can be removed.
  return <ChatImageEditPlanCard {...props} sourceReview={local ? null : sourceReview} sourceReady={ready}
    disabled={props.disabled || mutation.isPending}
    localErase={eligible ? { selected: local, select: setPreferLocal, run: erase, pending: mutation.isPending, error: mutation.error?.message } : undefined}/>;
}
