/**
 * DrawThisMomentPanel — 桌面「把这一刻画出来」单图流。
 *
 * 与手机端 MobileChat 的 generateNow 同一条路径：复用 storyAgent.generateForMobile
 * （服务端按最近对话现编 prompt，draft → final）+ recordSignal（右划收下 / 左划再来）。
 * 出一张 → 满意「收下」/ 不满意「再来一张」→ 直到满意。故事已在故事页对齐，无需手动选。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, Link2, Loader2, Palette, RefreshCw, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { trpc } from '@/lib/trpc';
import { useStoryAgent } from '@/features/storyAgent/StoryAgentContext';

type DrawnImage = {
  imageId: number;
  imageUrl: string;
  prompt: string;
  mode: 'draft' | 'final';
};

// 风格锁：用户手动选定后，每次生成稳定附加英文风格词，避免画风漂移。
const STYLE_OPTIONS: { value: string; label: string; styleHint: string }[] = [
  { value: 'oil', label: '油画', styleHint: 'oil painting, impressionist style, rich textured brushwork, warm cinematic tones' },
  { value: 'watercolor', label: '水彩', styleHint: 'watercolor illustration, soft delicate washes, gentle atmosphere' },
  { value: 'sketch', label: '素描', styleHint: 'pencil sketch, fine detailed linework, monochrome shading' },
  { value: 'digital', label: '数字插画', styleHint: 'digital illustration, concept art, vibrant cinematic lighting' },
  { value: 'flat', label: '扁平插画', styleHint: 'flat modern illustration, clean vector shapes, warm palette' },
];

// 反馈维度 → 再生成时给模型的明确调整指令（图生图时「只改这些，其他保持」）。
const DIMENSION_INSTRUCTIONS: Record<string, string> = {
  color: '调整色彩和色调',
  pose: '调整人物的动作和姿态',
  composition: '调整构图和镜头角度',
  lighting: '调整光线和光源',
  style: '调整艺术风格',
};

// 把选中镜头卡片的内容拼成「画面主体」提示，传给后端做 prompt 的核心来源。
// 这是「画对镜头内容」的关键——不再让 LLM 从对话历史瞎猜。
function buildCardHint(card: { title?: string; content?: string; sensoryDetails?: string[]; emotion?: string } | undefined): string {
  if (!card) return '';
  const parts: string[] = [];
  if (card.content?.trim()) parts.push(card.content.trim());
  if (card.title?.trim() && card.title.trim() !== card.content?.trim()) parts.push(card.title.trim());
  if (card.sensoryDetails?.length) parts.push(`感官细节：${card.sensoryDetails.join('、')}`);
  if (card.emotion?.trim()) parts.push(`情绪：${card.emotion.trim()}`);
  return parts.join('；');
}

export default function DrawThisMomentPanel({ onDone }: { onDone?: () => void }) {
  const { activeStoryId, messages, cards, addStoryImage, visualCanvasItems } = useStoryAgent();
  const generateMut = trpc.storyAgent.generateForMobile.useMutation();
  const signalMut = trpc.storyAgent.recordSignal.useMutation();

  const [image, setImage] = useState<DrawnImage | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);
  const [artFeatures, setArtFeatures] = useState<string>('');
  // 用户手动锁定的画风（默认油画）。锁定后每次生成稳定附加，不漂移。
  const [lockedStyle, setLockedStyle] = useState<string>('oil');
  const [showFeedbackDimensions, setShowFeedbackDimensions] = useState(false);
  const [selectedFeedbackDimensions, setSelectedFeedbackDimensions] = useState<string[]>([]);

  // 绑定目标：图收下后落到哪张卡片（镜头）。shotNo = 卡片序号(1-based)，默认绑当前(最后)一张卡。
  // buildMobileStoryboardScenes 按 scene.shotNo === image.shotNo 精确归位，不再兜底填空卡。
  const cardOptions = useMemo(
    () => cards.map((card, index) => ({ shotNo: index + 1, title: card.title || `卡片 ${index + 1}` })),
    [cards],
  );
  const [targetShotNo, setTargetShotNo] = useState<number>(() => Math.max(1, cards.length));
  // 卡片数量变化时把目标夹在合法范围内
  useEffect(() => {
    setTargetShotNo((prev) => Math.min(Math.max(1, prev), Math.max(1, cards.length)));
  }, [cards.length]);

  const recentHistory = useCallback(
    () =>
      messages
        .filter((m) => m.content?.trim())
        .slice(-16)
        .map((m) => ({ role: m.role, content: m.content })),
    [messages],
  );

  // 出一张：rejectImageId 存在=先记 swipe_left（淘汰上一张）再出下一张。失败不清空已有图。
  //
  // 分层架构（修复内容/风格/一致性）：
  //   ① 镜头内容(cardHint) → 画面主体，从选中卡片取，不再让 LLM 从对话瞎猜
  //   ② 锁定画风(styleHint) → 稳定附加，不漂移
  //   ③ 再来一张 → 图生图(originalImageUrl=上一张)严格延续人物/构图/风格，只改勾选维度
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

        // ① 镜头内容：选中卡片的具体内容作为画面主体
        const selectedCard = cards[targetShotNo - 1];
        let cardHint = buildCardHint(selectedCard);

        // 当前镜头关联的用户照片（故事材料）——这是「生成图要和我拍的照片相关」的关键。
        // 用户在镜头卡片上传的 reference 照片，作为图生图基底锚定真实画面。
        const cardPhoto = selectedCard
          ? visualCanvasItems.find(
              (it) => it.cardId === selectedCard.id && it.source === 'reference',
            )?.imageUrl
          : undefined;

        // ③ 再来一张：图生图严格延续。把勾选的不满意维度转成「只改这些」的明确指令。
        const isRegen = rejectImageId != null && image != null;
        if (isRegen) {
          const instructions = selectedFeedbackDimensions
            .map((d) => DIMENSION_INSTRUCTIONS[d])
            .filter(Boolean);
          const adjustText = instructions.length > 0 ? instructions.join('、') : '换一个不同的呈现';
          cardHint = `${cardHint}（在保持人物、场景、构图、画风一致的前提下，重点${adjustText}）`;
        }

        // ② 风格锁：用户手动锁定的画风，稳定附加
        const styleOption = STYLE_OPTIONS.find((s) => s.value === lockedStyle);
        const styleHint = styleOption?.styleHint;

        // 图生图基底优先级：
        //   有镜头照片 → 始终锚定用户照片（保证「和我拍的照片相关」）
        //   无照片但再来一张 → 延续上一张生成图（保持人物一致）
        const baseImage = cardPhoto ?? (isRegen ? image!.imageUrl : undefined);
        const useImg2img = !!baseImage;

        setArtFeatures(
          [
            styleOption ? `画风：${styleOption.label}` : '',
            cardPhoto ? '已用你的照片做底图' : '',
          ]
            .filter(Boolean)
            .join(' · '),
        );

        const result = await generateMut.mutateAsync({
          storyId: activeStoryId,
          shotNo: targetShotNo,
          history: recentHistory(),
          cardHint: cardHint || undefined,
          styleHint,
          // 有底图（用户照片/上一张）→ 慢轨图生图，锚定真实画面；纯首张无底图 → 快草稿
          mode: useImg2img ? 'final' : 'draft',
          originalImageUrl: baseImage,
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
    [activeStoryId, targetShotNo, cards, visualCanvasItems, recentHistory, generateMut, signalMut, image, selectedFeedbackDimensions, lockedStyle],
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
      // 写进故事画面（body.mobileImages）→ 故事版 / Story Cards 即时可见、刷新不丢。
      // 带上 shotNo=目标卡片序号，buildMobileStoryboardScenes 精确归位到那张卡。
      addStoryImage({
        id: image.imageId,
        imageUrl: image.imageUrl,
        prompt: image.prompt,
        shotNo: targetShotNo,
        storyId: activeStoryId,
        status: 'ready',
      });
      toast.success(`已收下，绑到镜头 ${targetShotNo}`);
      onDone?.();
    } catch {
      toast.error('收下失败，稍后再试');
    }
  }, [image, activeStoryId, targetShotNo, signalMut, addStoryImage, onDone]);

  // 出正式版：draft → final（Midjourney 精画），关联草稿 parentImageId。
  // 同样带上镜头内容(cardHint)和锁定画风(styleHint)，确保正式版不丢内容/不掉风格。
  const promoteToFinal = useCallback(async () => {
    if (!image || activeStoryId == null || image.mode !== 'draft') return;
    setError(null);
    setIsGenerating(true);
    try {
      const selectedCard = cards[targetShotNo - 1];
      const cardHint = buildCardHint(selectedCard);
      const styleHint = STYLE_OPTIONS.find((s) => s.value === lockedStyle)?.styleHint;
      const result = await generateMut.mutateAsync({
        storyId: activeStoryId,
        shotNo: targetShotNo,
        history: recentHistory(),
        cardHint: cardHint || undefined,
        styleHint,
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
  }, [image, activeStoryId, targetShotNo, cards, lockedStyle, recentHistory, generateMut]);

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
        <div className="space-y-2">
          <p className="line-clamp-2 text-[11px] text-muted-foreground">{image.prompt}</p>
          {artFeatures && (
            <p className="rounded bg-amber-50/50 px-2 py-1.5 text-[10px] text-amber-900/70 dark:bg-amber-950/20 dark:text-amber-200/70">
              🎨 {artFeatures}
            </p>
          )}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {/* 绑到哪张卡片（镜头）：收下后图明确归位到这张卡 */}
        <div className="flex items-center gap-1.5">
          <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
          <Select
            value={String(targetShotNo)}
            onValueChange={(value) => setTargetShotNo(Number(value))}
            disabled={cardOptions.length === 0}
          >
            <SelectTrigger size="sm" className="h-8 w-[160px] text-xs">
              <SelectValue placeholder="绑到镜头" />
            </SelectTrigger>
            <SelectContent>
              {cardOptions.map((opt) => (
                <SelectItem key={opt.shotNo} value={String(opt.shotNo)}>
                  镜头 {opt.shotNo} · {opt.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* 锁定画风：选定后每次生成稳定用它，不漂移 */}
        <div className="flex items-center gap-1.5">
          <Palette className="h-3.5 w-3.5 text-muted-foreground" />
          <Select value={lockedStyle} onValueChange={setLockedStyle}>
            <SelectTrigger size="sm" className="h-8 w-[120px] text-xs">
              <SelectValue placeholder="锁定画风" />
            </SelectTrigger>
            <SelectContent>
              {STYLE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="ml-auto" />

        {/* 反馈维度选择：用户明确指定哪个维度不满意 */}
        {image && !isGenerating && (
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1"
              onClick={() => setShowFeedbackDimensions(!showFeedbackDimensions)}
            >
              <span>不满意指定：</span>
              {selectedFeedbackDimensions.length > 0 && (
                <span className="text-rose-500 font-medium">{selectedFeedbackDimensions.length} 项</span>
              )}
            </Button>
            {showFeedbackDimensions && (
              <div className="absolute bottom-[70px] left-0 z-50 flex flex-col gap-1.5 rounded-lg bg-white p-2 shadow-lg border text-xs">
                <label className="flex items-center gap-2 cursor-pointer hover:bg-muted p-1">
                  <input
                    type="checkbox"
                    checked={selectedFeedbackDimensions.includes('color')}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedFeedbackDimensions([...selectedFeedbackDimensions, 'color']);
                      } else {
                        setSelectedFeedbackDimensions(selectedFeedbackDimensions.filter(d => d !== 'color'));
                      }
                    }}
                    className="w-3.5 h-3.5"
                  />
                  <span>🎨 色彩/色调</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer hover:bg-muted p-1">
                  <input
                    type="checkbox"
                    checked={selectedFeedbackDimensions.includes('pose')}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedFeedbackDimensions([...selectedFeedbackDimensions, 'pose']);
                      } else {
                        setSelectedFeedbackDimensions(selectedFeedbackDimensions.filter(d => d !== 'pose'));
                      }
                    }}
                    className="w-3.5 h-3.5"
                  />
                  <span>🧘 动作/姿态</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer hover:bg-muted p-1">
                  <input
                    type="checkbox"
                    checked={selectedFeedbackDimensions.includes('composition')}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedFeedbackDimensions([...selectedFeedbackDimensions, 'composition']);
                      } else {
                        setSelectedFeedbackDimensions(selectedFeedbackDimensions.filter(d => d !== 'composition'));
                      }
                    }}
                    className="w-3.5 h-3.5"
                  />
                  <span>📐 构图/镜头角度</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer hover:bg-muted p-1">
                  <input
                    type="checkbox"
                    checked={selectedFeedbackDimensions.includes('lighting')}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedFeedbackDimensions([...selectedFeedbackDimensions, 'lighting']);
                      } else {
                        setSelectedFeedbackDimensions(selectedFeedbackDimensions.filter(d => d !== 'lighting'));
                      }
                    }}
                    className="w-3.5 h-3.5"
                  />
                  <span>💡 光线/光源</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer hover:bg-muted p-1">
                  <input
                    type="checkbox"
                    checked={selectedFeedbackDimensions.includes('style')}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedFeedbackDimensions([...selectedFeedbackDimensions, 'style']);
                      } else {
                        setSelectedFeedbackDimensions(selectedFeedbackDimensions.filter(d => d !== 'style'));
                      }
                    }}
                    className="w-3.5 h-3.5"
                  />
                  <span>🎭 艺术风格</span>
                </label>
              </div>
            )}
          </div>
        )}

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
