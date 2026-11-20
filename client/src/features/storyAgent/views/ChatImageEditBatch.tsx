import { collectKeyframeReview } from "../keyframeReview";
import { storySpineStore } from "../spine/storySpine";
import { useEffect, useRef, useState } from 'react';
import type { ImageEditBatch } from '../../../../../server/services/chatImageEditBatch';
import { formatComputeQuote } from '@shared/computeMoney';
import { trpc } from '@/lib/trpc';
import { runChatImageEditBatch } from '../runChatImageEditBatch';
import { ChatImageReferenceChip } from './ChatImageReferenceChip';
import { imageEditPurchaseError, type ImageEditPurchase } from '../imageEditPurchase';

type Props = { storyId: number; planMessageId: string; disabled?: boolean;
  purchase?: ImageEditPurchase; onPurchaseConsumed?: () => void;
  onBusyChange: (busy: boolean) => void;
  onSelect: (image: { storyId: number; stableShotId: string; shotNo: number; imageId: number; imageUrl: string }) => void };

// A confirmed chat message is saved asynchronously. Retry only this read race,
// never a purchase, authorization failure or an unknown provider result.
export const imageEditBatchQueryOptions = {
  retry: (failureCount: number, error: { message: string }) => failureCount < 3 && error.message === '修改要求尚未保存，请先确认要求。',
  retryDelay: (attempt: number) => (attempt + 1) * 500,
  refetchOnWindowFocus: false,
};

export function ChatImageEditBatchView({ batch, busy, disabled, error, onConfirm, onRecover, onSelect }: {
  batch: ImageEditBatch; busy: boolean; disabled?: boolean; error?: string | null;
  onConfirm: () => void; onRecover: () => void; onSelect: Props['onSelect'];
}) {
  const ready = batch.items.filter(item => item.status === 'ready');
  const done = batch.items.filter(item => item.status === 'done');
  const blocked = batch.items.some(item => !['done', 'ready'].includes(item.status));
  const reference = (image: { imageId: number; imageUrl: string }) =>
    onSelect({ ...image, storyId: batch.storyId, stableShotId: batch.stableShotId, shotNo: batch.shotNo });
  const unit = batch.renderRoute === 'storyboard' ? '组' : '张';
  const labels = { ready: '待生成', pending: '正在生成', unknown: '等待回执', failed: '未完成', done: '已完成' };
  return <section aria-label="本批图片进度" className="space-y-1.5 text-xs">
    <p role="status">同批 {batch.items.length} {unit} · 已完成 {done.length}/{batch.items.length}{busy ? ' · 正在处理，请稍候' : ''}</p>
    <div className="grid grid-cols-2 gap-2">{batch.items.map(item => <div key={item.requestId} className="min-w-0 space-y-1 break-words text-[11px]" aria-label={`原图 #${item.imageId} 第${item.copy}张`}>
      <ChatImageReferenceChip imageId={item.result?.imageId ?? item.imageId} imageUrl={item.result?.imageUrl ?? item.imageUrl} onReference={() => reference(item.result ?? item)} />
      <p>#{item.imageId} · {labels[item.status]}{item.result ? ` → #${item.result.imageId}` : ''}</p>
      {item.result && <button type="button" className="underline" onClick={() => onSelect({ storyId: batch.storyId, stableShotId: batch.stableShotId, shotNo: batch.shotNo, ...item.result! })}>继续修改</button>}
      {item.candidates?.filter(candidate => candidate.imageId !== item.result?.imageId).map(candidate =>
        <div key={candidate.imageId}><ChatImageReferenceChip {...candidate} onReference={() => reference(candidate)} />
          <button type="button" className="underline" onClick={() => onSelect({ storyId: batch.storyId, stableShotId: batch.stableShotId, shotNo: batch.shotNo, ...candidate })}>继续修改 #{candidate.imageId}</button></div>)}
      {item.error && <p className="max-w-60 text-muted-foreground">{item.error}</p>}
    </div>)}</div>
    {ready.length > 0 && <p>剩余 {ready.length} {unit}，预计合计 {formatComputeQuote(batch.remainingEstimatedCny)}。{done.length > 0 ? '已完成图片直接复用。' : '一次确认，分别修改。'}</p>}
    {!busy && !blocked && ready.length > 0 && <button type="button" disabled={disabled} className="rounded bg-primary px-2 py-1 text-primary-foreground disabled:opacity-40" onClick={onConfirm}>确认费用并生成剩余 {ready.length} {unit}</button>}
    {!busy && blocked && <button type="button" className="underline" onClick={onRecover}>刷新原任务（不重新购买）</button>}
    <p className="text-muted-foreground">结果存入仓库，未替换剪辑。实际扣费以结算回执为准。</p>
    {error && <p role="alert">{error}</p>}
  </section>;
}

export function ChatImageEditBatch(props: Props) {
  const { storyId, planMessageId } = props;
  const input = { storyId, planMessageId };
  const utils = trpc.useUtils();
  const query = trpc.storyAgent.chatImageEditBatch.useQuery(input, imageEditBatchQueryOptions);
  useEffect(() => {
    const batch = query.data, state = storySpineStore.getState();
    if (!batch || state.activeStoryId !== batch.storyId) return;
    const rows = collectKeyframeReview(state.messages, batch, Date.now());
    if (rows !== state.messages) state.setMessages(rows);
  }, [query.data, props.planMessageId]);
  const generate = trpc.storyAgent.generateForMobile.useMutation();
  const recover = trpc.storyAgent.recoverStoryboardImage.useMutation();
  const running = useRef(false);
  const alive = useRef(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; props.onBusyChange(false); }; }, []);
  const run = async (purchase: boolean, approval?: ImageEditPurchase) => {
    if (running.current || !query.data || (purchase && props.disabled)) return;
    if (approval) {
      const mismatch = imageEditPurchaseError(approval, query.data);
      if (mismatch) { setError(mismatch); return; }
    }
    running.current = true; setBusy(true); setError(null); props.onBusyChange(true);
    const refresh = () => utils.client.storyAgent.chatImageEditBatch.query(input);
    try {
      await runChatImageEditBatch(query.data, {
        active: () => alive.current,
        submit: item => generate.mutateAsync({ storyId, imageEditPlanOutput: { planMessageId, imageId: item.imageId, copy: item.copy },
          costConfirmation: { accepted: true, estimatedCny: query.data!.unitEstimatedCny } }),
        recover: requestId => recover.mutateAsync({ storyId, requestId }),
        read: refresh,
        update: data => {
          utils.storyAgent.chatImageEditBatch.setData(input, data);
          void utils.storyAgent.storyMaterialState.invalidate({ storyId });
          void utils.storyAgent.chatImageRevisions.invalidate({ storyId });
        },
        wait: () => new Promise(resolve => setTimeout(resolve, 2000)),
      }, purchase);
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : '任务状态暂未确认，请刷新原任务，不要重复购买。');
    } finally {
      running.current = false;
      if (alive.current) { setBusy(false); props.onBusyChange(false); void query.refetch(); }
    }
  };
  // Reopening the chat resumes receipts only; payment permission stays in the click.
  const recoveredOnMount = useRef(false);
  const consumedPurchase = useRef(false);
  useEffect(() => {
    if (!props.purchase || consumedPurchase.current || query.isFetching || (!query.data && !query.error)) return;
    consumedPurchase.current = true;
    recoveredOnMount.current = true;
    props.onPurchaseConsumed?.();
    if (query.error) { setError('修改要求未能保存，未开始生成。请重新读取后核对。'); return; }
    if (props.disabled) { setError('当前还有其他操作，请核对报价后再生成。'); return; }
    void run(true, props.purchase);
  }, [props.purchase, query.data, query.error, query.isFetching, props.disabled]);
  useEffect(() => {
    if (!query.data || props.purchase || recoveredOnMount.current) return;
    recoveredOnMount.current = true;
    if (query.data.items.some(item => item.recoverable && !['done', 'failed'].includes(item.status))) void run(false);
  }, [query.data]);
  if (!query.data) return <div role="status" className="text-xs">{error ?? query.error?.message ?? (props.purchase ? '正在保存要求，随后开始生成…' : '正在读取修改要求和报价…')}{query.error && <button type="button" className="ml-2 underline" onClick={() => void query.refetch()}>重新读取</button>}</div>;
  return <ChatImageEditBatchView batch={query.data} busy={busy || Boolean(props.purchase && !consumedPurchase.current)} disabled={props.disabled} error={error}
    onConfirm={() => void run(true)} onRecover={() => void run(false)} onSelect={props.onSelect} />;
}
