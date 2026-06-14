/**
 * DrawThisMomentPanel — 桌面「把这一刻画出来」单图流。
 *
 * 与手机端 MobileChat 的 generateNow 同一条路径：复用 storyAgent.generateForMobile
 * （服务端按最近对话现编 prompt，draft → final）+ recordSignal（右划收下 / 左划再来）。
 * 出一张 → 满意「收下」/ 不满意「再来一张」→ 直到满意。故事已在故事页对齐，无需手动选。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { trpc } from '@/lib/trpc';
import { useStoryAgent } from '@/features/storyAgent/StoryAgentContext';

type DrawnImage = {
  imageId: number;
  imageUrl: string;
  prompt: string;
  mode: 'draft' | 'final';
};

export default function DrawThisMomentPanel({ onDone }: { onDone?: () => void }) {
  const { activeStoryId, messages } = useStoryAgent();
  const generateMut = trpc.storyAgent.generateForMobile.useMutation();
  const signalMut = trpc.storyAgent.recordSignal.useMutation();

  const [image, setImage] = useState<DrawnImage | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  const recentHistory = useCallback(
    () =>
      messages
        .filter((m) => m.content?.trim())
        .slice(-16)
        .map((m) => ({ role: m.role, content: m.content })),
    [messages],
  );

  // 出一张：rejectImageId 存在=先记 swipe_left（淘汰上一张）再出下一张。失败不清空已有图。
  const draw = useCallback(
    async (rejectImageId?: number) => {
      if (activeStoryId == null) {
        setError('请先在故事页打开一个故事');
        return;
      }
      setError(null);
      setIsGenerating(true);
      try {
        if (rejectImageId != null) {
          await signalMut.mutateAsync({
            storyId: activeStoryId,
            imageId: rejectImageId,
            action: 'swipe_left',
          });
        }
        const result = await generateMut.mutateAsync({
          storyId: activeStoryId,
          history: recentHistory(),
          mode: 'draft',
        });
        if (result.status === 'ok' && result.imageUrl) {
          setImage({
            imageId: result.imageId!,
            imageUrl: result.imageUrl,
            prompt: result.prompt ?? '',
            mode: result.mode === 'draft' ? 'draft' : 'final',
          });
        } else {
          setError('出图服务暂时不可用，稍后再试');
        }
      } catch {
        setError('出图服务暂时不可用，稍后再试');
      } finally {
        setIsGenerating(false);
      }
    },
    [activeStoryId, recentHistory, generateMut, signalMut],
  );

  // 进面板即自动出第一张
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void draw();
  }, [draw]);

  // 收下：记 swipe_right → 该图成为该故事主图（imageAssets 投影）。
  const accept = useCallback(async () => {
    if (!image || activeStoryId == null) return;
    try {
      await signalMut.mutateAsync({
        storyId: activeStoryId,
        imageId: image.imageId,
        action: 'swipe_right',
        metadata: { source: 'draw-this-moment' },
      });
      toast.success('已收下，成为这个故事的画面');
      onDone?.();
    } catch {
      toast.error('收下失败，稍后再试');
    }
  }, [image, activeStoryId, signalMut, onDone]);

  // 出正式版：draft → final（Midjourney 精画），关联草稿 parentImageId。
  const promoteToFinal = useCallback(async () => {
    if (!image || activeStoryId == null || image.mode !== 'draft') return;
    setError(null);
    setIsGenerating(true);
    try {
      const result = await generateMut.mutateAsync({
        storyId: activeStoryId,
        history: recentHistory(),
        mode: 'final',
        draftImageId: image.imageId,
      });
      if (result.status === 'ok' && result.imageUrl) {
        setImage({
          imageId: result.imageId!,
          imageUrl: result.imageUrl,
          prompt: result.prompt ?? image.prompt,
          mode: 'final',
        });
      } else {
        setError('出正式版失败，草稿还在，稍后再试');
      }
    } catch {
      setError('出正式版失败，草稿还在，稍后再试');
    } finally {
      setIsGenerating(false);
    }
  }, [image, activeStoryId, recentHistory, generateMut]);

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="relative flex min-h-[320px] items-center justify-center overflow-hidden rounded-lg border bg-muted/30">
        {isGenerating ? (
          <div className="flex animate-pulse flex-col items-center gap-3 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin" />
            <p className="text-xs">正在把这一刻画出来…</p>
          </div>
        ) : error && !image ? (
          <div className="flex flex-col items-center gap-3 p-4 text-center">
            <AlertTriangle className="h-8 w-8 text-rose-500" />
            <p className="max-w-[280px] text-xs text-muted-foreground">{error}</p>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void draw()}>
              <RefreshCw className="h-3.5 w-3.5" />
              重试
            </Button>
          </div>
        ) : image ? (
          <>
            <img
              src={image.imageUrl}
              alt={image.prompt || '这一刻'}
              className="max-h-[440px] w-full object-contain"
            />
            <span className="absolute left-2 top-2 rounded border border-white/30 bg-black/50 px-1.5 py-0.5 text-[10px] text-white">
              {image.mode === 'draft' ? '草稿小样' : '正式版'}
            </span>
            {error ? (
              <div className="absolute inset-x-0 top-0 flex items-center gap-2 bg-rose-600/90 px-3 py-1.5 text-[11px] text-white">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{error}</span>
              </div>
            ) : null}
          </>
        ) : null}
      </div>

      {image && !isGenerating ? (
        <p className="line-clamp-2 text-[11px] text-muted-foreground">{image.prompt}</p>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          variant="outline"
          className="gap-1.5"
          disabled={isGenerating || !image}
          onClick={() => void draw(image?.imageId)}
        >
          <RefreshCw className="h-4 w-4" />
          再来一张
        </Button>
        {image?.mode === 'draft' ? (
          <Button
            variant="outline"
            className="gap-1.5"
            disabled={isGenerating}
            onClick={() => void promoteToFinal()}
          >
            <Sparkles className="h-4 w-4" />
            出正式版
          </Button>
        ) : null}
        <Button className="gap-1.5" disabled={isGenerating || !image} onClick={() => void accept()}>
          <Check className="h-4 w-4" />
          收下
        </Button>
      </div>
    </div>
  );
}
