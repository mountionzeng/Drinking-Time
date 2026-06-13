/**
 * CreationAgentChat — Chat interface for the Creation Agent.
 * Shows conversation messages (with inline images) and a text input.
 */
import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Loader2, ImageIcon } from 'lucide-react';
import { IMAGE_PROVIDER_LABELS, IMAGE_PROVIDER_VALUES } from '@shared/imageProvider';
import { CREATION_GOALS, goalLabel, type CreationGoal } from '@shared/creationGoal';
import { Button } from '@/components/ui/button';
import { useCreationAgent, type ImageProviderSelection } from '../CreationAgentContext';
import ImageSegmentOverlay from './ImageSegmentOverlay';
import type { ShotContext } from '../types';

interface CreationAgentChatProps {
  shots?: ShotContext[];
  cards?: Array<{ content: string; emotion?: string }>;
  currentScript?: string;
  projectId?: number | null;
}

const IMAGE_PROVIDER_OPTIONS: Array<{ value: ImageProviderSelection; label: string }> = [
  { value: 'default', label: '默认' },
  ...IMAGE_PROVIDER_VALUES.map((value) => ({
    value,
    label: IMAGE_PROVIDER_LABELS[value],
  })),
];

export default function CreationAgentChat({
  shots,
  cards,
  currentScript,
  projectId,
}: CreationAgentChatProps) {
  const {
    messages,
    focusShotNo,
    isReplying,
    imageProvider,
    setImageProvider,
    goal,
    setGoal,
    sendMessage,
  } = useCreationAgent();

  const [input, setInput] = useState('');
  const [editingImage, setEditingImage] = useState<{
    imageUrl: string;
    imageId: number;
    shotNo: string;
  } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isReplying) return;
    setInput('');
    await sendMessage(text, shots, cards, currentScript);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Focus indicator */}
      {focusShotNo && (
        <div className="px-3 py-1.5 text-xs text-muted-foreground bg-muted/50 border-b flex items-center gap-1.5">
          <ImageIcon className="w-3 h-3" />
          焦点镜头: <span className="font-mono font-medium text-foreground">{focusShotNo}</span>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
        <AnimatePresence initial={false}>
          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-xl px-3 py-2 text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-foreground'
                }`}
              >
                <p className="whitespace-pre-wrap">{msg.content}</p>
                {msg.generatedImage && (
                  <div
                    className="mt-2 rounded-lg overflow-hidden border cursor-pointer hover:ring-1 hover:ring-primary/50 transition-shadow"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (msg.generatedImage && projectId) {
                        setEditingImage({
                          imageUrl: msg.generatedImage.imageUrl,
                          imageId: msg.generatedImage.imageId,
                          shotNo: msg.generatedImage.shotNo,
                        });
                      }
                    }}
                  >
                    <img
                      src={msg.generatedImage.imageUrl}
                      alt={`Generated for ${msg.generatedImage.shotNo}`}
                      className="w-full max-h-64 object-cover"
                    />
                    <div className="px-2 py-1 text-xs text-muted-foreground bg-background flex justify-between">
                      <span>{msg.generatedImage.shotNo} 生成图</span>
                      {projectId && <span className="text-primary/70">点击编辑</span>}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {isReplying && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex justify-start"
          >
            <div className="bg-muted rounded-xl px-3 py-2 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              思考中...
            </div>
          </motion.div>
        )}
      </div>

      {/* Input */}
      <div className="border-t p-3">
        <div className="mb-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span>我在做</span>
          <select
            value={goal}
            onChange={(event) => setGoal(event.target.value as CreationGoal)}
            disabled={isReplying}
            aria-label="选择创作目标"
            className="h-7 rounded-md border bg-background px-2 text-[11px] text-foreground outline-none transition disabled:opacity-50"
          >
            {CREATION_GOALS.map((g) => (
              <option key={g} value={g}>
                {goalLabel(g)}
              </option>
            ))}
          </select>
        </div>
        <div className="mb-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span>出图模型</span>
          <select
            value={imageProvider}
            onChange={(event) => setImageProvider(event.target.value as ImageProviderSelection)}
            disabled={isReplying}
            aria-label="选择出图模型"
            className="h-7 rounded-md border bg-background px-2 text-[11px] text-foreground outline-none transition disabled:opacity-50"
          >
            {IMAGE_PROVIDER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="聊聊画面，描述你想要的镜头效果..."
            className="flex-1 resize-none rounded-lg border bg-background px-3 py-2 text-sm min-h-[40px] max-h-[120px] focus:outline-none focus:ring-1 focus:ring-ring"
            rows={1}
            disabled={isReplying}
          />
          <Button
            size="icon"
            variant="default"
            onClick={handleSend}
            disabled={!input.trim() || isReplying}
            className="shrink-0"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Point-and-click edit overlay */}
      {editingImage && projectId && (
        <ImageSegmentOverlay
          imageUrl={editingImage.imageUrl}
          imageId={editingImage.imageId}
          shotNo={editingImage.shotNo}
          projectId={projectId}
          onClose={() => setEditingImage(null)}
        />
      )}
    </div>
  );
}
