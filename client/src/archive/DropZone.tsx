/**
 * DropZone — Drag & drop import area with real file upload
 * Design: Monitor panel with beverage-themed cheerful empty state
 * Now connected to backend via tRPC for file upload and NLP analysis
 */
import { useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, CheckCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNayin } from '@/contexts/NayinContext';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import { TRPCClientError } from '@trpc/client';
import type { NayinElement } from '@/lib/nayin';
import ShotStageIllustration, { type ShotStage } from '@/components/ShotStageIllustration';

type DropZoneState = 'empty' | 'hovering' | 'uploading' | 'analyzing' | 'done';

// Beverage-themed upload step messages
const UPLOAD_STEPS_MAP: Record<NayinElement, string[]> = {
  metal: [
    '倒一杯啤酒，开始读素材...',
    '气泡升腾中，上传文件到云端',
    '琥珀色光芒中识别素材类型',
    '干杯！NLP 拆镜头',
    '金色灵感，分析完成',
  ],
  wood: [
    '泡一壶龙井，慢慢读...',
    '茶香袅袅，上传文件到云端',
    '翠绿茶汤中识别素材类型',
    '品一口，NLP 拆镜头',
    '茶韵悠长，分析完成',
  ],
  water: [
    '开一瓶椰汁，清爽开始...',
    '椰风阵阵，上传文件到云端',
    '热带阳光下识别素材类型',
    '椰香四溢，NLP 拆镜头',
    '清凉收工，分析完成',
  ],
  fire: [
    '冲一泡大红袍，静心读...',
    '岩韵悠然，上传文件到云端',
    '琥珀红汤中识别素材类型',
    '回甘之际，NLP 拆镜头',
    '茶暖心安，分析完成',
  ],
  earth: [
    '磨一杯咖啡，提神开始...',
    '咖啡香浓，上传文件到云端',
    '拉花纹路中识别素材类型',
    '续一杯，NLP 拆镜头',
    '醇厚收尾，分析完成',
  ],
};

// Beverage-themed drop zone messages
const DROP_MESSAGES: Record<NayinElement, { title: string; subtitle: string; hint: string }> = {
  metal: {
    title: '把素材丢进来吧',
    subtitle: '图片、视频、PDF、剧本、brief 或笔记，统统可以',
    hint: '不用整理，直接扔，就像往杯里倒啤酒一样随意',
  },
  wood: {
    title: '请把素材放进来',
    subtitle: '图片、视频、PDF、剧本、brief 或笔记，都可以',
    hint: '像泡茶一样，把原料放进来就好',
  },
  water: {
    title: '素材丢这里就行',
    subtitle: '图片、视频、PDF、剧本、brief 或笔记，随便来',
    hint: '轻松点，像喝椰汁一样简单',
  },
  fire: {
    title: '素材请放这里',
    subtitle: '图片、视频、PDF、剧本、brief 或笔记，均可',
    hint: '像冲泡大红袍，把茶叶放进盖碗就好',
  },
  earth: {
    title: '把素材倒进来',
    subtitle: '图片、视频、PDF、剧本、brief 或笔记，来者不拒',
    hint: '像倒咖啡豆进磨豆机，我来帮你研磨',
  },
};

function detectSourceType(mimeType: string, fileName: string): "image" | "video" | "script" | "storyboard" | "brief" | "note" | "pdf" {
  const normalizedMime = (mimeType || '').toLowerCase();
  if (normalizedMime.startsWith('image/')) return 'image';
  if (normalizedMime.startsWith('video/')) return 'video';
  if (normalizedMime === 'application/pdf') return 'pdf';

  const ext = fileName.toLowerCase().split('.').pop() || '';
  if (['fdx', 'fountain', 'srt', 'ass'].includes(ext)) return 'script';
  if (['pdf'].includes(ext)) return 'pdf';
  if (['doc', 'docx', 'ppt', 'pptx', 'key'].includes(ext)) return 'brief';
  if (['txt', 'md', 'rtf', 'csv', 'tsv', 'json', 'yaml', 'yml', 'xml', 'log', 'xlsx', 'xls', 'numbers', 'zip', 'rar', '7z'].includes(ext)) return 'note';
  return 'note';
}

interface DropZoneProps {
  projectId: number | null;
  onAnalysisComplete: () => void;
  onRunAnalysis: () => Promise<void>;
  isAnalyzing: boolean;
}

export default function DropZone({ projectId, onAnalysisComplete, onRunAnalysis, isAnalyzing }: DropZoneProps) {
  const { element } = useNayin();
  const [state, setState] = useState<DropZoneState>('empty');
  const [buildStep, setBuildStep] = useState(0);
  const [uploadedCount, setUploadedCount] = useState(0);
  const [uploadedTypes, setUploadedTypes] = useState<Record<string, number>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneBodyRef = useRef<HTMLDivElement>(null);
  const buildSteps = UPLOAD_STEPS_MAP[element];
  const dropMsg = DROP_MESSAGES[element];
  const stateStage: Record<DropZoneState, ShotStage> = {
    empty: 'idea_pool',
    hovering: 'requirement_pool',
    uploading: 'structured',
    analyzing: 'production_ready',
    done: 'queued',
  };

  const uploadMut = trpc.reference.upload.useMutation();
  const utils = trpc.useUtils();

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (state === 'empty' || state === 'done') setState('hovering');
  }, [state]);

  const handleDragLeave = useCallback(() => {
    if (state === 'hovering') setState('empty');
  }, [state]);

  const processFiles = useCallback(async (files: File[]) => {
    if (!projectId) {
      toast.error('项目尚未创建，请稍候再试');
      return;
    }

    setState('uploading');
    setBuildStep(0);

    const typeCounts: Record<string, number> = {};
    let uploaded = 0;

    // Step 0: Reading files
    setBuildStep(0);
    await new Promise(r => setTimeout(r, 300));

    // Step 1: Uploading
    setBuildStep(1);

    for (const file of files) {
      try {
        const base64 = await fileToBase64(file);
        const sourceType = detectSourceType(file.type, file.name);

        await uploadMut.mutateAsync({
          projectId,
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          fileBase64: base64,
          sourceType,
        });

        uploaded++;
        typeCounts[sourceType] = (typeCounts[sourceType] || 0) + 1;
      } catch (err) {
        console.error('Upload failed:', file.name, err);
        toast.error(`上传失败: ${file.name}`);
      }
    }

    setUploadedCount(uploaded);
    setUploadedTypes(typeCounts);

    // Step 2: Identifying types
    setBuildStep(2);
    await new Promise(r => setTimeout(r, 400));

    // Step 3: NLP analysis
    setBuildStep(3);
    try {
      await onRunAnalysis();
    } catch (err) {
      console.error('Analysis failed:', err);
      let errorMsg = '请重试';
      if (err instanceof TRPCClientError || err instanceof Error) {
        errorMsg = err.message;
      }
      toast.error(`NLP 分析失败：${errorMsg}`);
    }

    // Step 4: Done
    setBuildStep(4);
    await new Promise(r => setTimeout(r, 300));

    setState('done');
    // Refresh references list
    utils.reference.list.invalidate({ projectId });
    onAnalysisComplete();
  }, [projectId, uploadMut, utils.reference.list, onRunAnalysis, onAnalysisComplete]);

  const processTextAsFile = useCallback(async (text: string, source: 'paste' | 'drop') => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const fileName = `${source}-text-${Date.now()}.txt`;
    const textFile = new File([trimmed], fileName, {
      type: 'text/plain;charset=utf-8',
    });
    await processFiles([textFile]);
  }, [processFiles]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      processFiles(files);
      return;
    }
    const droppedText = e.dataTransfer.getData('text/plain');
    if (droppedText?.trim()) {
      processTextAsFile(droppedText, 'drop');
    }
  }, [processFiles, processTextAsFile]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) processFiles(files);
    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [processFiles]);

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    const clipboardItems = Array.from(e.clipboardData.items);
    const pastedFiles = clipboardItems
      .filter(item => item.kind === 'file')
      .map(item => item.getAsFile())
      .filter((file): file is File => Boolean(file));

    if (pastedFiles.length > 0) {
      e.preventDefault();
      processFiles(pastedFiles);
      return;
    }

    const text = e.clipboardData.getData('text/plain');
    if (text?.trim()) {
      e.preventDefault();
      processTextAsFile(text, 'paste');
    }
  }, [processFiles, processTextAsFile]);

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // Remove data:...;base64, prefix
        const base64 = result.split(',')[1] || result;
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  // Hidden file input
  const hiddenInput = (
    <input
      ref={fileInputRef}
      type="file"
      multiple
      accept="image/*,video/*,.pdf,.txt,.md,.rtf,.csv,.tsv,.json,.yaml,.yml,.xml,.log,.doc,.docx,.ppt,.pptx,.key,.fdx,.fountain,.srt,.ass,.xlsx,.xls,.numbers,.zip,.rar,.7z"
      className="hidden"
      onChange={handleFileSelect}
    />
  );

  return (
    <div className="monitor-panel h-full flex flex-col">
      {hiddenInput}
      <div className="monitor-panel-header">
        <div className="status-dot" />
        <span>Drop Zone</span>
        <span className="ml-auto text-[10px] opacity-50">INPUT</span>
      </div>
      <div
        ref={dropZoneBodyRef}
        className="monitor-panel-body flex-1 flex flex-col items-center justify-center relative"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onPaste={handlePaste}
        tabIndex={0}
        onClick={() => dropZoneBodyRef.current?.focus()}
      >
        <AnimatePresence mode="wait">
          {state === 'empty' && (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="workshop-empty-illustration"
            >
              <ShotStageIllustration stage={stateStage.empty} size={132} />

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-20 h-20 rounded-xl border border-dashed border-[var(--nayin-accent)] flex items-center justify-center opacity-70 hover:opacity-100 hover:shadow-nayin hover:border-solid transition-all bg-white/60"
                aria-label="Select files to upload"
              >
                <Upload className="w-8 h-8 text-nayin" />
              </button>

              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-foreground">
                  {dropMsg.title}
                </h3>
                <p className="text-xs text-muted-foreground max-w-[18rem]">
                  {dropMsg.subtitle}
                </p>
                <p className="text-[11px] text-muted-foreground/80 max-w-[18rem] leading-relaxed">
                  {dropMsg.hint}
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                <span className="px-2.5 py-1 rounded-full border border-[var(--panel-border)] bg-white/65 text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
                  Drag
                </span>
                <span className="px-2.5 py-1 rounded-full border border-[var(--panel-border)] bg-white/65 text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
                  Paste Text
                </span>
                <span className="px-2.5 py-1 rounded-full border border-[var(--panel-border)] bg-white/65 text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
                  Multi-format
                </span>
              </div>
            </motion.div>
          )}

          {state === 'hovering' && (
            <motion.div
              key="hovering"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="workshop-empty-illustration"
            >
              <ShotStageIllustration stage={stateStage.hovering} size={132} />
              <p className="text-sm text-nayin font-medium">松手就好，素材会自动归档</p>
            </motion.div>
          )}

          {(state === 'uploading' || state === 'analyzing') && (
            <motion.div
              key="building"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="workshop-empty-illustration"
            >
              <ShotStageIllustration
                stage={buildStep >= 3 ? stateStage.analyzing : stateStage.uploading}
                size={132}
              />
              <div className="space-y-1.5">
                {buildSteps.map((step, i) => (
                  <motion.div
                    key={step}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{
                      opacity: i <= buildStep ? 1 : 0.3,
                      x: 0,
                    }}
                    transition={{ delay: i * 0.1 }}
                    className="flex items-center gap-2 text-xs"
                  >
                    <div
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{
                        background: i <= buildStep ? 'var(--nayin-accent)' : 'var(--muted-foreground)',
                      }}
                    />
                    <span
                      className={i <= buildStep ? 'text-foreground' : 'text-muted-foreground'}
                    >
                      {step}
                    </span>
                    {i === buildStep && i < buildSteps.length - 1 && (
                      <Loader2 className="w-3 h-3 text-nayin animate-spin" />
                    )}
                    {i < buildStep && (
                      <CheckCircle className="w-3 h-3 text-[var(--status-ready)]" />
                    )}
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}

          {state === 'done' && (
            <motion.div
              key="done"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="workshop-empty-illustration"
            >
              <ShotStageIllustration stage={stateStage.done} size={132} />
              <div>
                <p className="text-sm font-medium text-foreground">
                  {uploadedCount} 份素材已导入
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  镜头已拆解完成
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5 justify-center mt-1">
                {Object.entries(uploadedTypes).map(([type, count]) => (
                  <span key={type} className="px-2 py-0.5 rounded text-[10px] font-mono bg-nayin-glow text-nayin">
                    {count} {type}
                  </span>
                ))}
              </div>
              <Button
                size="sm"
                variant="outline"
                className="text-xs mt-2 text-muted-foreground"
                onClick={() => setState('empty')}
              >
                + 继续添加素材
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
