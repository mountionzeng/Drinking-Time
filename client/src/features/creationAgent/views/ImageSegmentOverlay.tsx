/**
 * ImageSegmentOverlay — Point-and-click object editing overlay.
 *
 * User clicks a point on the image → SAM 2 segments the object →
 * mask overlay is displayed → user enters a prompt → inpaint replaces
 * the region → new image version is saved.
 */
import { useState, useRef, useCallback } from 'react';
import { Loader2, X, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { trpc } from '@/lib/trpc';
import { useCreationAgent } from '../CreationAgentContext';

interface ImageSegmentOverlayProps {
  imageUrl: string;
  imageId: number;
  shotNo: string;
  projectId: number;
  onClose: () => void;
}

type Phase = 'idle' | 'segmenting' | 'masked' | 'prompting' | 'inpainting';

export default function ImageSegmentOverlay({
  imageUrl,
  imageId,
  shotNo,
  projectId,
  onClose,
}: ImageSegmentOverlayProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [maskUrl, setMaskUrl] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const imgRef = useRef<HTMLImageElement>(null);
  const { refreshProjectAssets } = useCreationAgent();

  const segmentMut = trpc.creationAgent.segment.useMutation();
  const inpaintMut = trpc.creationAgent.inpaint.useMutation();

  const handleClick = useCallback(async (e: React.MouseEvent<HTMLImageElement>) => {
    if (phase !== 'idle' && phase !== 'masked') return;
    const img = imgRef.current;
    if (!img) return;

    const rect = img.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    setPhase('segmenting');
    setMaskUrl(null);

    try {
      const result = await segmentMut.mutateAsync({ imageUrl, x, y });
      if (result.status === 'error') {
        toast.error(result.message ?? '分割失败');
        setPhase('idle');
        return;
      }
      if (!result.maskUrl) {
        toast.info('该区域无法识别物体，请点选其他位置');
        setPhase('idle');
        return;
      }
      setMaskUrl(result.maskUrl);
      setPhase('masked');
    } catch {
      toast.error('分割服务异常');
      setPhase('idle');
    }
  }, [phase, imageUrl, segmentMut]);

  const handleInpaint = useCallback(async () => {
    if (!maskUrl || !prompt.trim()) return;
    setPhase('inpainting');

    try {
      const result = await inpaintMut.mutateAsync({
        imageUrl,
        maskUrl,
        prompt: prompt.trim(),
        shotNo,
        projectId,
        parentImageId: imageId,
      });

      if (result.status === 'error') {
        toast.error(result.message ?? '重绘失败');
        setPhase('masked');
        return;
      }

      toast.success('重绘完成');
      refreshProjectAssets();
      onClose();
    } catch {
      toast.error('重绘服务异常');
      setPhase('masked');
    }
  }, [maskUrl, prompt, imageUrl, shotNo, projectId, imageId, inpaintMut, refreshProjectAssets, onClose]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleInpaint();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="relative bg-background rounded-xl shadow-2xl max-w-2xl w-full overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b">
          <span className="text-sm font-medium">
            {phase === 'idle' && '点击图片上的物体来选择编辑区域'}
            {phase === 'segmenting' && '正在识别...'}
            {phase === 'masked' && '已选中区域，输入修改描述'}
            {phase === 'prompting' && '输入修改描述'}
            {phase === 'inpainting' && '正在重绘...'}
          </span>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7">
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Image + Overlay */}
        <div className="relative">
          <img
            ref={imgRef}
            src={imageUrl}
            alt={`${shotNo} editing`}
            className={`w-full cursor-crosshair ${phase === 'segmenting' || phase === 'inpainting' ? 'opacity-50' : ''}`}
            onClick={handleClick}
          />
          {/* Mask overlay */}
          {maskUrl && phase !== 'inpainting' && (
            <img
              src={maskUrl}
              alt="mask overlay"
              className="absolute inset-0 w-full h-full object-cover pointer-events-none mix-blend-multiply opacity-50"
              style={{ filter: 'hue-rotate(180deg) saturate(3)' }}
            />
          )}
          {/* Loading spinner overlay */}
          {(phase === 'segmenting' || phase === 'inpainting') && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          )}
        </div>

        {/* Prompt input (visible when mask is ready) */}
        {(phase === 'masked' || phase === 'prompting') && (
          <div className="px-4 py-3 border-t flex gap-2 items-end">
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="描述你想要的改动，例如：换成旧木椅"
              className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              autoFocus
            />
            <Button
              size="sm"
              onClick={handleInpaint}
              disabled={!prompt.trim()}
            >
              <Check className="w-4 h-4 mr-1" />
              重绘
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
