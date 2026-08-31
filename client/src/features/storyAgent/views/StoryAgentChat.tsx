/**
 * StoryAgentChat — Conversational guide that surfaces specific, sensory
 * memories and condenses them into story cards.
 *
 * Sits in the DROP ZONE slot of the analysis page.
 */
import {
  useEffect,
  useRef,
  useState,
  useCallback,
  type KeyboardEvent,
  type ChangeEvent,
  type DragEvent,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send,
  Sparkles,
  RefreshCcw,
  Loader2,
  ChevronLeft,
  X,
  Image as ImageIcon,
  Paperclip,
  UploadCloud,
  Video,
  Mic,
  Cloud,
  Check,
  Copy,
  Link2,
  Pencil,
  RotateCw,
  ScanText,
} from "lucide-react";
import { toast } from "sonner";
import { useOptionalCreationEditor } from "@/features/creationEditor/CreationEditorContext";
import type { StoryImageMaterialAdvice } from "@/features/creationEditor/types";
import {
  useStoryAgentActions,
  type StoryboardImageRerenderResult,
} from "@/features/storyAgent/StoryAgentContext";
import { useStoryAgentChatSlice } from "@/features/storyAgent/spine/selectors";
import {
  displayAssistantName,
  type StoryboardImageRerenderActionReference,
} from "@/features/storyAgent/types";
import { useNayin } from "@/features/nayin/NayinContext";
import EmotiveWuxingIcon from "@/features/nayin/views/EmotiveWuxingIcon";
import { useVoiceInput } from "@/features/storyAgent/hooks/useVoiceInput";
import {
  RecordingGlyph,
  TranscribingGlyph,
} from "@/features/storyAgent/views/VoiceInputGlyph";
import { formatBytes, optimizeImageForUpload } from "@/lib/imageUpload";
import StoryCapabilityMenu, {
  shouldShowCapabilityMenu,
} from "./StoryCapabilityMenu";
import PublishingPlatformPicker from "@/features/publishingDraft/PublishingPlatformPicker";
import StoryJobIntakePrompt, { getJobIntakeStep } from "./StoryJobIntakePrompt";
import SelectionContextCard from "./SelectionContextCard";
import ChatImageRemixTray from "./ChatImageRemixTray";
import AssetSwapProposalCard from "./AssetSwapProposalCard";
import { useAssetSwapProposal } from "../useAssetSwapProposal";
import { chatImageRefsStore } from "../chatImageRefsStore";
import { useChatImageRemix } from "../useChatImageRemix";
import EditingTransitionCandidateCard from "../components/EditingTransitionCandidateCard";
import {
  loadStoryConversationDraft,
  saveStoryConversationDraft,
} from "../storyConversationStore";
import { tokenizeChatMessageText } from "../chatMessageFormat";
import type { StoryIntent } from "../intentTypes";
import {
  defaultPublishingNarrativeIntent,
  hasPersistedPublishingVersion,
} from "@shared/publishingDraft";
import {
  PublishingIntentProposalDialog,
  publishingNarrativeIntentFromStoryIntent,
} from "@/features/publishingDraft/PublishingIntentProposalDialog";
import { displayShotCode } from "@shared/shotIdentity";
import {
  buildImportedImageRefs,
  buildImportedMediaPrompt,
  chatMediaFileKey,
  chatMediaKind,
  inferChatMediaMime,
  isImportedImageGenerationRequest,
  extractImportedPhotoFeatures,
  MAX_CHAT_MEDIA_ATTACHMENTS,
  readChatMediaBase64,
  selectChatMediaFiles,
  type ImportedChatMedia,
  type PendingChatMedia,
} from "../chatMediaAttachments";
import {
  parseChatImageLocalEditInstruction,
  rotateTimelineImage180,
} from "../chatImageLocalEdit";
import { DEFAULT_TIMELINE_TRANSFORM } from "@shared/storyMaterial";

type OpenCreationChatDetail = {
  draftMessage?: string;
  preserveSelection?: boolean;
  autoSubmit?: boolean;
};

type MaterialAdvice = StoryImageMaterialAdvice;

type ChatVisionPreview = {
  base64: string;
  mimeType: string;
};

function waitForMediaEvent(
  target: HTMLMediaElement,
  eventName: "loadeddata" | "seeked",
  timeoutMs = 6_000
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("视频首帧读取超时"));
    }, timeoutMs);
    const cleanup = () => {
      window.clearTimeout(timer);
      target.removeEventListener(eventName, onReady);
      target.removeEventListener("error", onError);
    };
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("视频首帧读取失败"));
    };
    target.addEventListener(eventName, onReady, { once: true });
    target.addEventListener("error", onError, { once: true });
  });
}

async function prepareChatVisionPreview(
  attachment: PendingChatMedia
): Promise<ChatVisionPreview | null> {
  if (attachment.kind === "image") {
    const upload = await optimizeImageForUpload(attachment.file, {
      profile: "chat",
    });
    return { base64: upload.base64, mimeType: upload.mimeType };
  }

  const sourceUrl = URL.createObjectURL(attachment.file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = sourceUrl;
  try {
    await waitForMediaEvent(video, "loadeddata");
    const seekTo = Number.isFinite(video.duration)
      ? Math.min(Math.max(video.duration * 0.12, 0.05), 0.8)
      : 0.05;
    if (Math.abs(video.currentTime - seekTo) > 0.01) {
      video.currentTime = seekTo;
      await waitForMediaEvent(video, "seeked");
    }
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return null;
    const scale = Math.min(1, 1024 / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
    return {
      base64: dataUrl.split(",").pop() ?? "",
      mimeType: "image/jpeg",
    };
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(sourceUrl);
  }
}

function materialAdviceLabel(verdict: MaterialAdvice["verdict"]): string {
  if (verdict === "use") return "建议采用";
  if (verdict === "skip") return "不建议";
  return "可以考虑";
}

function intentLabel(intent: StoryIntent | null): string {
  if (!intent) return "未定意图";
  if (intent.purpose === "fiction") return "虚构故事";
  if (intent.purpose === "linkedin_job_search") return "求职短片";
  if (intent.purpose === "personal_memory") return "个人记忆";
  if (intent.purpose === "self_reflection") return "给自己讲";
  if (intent.purpose === "raw_record") return "记录再说";
  if (intent.purpose === "social_post") return "社交发布";
  if (intent.purpose === "gift") return "亲友礼物";
  if (intent.purpose === "portfolio") return "介绍自己";
  return "创作故事";
}

export default function StoryAgentChat({
  showHeader = true,
  interactionMode = "story",
  onOpenPublishingWorkspace,
}: {
  showHeader?: boolean;
  interactionMode?: "story" | "publishing";
  onOpenPublishingWorkspace?: () => void;
}) {
  const {
    messages,
    cardRefs,
    isReplying,
    activeStoryId,
    remoteStoryId,
    storyTitle,
    storyLogline,
    storyShotsCount,
    saveStatus,
    lastSavedAt,
    returningGreeting,
    confirmedIntent,
    pendingIntentDraft,
    pendingIntentCommitProposalId,
    publishing,
    activeSelection,
  } = useStoryAgentChatSlice();
  const {
    sendMessage,
    resetConversation,
    backToList,
    confirmPendingIntent,
    dismissPendingIntent,
    clearSelection,
    sendSelectionEdit,
    confirmSelectionCandidate,
    rejectSelectionCandidate,
    rerenderSelectionImage,
    confirmEditingTransitionCandidate,
    rejectEditingTransitionCandidate,
    renameStory,
  } = useStoryAgentActions();
  const [rerenderingMessageId, setRerenderingMessageId] = useState<
    string | null
  >(null);
  const [rerenderResultByMessageId, setRerenderResultByMessageId] = useState<
    Record<string, StoryboardImageRerenderResult>
  >({});
  const creationEditor = useOptionalCreationEditor();
  const remix = useChatImageRemix(
    creationEditor?.activeStoryId ?? remoteStoryId ?? null
  );
  const labelForShot = (
    shotNo: number | null | undefined,
    stableShotId?: string | null
  ) => {
    const stableShot = stableShotId
      ? creationEditor?.shots.find(
          shot =>
            shot.stableShotId === stableShotId ||
            shot.shotIdentity === stableShotId
        )
      : undefined;
    return displayShotCode(
      stableShot ??
        creationEditor?.shots.find(shot => shot.shotNo === shotNo) ?? {
          shotNo,
        }
    );
  };
  const assetSwap = useAssetSwapProposal({
    storyId: creationEditor?.activeStoryId ?? remoteStoryId ?? null,
    selection: activeSelection,
    onAdoptImage: creationEditor?.promoteStoryImage,
    onFallthrough: instruction => void sendSelectionEdit(instruction),
    shotLabelOf: (shotNo, stableShotId) => labelForShot(shotNo, stableShotId),
  });
  const handleImageRerender = useCallback(
    async (
      messageId: string,
      request: StoryboardImageRerenderActionReference
    ) => {
      if (rerenderingMessageId) return;
      setRerenderingMessageId(messageId);
      setRerenderResultByMessageId(current => {
        const next = { ...current };
        delete next[messageId];
        return next;
      });
      try {
        const result = await rerenderSelectionImage(request);
        setRerenderResultByMessageId(current => ({
          ...current,
          [messageId]: result,
        }));
      } catch (error) {
        setRerenderResultByMessageId(current => ({
          ...current,
          [messageId]: {
            status: "error",
            message: error instanceof Error ? error.message : "图片生成失败",
          },
        }));
      } finally {
        setRerenderingMessageId(null);
      }
    },
    [rerenderSelectionImage, rerenderingMessageId]
  );
  const { element } = useNayin();
  const [input, setInput] = useState("");
  const [pendingMedia, setPendingMedia] = useState<PendingChatMedia[]>([]);
  const [isMediaDragActive, setIsMediaDragActive] = useState(false);
  const [isImportingMedia, setIsImportingMedia] = useState(false);
  const [mediaProgress, setMediaProgress] = useState<string | null>(null);
  const [isRenamingTitle, setIsRenamingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  const [closedIntentProposalId, setClosedIntentProposalId] = useState<
    string | null
  >(null);
  const [materialAdvices, setMaterialAdvices] = useState<MaterialAdvice[]>([]);
  const [applyingAdviceImageId, setApplyingAdviceImageId] = useState<
    number | null
  >(null);
  const [imageTextResult, setImageTextResult] = useState<{
    imageId: number;
    text: string;
    rotated: boolean;
  } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const draftStoryIdRef = useRef<number | null>(null);
  const pendingMediaRef = useRef<PendingChatMedia[]>([]);
  const dragDepthRef = useRef(0);
  const currentIntent = confirmedIntent ?? pendingIntentDraft;
  const currentNarrativeIntent = confirmedIntent
    ? publishingNarrativeIntentFromStoryIntent(
        confirmedIntent,
        defaultPublishingNarrativeIntent(),
        0
      )
    : defaultPublishingNarrativeIntent(0);
  const proposedNarrativeIntent = pendingIntentDraft
    ? publishingNarrativeIntentFromStoryIntent(
        pendingIntentDraft,
        currentNarrativeIntent,
        0
      )
    : null;
  const hasPublishingVersion = Boolean(
    publishing && hasPersistedPublishingVersion(publishing)
  );
  const storyDisplayTitle =
    storyTitle?.trim() ||
    (remoteStoryId || (activeStoryId && activeStoryId > 0)
      ? `故事 #${remoteStoryId ?? activeStoryId}`
      : "新故事草稿");
  const storyDisplaySubtitle =
    interactionMode === "publishing"
      ? "等待你整理成当前平台文字稿"
      : storyLogline?.trim() ||
        (storyShotsCount > 0
          ? `${storyShotsCount} 个镜头正在同步`
          : currentIntent
            ? "等待从对话直接生成 Storyboard 表格"
            : cardRefs.length > 0
              ? `${cardRefs.length} 张故事卡正在同步`
              : "等待整理成故事卡");
  const inputPlaceholder =
    interactionMode === "publishing"
      ? "先把真实想法说出来，聊聊会一次只追问一个关键点…"
      : activeSelection
        ? "告诉聊聊这处想怎么改…"
        : pendingMedia.length > 0
          ? "补一句你希望怎么用这些素材…"
          : "说说这一版哪里需要推进…";

  const startRenamingTitle = () => {
    setTitleDraft(storyDisplayTitle);
    setIsRenamingTitle(true);
  };

  const cancelRenamingTitle = () => {
    setTitleDraft("");
    setIsRenamingTitle(false);
  };

  const saveStoryTitle = async () => {
    const nextTitle = titleDraft.trim();
    if (!nextTitle || isSavingTitle) {
      if (!nextTitle) toast.error("故事名称不能为空");
      return;
    }
    setIsSavingTitle(true);
    try {
      await renameStory(
        remoteStoryId ??
          (activeStoryId && activeStoryId > 0 ? activeStoryId : null),
        nextTitle
      );
      setIsRenamingTitle(false);
      toast.success("故事名称已修改");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "故事改名失败");
    } finally {
      setIsSavingTitle(false);
    }
  };

  useEffect(() => {
    const previousStoryId = draftStoryIdRef.current;
    if (previousStoryId != null && previousStoryId > 0) {
      saveStoryConversationDraft(previousStoryId, input);
    }
    const nextStoryId =
      activeStoryId && activeStoryId > 0 ? activeStoryId : null;
    setInput(nextStoryId ? loadStoryConversationDraft(nextStoryId) : "");
    draftStoryIdRef.current = nextStoryId;
  }, [activeStoryId]);

  useEffect(() => {
    if (!activeStoryId || activeStoryId <= 0) return;
    const timer = window.setTimeout(
      () => saveStoryConversationDraft(activeStoryId, input),
      200
    );
    return () => window.clearTimeout(timer);
  }, [activeStoryId, input]);

  const saveLabel =
    saveStatus === "saving"
      ? "云端保存中"
      : saveStatus === "error"
        ? "云端保存失败，本地备份还在"
        : remoteStoryId || (activeStoryId && activeStoryId > 0)
          ? `已云端保存 #${remoteStoryId ?? activeStoryId}`
          : "待云端保存";
  const saveTitle =
    saveStatus === "saved" && lastSavedAt
      ? `保存到当前账号的云端故事库：${new Date(lastSavedAt).toLocaleString("zh-CN")}`
      : "保存到当前账号的云端故事库";

  const resizeAndFocusInput = useCallback(() => {
    requestAnimationFrame(() => {
      const ta = inputRef.current;
      if (!ta) return;
      ta.focus();
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight, 96)}px`;
    });
  }, []);

  const handleVoiceTranscribed = useCallback(
    (text: string) => {
      setInput(prev => (prev ? `${prev} ${text}` : text));
      resizeAndFocusInput();
    },
    [resizeAndFocusInput]
  );

  useEffect(() => {
    const applyCreationDraft = (event: Event) => {
      const detail = (event as CustomEvent<OpenCreationChatDetail>).detail;
      if (!detail?.draftMessage) return;
      if (!detail.preserveSelection) clearSelection();
      if (detail.autoSubmit) {
        setInput("");
        void sendMessage(detail.draftMessage);
        resizeAndFocusInput();
        return;
      }
      setInput(prev =>
        prev.trim()
          ? `${prev.trim()}\n\n${detail.draftMessage}`
          : (detail.draftMessage ?? "")
      );
      resizeAndFocusInput();
    };
    window.addEventListener("dt:open-creation-chat", applyCreationDraft);
    return () =>
      window.removeEventListener("dt:open-creation-chat", applyCreationDraft);
  }, [clearSelection, resizeAndFocusInput, sendMessage]);

  const handleVoiceError = useCallback((message: string) => {
    alert(message);
  }, []);

  const voice = useVoiceInput({
    language: "zh",
    onTranscribed: handleVoiceTranscribed,
    onError: handleVoiceError,
  });
  const showCapabilityMenu =
    interactionMode === "story" &&
    shouldShowCapabilityMenu({
      messages,
      confirmedIntent,
      returningGreeting,
      isReplying,
    });
  const jobIntakeStep = getJobIntakeStep(confirmedIntent);
  const showJobIntake =
    interactionMode === "story" &&
    jobIntakeStep !== "none" &&
    jobIntakeStep !== "done" &&
    !isReplying;

  useEffect(() => {
    pendingMediaRef.current = pendingMedia;
  }, [pendingMedia]);

  // 引用的是这个故事的图片行；换故事必须清空，否则会把上一个故事的图当参考发出去。
  useEffect(() => {
    chatImageRefsStore
      .getState()
      .scopeToStory(creationEditor?.activeStoryId ?? remoteStoryId ?? null);
  }, [creationEditor?.activeStoryId, remoteStoryId]);

  useEffect(() => {
    if (pendingIntentDraft?.proposal?.id !== closedIntentProposalId) {
      setClosedIntentProposalId(null);
    }
  }, [closedIntentProposalId, pendingIntentDraft?.proposal?.id]);

  useEffect(
    () => () => {
      for (const attachment of pendingMediaRef.current) {
        URL.revokeObjectURL(attachment.previewUrl);
      }
    },
    []
  );

  const stageMediaFiles = useCallback(
    (files: FileList | File[]) => {
      const selection = selectChatMediaFiles({
        files,
        existingKeys: new Set(pendingMedia.map(item => item.fileKey)),
        availableSlots: MAX_CHAT_MEDIA_ATTACHMENTS - pendingMedia.length,
      });
      if (selection.rejected.length > 0) {
        const detail = selection.rejected
          .slice(0, 2)
          .map(item => `${item.fileName}：${item.reason}`)
          .join("；");
        toast.error(detail);
      }
      if (selection.accepted.length === 0) return;
      setPendingMedia(current => [
        ...current,
        ...selection.accepted.map(file => ({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          file,
          fileKey: chatMediaFileKey(file),
          kind: chatMediaKind(file)!,
          mimeType: inferChatMediaMime(file),
          previewUrl: URL.createObjectURL(file),
        })),
      ]);
      resizeAndFocusInput();
    },
    [pendingMedia, resizeAndFocusInput]
  );

  const handleMediaSelect = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      if (event.target.files?.length) stageMediaFiles(event.target.files);
      event.target.value = "";
    },
    [stageMediaFiles]
  );

  const removePendingMedia = useCallback((attachmentId: string) => {
    setPendingMedia(current => {
      const attachment = current.find(item => item.id === attachmentId);
      if (attachment) URL.revokeObjectURL(attachment.previewUrl);
      return current.filter(item => item.id !== attachmentId);
    });
  }, []);

  const handlesMediaDrag = (event: DragEvent<HTMLElement>) =>
    Array.from(event.dataTransfer.types).includes("Files");

  const handleMediaDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!handlesMediaDrag(event)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsMediaDragActive(true);
  };

  const handleMediaDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!handlesMediaDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleMediaDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!handlesMediaDrag(event)) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsMediaDragActive(false);
  };

  const handleMediaDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!handlesMediaDrag(event)) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsMediaDragActive(false);
    if (event.dataTransfer.files.length) {
      stageMediaFiles(event.dataTransfer.files);
    }
  };

  const applyMaterialAdvice = useCallback(
    async (advice: MaterialAdvice) => {
      const storyId = creationEditor?.activeStoryId;
      if (
        !creationEditor ||
        storyId == null ||
        advice.targetShotNo == null ||
        !advice.targetStableShotId
      ) {
        toast.error("这条建议还没有明确归属镜头");
        return;
      }
      setApplyingAdviceImageId(advice.imageId);
      try {
        await creationEditor.applyStoryImageAdvice({
          imageId: advice.imageId,
          targetShotNo: advice.targetShotNo,
          targetStableShotId: advice.targetStableShotId,
          reason: advice.reason.slice(0, 500),
          videoDirection: advice.videoDirection,
        });
        setMaterialAdvices(current =>
          current.filter(item => item.imageId !== advice.imageId)
        );
        creationEditor.refetch();
        toast.success(
          `已放入 ${labelForShot(
            advice.targetShotNo,
            advice.targetStableShotId
          )}，运镜建议也写进镜头了`
        );
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "素材归类失败");
      } finally {
        setApplyingAdviceImageId(null);
      }
    },
    [creationEditor]
  );

  // Auto-scroll on new messages
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const isPristineStoryStart =
      showCapabilityMenu && !messages.some(message => message.role === "user");
    if (isPristineStoryStart) {
      el.scrollTo({ top: 0, behavior: "auto" });
      return;
    }
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [
    messages,
    isReplying,
    returningGreeting,
    showCapabilityMenu,
    showJobIntake,
    pendingIntentDraft,
    materialAdvices,
    mediaProgress,
  ]);

  const handleSubmit = async () => {
    const text = input.trim();
    if (interactionMode === "publishing") {
      if (!text || isReplying || voice.isBusy || isImportingMedia) return;
      setInput("");
      await sendMessage(text);
      resizeAndFocusInput();
      return;
    }
    if (
      (!text && pendingMedia.length === 0) ||
      isReplying ||
      voice.isBusy ||
      isImportingMedia
    ) {
      return;
    }

    // 篮子里有图时，这句话是在说「怎么把这几张改成一张新的」，不是聊天。
    // 用户明确点选过图片，比一个自动跟随的选区更能代表他此刻要做什么，所以排在前面。
    if (pendingMedia.length === 0 && remix.refs.length > 0) {
      if (remix.arm(text)) {
        setInput("");
        resizeAndFocusInput();
      }
      return;
    }

    if (pendingMedia.length === 0 && activeSelection) {
      const localImageIntent = parseChatImageLocalEditInstruction(text);
      if (
        localImageIntent &&
        activeSelection.imageId != null &&
        creationEditor
      ) {
        const selectedImageId = activeSelection.imageId;
        const shot =
          (activeSelection.stableShotId
            ? creationEditor.shots.find(
                item =>
                  (item.stableShotId ?? item.shotIdentity) ===
                  activeSelection.stableShotId
              )
            : null) ??
          creationEditor.shots.find(item => item.shotNo === activeSelection.shotNo);
        const stableShotId =
          shot?.stableShotId ?? shot?.shotIdentity ?? activeSelection.stableShotId;
        if (!shot || !stableShotId) {
          toast.error("这张图片还没有可编辑的镜头位置");
          return;
        }
        const currentTransform = {
          ...DEFAULT_TIMELINE_TRANSFORM,
          ...(shot.timelineItem?.transform ?? {}),
          ...(shot.timelineItem?.imageTransforms?.[String(selectedImageId)] ?? {}),
        };
        const rotationDeg = localImageIntent.rotate180
          ? rotateTimelineImage180(currentTransform.rotationDeg ?? 0)
          : (currentTransform.rotationDeg ?? 0);
        setInput("");
        setMediaProgress(
          localImageIntent.extractText ? "正在按当前方向提取文字…" : "正在倒转图片…"
        );
        try {
          if (localImageIntent.rotate180) {
            await creationEditor.updateTimelineImageTransform({
              stableShotId,
              imageId: selectedImageId,
              transform: { ...currentTransform, rotationDeg },
              textOverlay:
                shot.timelineItem?.imageTextOverlays?.[String(selectedImageId)] ??
                null,
            });
          }
          const extracted = localImageIntent.extractText
            ? await creationEditor.extractImageText({
                imageId: selectedImageId,
                rotationDeg,
              })
            : null;
          setImageTextResult({
            imageId: selectedImageId,
            text: extracted?.text ?? "",
            rotated: localImageIntent.rotate180,
          });
          toast.success(
            localImageIntent.extractText
              ? localImageIntent.rotate180
                ? "图片已倒转，文字已提取"
                : "文字已提取"
              : "图片已倒转 180°"
          );
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "图片处理失败");
        } finally {
          setMediaProgress(null);
          resizeAndFocusInput();
        }
        return;
      }
      // 「换成素材里的那个人物」不是文字润色，是要绑资产 + 重画这一镜。
      // 必须排在 sendSelectionEdit 前面，否则会被当成普通选区改写送给 LLM。
      if (assetSwap.arm(text)) {
        setInput("");
        resizeAndFocusInput();
        return;
      }
      setInput("");
      await sendSelectionEdit(text);
      resizeAndFocusInput();
      return;
    }

    if (pendingMedia.length === 0) {
      setInput("");
      await sendMessage(text);
      resizeAndFocusInput();
      return;
    }

    const storyId = creationEditor?.activeStoryId;
    if (!creationEditor || storyId == null || storyId <= 0) {
      toast.error("先打开并保存一个故事，再把素材交给聊聊");
      return;
    }

    const targetShot =
      (activeSelection?.stableShotId
        ? creationEditor.shots.find(
            shot =>
              (shot.stableShotId ?? shot.shotIdentity) ===
              activeSelection.stableShotId
          )
        : null) ??
      creationEditor.selectedShot ??
      creationEditor.shots[0] ??
      null;
    const targetStableShotId = targetShot
      ? (targetShot.stableShotId ?? targetShot.shotIdentity ?? null)
      : null;
    const attachments = [...pendingMedia];
    const imported: Array<
      ImportedChatMedia & { attachment: PendingChatMedia }
    > = [];
    const failures: string[] = [];

    setIsImportingMedia(true);
    setMediaProgress(`正在导入 0 / ${attachments.length}`);
    try {
      for (let index = 0; index < attachments.length; index += 1) {
        const attachment = attachments[index];
        if (attachment.kind === "video" && !targetStableShotId) {
          failures.push(`${attachment.file.name}：请先选一个镜头`);
          continue;
        }
        try {
          const result = await creationEditor.importStoryMaterial({
            fileName: attachment.file.name,
            mimeType: attachment.mimeType,
            fileBase64: await readChatMediaBase64(attachment.file),
            targetStableShotId:
              attachment.kind === "video" ? targetStableShotId : null,
            note:
              text ||
              (attachment.kind === "video"
                ? "从聊聊对话导入，等待继续剪辑"
                : "从聊聊对话导入，等待导演归类"),
          });
          imported.push({
            attachment,
            kind: result.kind,
            fileName: attachment.file.name,
            assetId: result.kind === "image" ? result.imageId : result.takeId,
            imageUrl: result.kind === "image" ? result.imageUrl : undefined,
            targetShotNo:
              result.kind === "video" ? (targetShot?.shotNo ?? null) : null,
            targetCueCode:
              result.kind === "video" ? (targetShot?.cueCode ?? null) : null,
          });
          removePendingMedia(attachment.id);
        } catch (error) {
          failures.push(
            `${attachment.file.name}：${
              error instanceof Error ? error.message : "导入失败"
            }`
          );
        }
        setMediaProgress(`正在导入 ${index + 1} / ${attachments.length}`);
      }

      if (failures.length > 0) {
        toast.error(failures.slice(0, 2).join("；"));
      }
      if (imported.length === 0) return;

      if (imported.some(item => item.kind === "image")) {
        const extraction = await extractImportedPhotoFeatures({
          imported,
          extract: photo => creationEditor.extractPhotoVisualFeatures(photo),
          onProgress: (completed, total) =>
            setMediaProgress(
              `正在提取人物、宠物、场景和物体特征 ${completed} / ${total}`
            ),
        });
        if (extraction.createdKinds.length > 0) {
          const labels = [
            extraction.createdKinds.includes("character") ? "人物" : "",
            extraction.createdKinds.includes("pet") ? "宠物" : "",
            extraction.createdKinds.includes("scene") ? "场景与物体" : "",
          ].filter(Boolean);
          toast.success(
            `已建立待检查的${labels.join("、")}资产；完成标准视图、锁定和绑定后，后续生成会自动关联`
          );
        }
        if (extraction.failures.length > 0) {
          toast.error(
            `${extraction.failures.slice(0, 2).join("；")}。图片已保留在素材库，可稍后重试。`
          );
        }
      }

      if (isImportedImageGenerationRequest({ instruction: text, imported })) {
        const store = chatImageRefsStore.getState();
        store.scopeToStory(storyId);
        for (const ref of buildImportedImageRefs(imported)) {
          const rejected = chatImageRefsStore.getState().toggle(storyId, ref);
          if (rejected) toast.error(rejected);
        }
        const refs = chatImageRefsStore.getState().refs;
        setInput("");
        if (remix.arm(text, refs)) {
          setMediaProgress("参考图已就绪，等待确认生成");
          resizeAndFocusInput();
          return;
        }
      }

      setInput("");
      setMediaProgress("聊聊正在看片并整理归属…");
      let visionPreview: ChatVisionPreview | null = null;
      try {
        visionPreview = await prepareChatVisionPreview(imported[0].attachment);
      } catch (error) {
        console.warn("[StoryAgentChat] 素材代表帧读取失败:", error);
      }
      const prompt = buildImportedMediaPrompt(text, imported);
      const imageIds = imported
        .filter(item => item.kind === "image")
        .map(item => item.assetId);
      const advicePromise =
        imageIds.length > 0
          ? creationEditor.adviseStoryImages({ imageIds })
          : Promise.resolve(null);
      const [, adviceResult] = await Promise.allSettled([
        sendMessage(
          prompt,
          visionPreview?.base64,
          visionPreview?.mimeType ?? "image/jpeg"
        ),
        advicePromise,
      ]);

      if (adviceResult.status === "fulfilled" && adviceResult.value) {
        if (adviceResult.value.status === "ok") {
          setMaterialAdvices(adviceResult.value.advices as MaterialAdvice[]);
        } else {
          toast.error(adviceResult.value.message);
        }
      } else if (adviceResult.status === "rejected") {
        toast.error(
          adviceResult.reason instanceof Error
            ? adviceResult.reason.message
            : "图片归类分析失败"
        );
      }
    } finally {
      setIsImportingMedia(false);
      setMediaProgress(null);
    }
    resizeAndFocusInput();
  };

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // 聊聊头像的情绪回应：消息凝出过卡片就用卡片上识别到的情绪摆姿势。
  // 只让最新一条聊聊消息动起来，历史消息保留姿势但不做动画。
  const lastAssistantId = [...messages]
    .reverse()
    .find(m => m.role === "assistant")?.id;
  const emotionForMessage = (spawnedCardId?: string) =>
    spawnedCardId
      ? cardRefs.find(c => c.id === spawnedCardId)?.emotion
      : undefined;

  return (
    <div
      className="monitor-panel relative h-full flex flex-col"
      onDragEnter={
        interactionMode === "story" ? handleMediaDragEnter : undefined
      }
      onDragOver={interactionMode === "story" ? handleMediaDragOver : undefined}
      onDragLeave={
        interactionMode === "story" ? handleMediaDragLeave : undefined
      }
      onDrop={interactionMode === "story" ? handleMediaDrop : undefined}
      data-testid="story-agent-media-dropzone"
    >
      {interactionMode === "story" && isMediaDragActive ? (
        <div
          className="pointer-events-none absolute inset-2 z-50 flex items-center justify-center rounded-md border-2 border-dashed bg-background/92"
          style={{ borderColor: "var(--nayin-accent)" }}
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <UploadCloud className="h-5 w-5 text-nayin-bright" />
            放入聊聊素材篮
          </div>
        </div>
      ) : null}
      <div
        className={showHeader ? "monitor-panel-header" : "hidden"}
        aria-hidden={!showHeader}
      >
        <button
          type="button"
          onClick={backToList}
          className="flex items-center gap-0.5 text-[10px] opacity-60 hover:opacity-100 transition-opacity mr-1"
          title="返回列表"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <div className="status-dot" />
        <span>聊聊 · 创作对话</span>
        <span className="ml-auto flex items-center gap-2">
          {cardRefs.length > 0 && (
            <span
              className="text-[10px] font-mono px-1.5 py-0.5 rounded-full"
              style={{
                background: "var(--nayin-glow)",
                color: "var(--nayin-accent-bright)",
              }}
            >
              {cardRefs.length} 张卡片
            </span>
          )}
          <span
            className="hidden items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded-full sm:inline-flex"
            style={{
              background: "var(--nayin-glow)",
              color: "var(--nayin-accent-bright)",
            }}
            title={saveTitle}
          >
            {saveStatus === "saving" ? (
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
            ) : (
              <Cloud className="h-2.5 w-2.5" />
            )}
            {saveLabel}
          </span>
          <button
            type="button"
            onClick={resetConversation}
            className="text-[10px] opacity-50 hover:opacity-100 transition-opacity flex items-center gap-1"
            title="开始一个新故事，不删除云端故事库里的旧故事"
          >
            <RefreshCcw className="w-3 h-3" />
            新故事
          </button>
        </span>
      </div>

      <div
        className="border-b px-3 py-2.5"
        style={{ borderColor: "var(--panel-border)" }}
      >
        <section
          className="rounded-md border px-3 py-2"
          style={{
            borderColor: activeSelection
              ? "var(--nayin-accent-dim)"
              : "var(--panel-border)",
            background: activeSelection
              ? "var(--nayin-glow)"
              : "var(--panel-header)",
          }}
          aria-label="聊聊当前上下文"
        >
          <div className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0 text-nayin-bright">
              <Link2 className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5 text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
                <span>当前故事</span>
                <span>·</span>
                <span>{intentLabel(currentIntent)}</span>
              </div>
              {isRenamingTitle ? (
                <div className="mt-1 flex items-center gap-1">
                  <input
                    autoFocus
                    value={titleDraft}
                    maxLength={80}
                    disabled={isSavingTitle}
                    onChange={event => setTitleDraft(event.target.value)}
                    onKeyDown={event => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void saveStoryTitle();
                      } else if (event.key === "Escape") {
                        cancelRenamingTitle();
                      }
                    }}
                    aria-label="故事名称"
                    className="h-7 min-w-0 flex-1 rounded border border-[var(--nayin-accent-dim)] bg-background px-2 text-[12px] font-semibold outline-none ring-2 ring-[var(--nayin-glow)]"
                  />
                  <button
                    type="button"
                    onClick={() => void saveStoryTitle()}
                    disabled={isSavingTitle || !titleDraft.trim()}
                    aria-label="保存故事名称"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-nayin-bright hover:bg-[var(--nayin-glow)] disabled:opacity-40"
                  >
                    {isSavingTitle ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Check className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={cancelRenamingTitle}
                    disabled={isSavingTitle}
                    aria-label="取消修改故事名称"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted disabled:opacity-40"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <div className="mt-0.5 flex min-w-0 items-center gap-1">
                  <p className="truncate text-[12px] font-semibold text-foreground">
                    {storyDisplayTitle}
                  </p>
                  <button
                    type="button"
                    onClick={startRenamingTitle}
                    aria-label="修改故事名称"
                    title="修改故事名称"
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-65 transition hover:bg-[var(--nayin-glow)] hover:text-nayin-bright hover:opacity-100"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                </div>
              )}
              <p className="mt-0.5 truncate text-[10.5px] leading-relaxed text-muted-foreground">
                {storyDisplaySubtitle}
              </p>
            </div>
          </div>
          {activeSelection ? (
            <div className="mt-2">
              <SelectionContextCard selection={activeSelection} compact />
              <p className="mt-1.5 text-[10px] text-muted-foreground">
                下一条消息会带着这个选区交给聊聊。
              </p>
            </div>
          ) : null}
        </section>
      </div>

      <div
        ref={scrollRef}
        className="monitor-panel-body flex-1 overflow-y-auto custom-scrollbar space-y-3 pr-1"
      >
        <AnimatePresence initial={false}>
          {messages.map(m => (
            <motion.div
              key={m.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-[12.5px] leading-relaxed ${
                  m.role === "user" ? "rounded-tr-sm" : "rounded-tl-sm border"
                }`}
                style={
                  m.role === "user"
                    ? {
                        background: "var(--nayin-accent)",
                        color: "var(--background)",
                        boxShadow: "0 1px 8px -2px var(--nayin-glow)",
                      }
                    : {
                        background: "var(--card)",
                        borderColor: "var(--panel-border)",
                        color: "var(--foreground)",
                      }
                }
              >
                {m.role === "assistant" && (
                  <div className="flex items-center gap-1.5 mb-1">
                    <EmotiveWuxingIcon
                      element={element}
                      size={26}
                      emotion={emotionForMessage(m.spawnedCardId)}
                      animated={m.id === lastAssistantId}
                    />
                    <span className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground opacity-80">
                      聊聊
                    </span>
                  </div>
                )}
                {m.selectionQuote && (
                  <div className="mb-1.5">
                    <SelectionContextCard
                      selection={m.selectionQuote}
                      compact
                    />
                  </div>
                )}
                {m.role === "user" && m.photoUrl && (
                  <img
                    src={m.photoUrl}
                    alt="用户上传照片"
                    className={`h-28 max-w-full rounded-xl border border-white/20 object-cover ${
                      m.content.trim() ? "mb-1.5" : ""
                    }`}
                  />
                )}
                {m.content.trim() && (
                  <p
                    className="whitespace-pre-wrap"
                    data-selection-source={`chat:${m.id}`}
                  >
                    {tokenizeChatMessageText(
                      m.role === "assistant"
                        ? displayAssistantName(m.content)
                        : m.content
                    ).map((segment, index) =>
                      segment.emphasis ? (
                        <strong
                          key={`${m.id}:emphasis:${index}`}
                          className="font-semibold"
                        >
                          {segment.text}
                        </strong>
                      ) : (
                        segment.text
                      )
                    )}
                  </p>
                )}
                {m.promptCandidate ? (
                  <div className="mt-2 border-t border-border/60 pt-2">
                    <div className="text-[10px] text-muted-foreground">
                      {m.promptCandidate.label}
                      {m.promptCandidate.status === "pending"
                        ? " · 等待确认"
                        : m.promptCandidate.status === "confirmed"
                          ? " · 已确认"
                          : " · 已拒绝"}
                    </div>
                    {m.promptCandidate.status === "pending" ? (
                      <div className="mt-1.5 flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => void confirmSelectionCandidate(m.id)}
                          className="inline-flex h-7 items-center gap-1 rounded-md bg-[var(--nayin-accent)] px-2 text-[10px] font-medium text-background"
                        >
                          <Check className="h-3 w-3" />
                          确认修改
                        </button>
                        <button
                          type="button"
                          onClick={() => void rejectSelectionCandidate(m.id)}
                          className="inline-flex h-7 items-center rounded-md border border-border px-2 text-[10px] text-muted-foreground"
                        >
                          不采用
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {m.imageRerenderAction &&
                m.promptCandidate?.status !== "rejected" ? (
                  <div className="mt-2 border-t border-border/60 pt-2">
                    <button
                      type="button"
                      disabled={
                        m.promptCandidate?.status === "pending" ||
                        rerenderingMessageId != null
                      }
                      onClick={() =>
                        void handleImageRerender(m.id, m.imageRerenderAction!)
                      }
                      className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--nayin-accent)] px-2.5 text-[11px] font-medium text-background disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      {rerenderingMessageId === m.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCcw className="h-3.5 w-3.5" />
                      )}
                      {m.promptCandidate?.status === "pending"
                        ? "确认修改后可重渲"
                        : `重新渲染 ${
                            m.imageRerenderAction.cueCode ??
                            String(m.imageRerenderAction.shotNo).padStart(
                              4,
                              "0"
                            )
                          }`}
                    </button>
                    <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                      点击后先核对参考帧和预计人民币费用；确认后才提交，旧候选会保留。
                    </p>
                    {rerenderResultByMessageId[m.id] ? (
                      <p
                        className={`mt-1 text-[10px] leading-relaxed ${
                          rerenderResultByMessageId[m.id].status === "error"
                            ? "text-destructive"
                            : rerenderResultByMessageId[m.id].status ===
                                "success"
                              ? "text-emerald-700"
                              : "text-muted-foreground"
                        }`}
                      >
                        {rerenderResultByMessageId[m.id].message}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {m.editingTransitionCandidate ? (
                  <div className="mt-2 border-t border-border/60 pt-2">
                    <EditingTransitionCandidateCard
                      candidate={{
                        sourceShotNo: labelForShot(
                          Number(m.editingTransitionCandidate.source.shotNo),
                          m.editingTransitionCandidate.source.stableShotId
                        ),
                        targetShotNo: labelForShot(
                          Number(m.editingTransitionCandidate.target.shotNo),
                          m.editingTransitionCandidate.target.stableShotId
                        ),
                        firstImageUrl:
                          m.editingTransitionCandidate.source.imageUrl,
                        lastImageUrl:
                          m.editingTransitionCandidate.target.imageUrl,
                        instruction: m.editingTransitionCandidate.instruction,
                        movementAmplitude:
                          m.editingTransitionCandidate.movementAmplitude,
                        prompt: m.editingTransitionCandidate.prompt,
                        durationSec: m.editingTransitionCandidate.durationSec,
                        resolution: m.editingTransitionCandidate.resolution,
                        estimatedCredits:
                          m.editingTransitionCandidate.estimatedCredits,
                        estimatedCny: m.editingTransitionCandidate.estimatedCny,
                        status: m.editingTransitionCandidate.status,
                        error: m.editingTransitionCandidate.error,
                        retryable: m.editingTransitionCandidate.retryable,
                      }}
                      onConfirm={() => confirmEditingTransitionCandidate(m.id)}
                      onReject={() =>
                        void rejectEditingTransitionCandidate(m.id)
                      }
                      onModify={() => {
                        setInput(m.editingTransitionCandidate!.instruction);
                        void rejectEditingTransitionCandidate(m.id);
                        window.requestAnimationFrame(() =>
                          inputRef.current?.focus()
                        );
                      }}
                    />
                  </div>
                ) : null}
                {m.spawnedCardId && (
                  <div
                    className="mt-2 pt-2 border-t flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider"
                    style={{ borderColor: "var(--panel-border)" }}
                  >
                    <Sparkles className="w-3 h-3 text-nayin-bright" />
                    <span className="text-nayin-bright">+ 1 张卡片入册</span>
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {materialAdvices.length > 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex justify-start"
            data-testid="story-agent-material-advice"
          >
            <section
              className="w-[96%] overflow-hidden rounded-lg border bg-card text-foreground"
              style={{ borderColor: "var(--panel-border)" }}
              aria-label="聊聊素材归类建议"
            >
              <header className="flex items-center gap-1.5 px-2.5 py-2">
                <EmotiveWuxingIcon
                  element={element}
                  size={26}
                  mood="thinking"
                />
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold">素材归类建议</p>
                  <p className="text-[9.5px] text-muted-foreground">
                    采纳后才会进入对应镜头
                  </p>
                </div>
              </header>
              {materialAdvices.map(advice => (
                <article
                  key={advice.imageId}
                  className="flex gap-2 border-t px-2.5 py-2"
                  style={{ borderColor: "var(--panel-border)" }}
                >
                  <img
                    src={advice.imageUrl}
                    alt="待归类图片"
                    className="h-11 w-11 shrink-0 rounded object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1 text-[9.5px] font-medium">
                      <span className="text-nayin-bright">
                        {materialAdviceLabel(advice.verdict)}
                      </span>
                      {advice.targetShotNo != null ? (
                        <span className="font-mono text-muted-foreground">
                          {labelForShot(
                            advice.targetShotNo,
                            advice.targetStableShotId
                          )}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-[10.5px] leading-4 text-foreground">
                      {advice.reason}
                    </p>
                    {advice.videoDirection ? (
                      <p className="mt-0.5 truncate text-[9px] text-muted-foreground">
                        {advice.videoDirection.cameraMove || "固定镜头"} ·{" "}
                        {advice.videoDirection.durationSec}s ·{" "}
                        {advice.videoDirection.emotionalTone || "情绪待定"}
                      </p>
                    ) : null}
                    {advice.verdict !== "skip" &&
                    advice.targetShotNo != null &&
                    advice.targetStableShotId ? (
                      <button
                        type="button"
                        onClick={() => void applyMaterialAdvice(advice)}
                        disabled={applyingAdviceImageId != null}
                        className="mt-1.5 inline-flex h-6 items-center gap-1 rounded-md bg-[var(--nayin-accent)] px-2 text-[9.5px] font-medium text-background disabled:opacity-50"
                      >
                        {applyingAdviceImageId === advice.imageId ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Check className="h-3 w-3" />
                        )}
                        放入{" "}
                        {labelForShot(
                          advice.targetShotNo,
                          advice.targetStableShotId
                        )}
                      </button>
                    ) : null}
                  </div>
                </article>
              ))}
            </section>
          </motion.div>
        ) : null}

        {mediaProgress ? (
          <div className="flex justify-start" role="status" aria-live="polite">
            <div
              className="flex items-center gap-2 rounded-lg border px-2.5 py-2 text-[10.5px] text-muted-foreground"
              style={{ borderColor: "var(--panel-border)" }}
            >
              <Loader2 className="h-3.5 w-3.5 animate-spin text-nayin-bright" />
              {mediaProgress}
            </div>
          </div>
        ) : null}

        {showCapabilityMenu && <StoryCapabilityMenu />}
        {showJobIntake && <StoryJobIntakePrompt />}

        {interactionMode === "story" &&
        pendingIntentDraft &&
        proposedNarrativeIntent &&
        !isReplying ? (
          <>
            <PublishingIntentProposalDialog
              presentation="inline"
              open={closedIntentProposalId !== pendingIntentDraft.proposal?.id}
              current={currentNarrativeIntent}
              proposed={proposedNarrativeIntent}
              evidence={pendingIntentDraft.proposal?.evidence ?? pendingIntentDraft.evidence}
              hasPublishingVersion={hasPublishingVersion}
              busy={
                pendingIntentCommitProposalId ===
                pendingIntentDraft.proposal?.id
              }
              acceptLabel={hasPublishingVersion ? "到发布工作区确认新版本" : undefined}
              onOpenChange={open => {
                if (!open && pendingIntentDraft.proposal?.id) {
                  setClosedIntentProposalId(pendingIntentDraft.proposal.id);
                }
              }}
              onAccept={() => {
                if (hasPublishingVersion) {
                  if (onOpenPublishingWorkspace) onOpenPublishingWorkspace();
                  else toast.info("请到发布工作区确认并创建新版本");
                  return;
                }
                confirmPendingIntent();
              }}
              onReject={dismissPendingIntent}
            />
            {closedIntentProposalId === pendingIntentDraft.proposal?.id ? (
              <button
                type="button"
                onClick={() => setClosedIntentProposalId(null)}
                className="self-start rounded-md border px-2.5 py-1.5 text-[11px] text-[var(--nayin-accent)] hover:bg-[var(--nayin-glow)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35"
                style={{ borderColor: "var(--nayin-accent-dim)" }}
              >
                查看用途或观众变化建议
              </button>
            ) : null}
          </>
        ) : null}

        {/* 第二步：老用户点回旧故事时，聊聊「我还记得上次……」的再问候。
            轻染色背景 + 「接着上次聊」分隔线，读起来是「聊聊此刻刚说的」，区别于上面恢复的历史。
            这条只活在内存里，不进 messages、不落库（见 StoryAgentContext）。 */}
        {returningGreeting && !isReplying && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col gap-2"
          >
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <span
                className="flex-1 border-t"
                style={{ borderColor: "var(--panel-border)" }}
              />
              <span className="font-mono uppercase tracking-[0.16em]">
                接着上次聊
              </span>
              <span
                className="flex-1 border-t"
                style={{ borderColor: "var(--panel-border)" }}
              />
            </div>
            <div className="flex justify-start">
              <div
                className="max-w-[85%] rounded-2xl rounded-tl-sm border px-3 py-2 text-[12.5px] leading-relaxed"
                style={{
                  background: "var(--nayin-glow)",
                  borderColor: "var(--nayin-accent-dim)",
                  color: "var(--foreground)",
                }}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  {/* 再见面的问候，用「开心」姿势打招呼 */}
                  <EmotiveWuxingIcon element={element} size={26} mood="joy" />
                  <span className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground opacity-80">
                    聊聊
                  </span>
                </div>
                <p className="whitespace-pre-wrap">{returningGreeting}</p>
              </div>
            </div>
          </motion.div>
        )}

        {isReplying && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex justify-start"
          >
            <div
              className="rounded-2xl rounded-tl-sm px-3 py-2 border flex items-center gap-2"
              style={{
                background: "var(--card)",
                borderColor: "var(--panel-border)",
              }}
            >
              {/* 回复中：托腮思考的姿势 */}
              <EmotiveWuxingIcon element={element} size={26} mood="thinking" />
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-nayin animate-pulse" />
                <span
                  className="w-1.5 h-1.5 rounded-full bg-nayin animate-pulse"
                  style={{ animationDelay: "0.15s" }}
                />
                <span
                  className="w-1.5 h-1.5 rounded-full bg-nayin animate-pulse"
                  style={{ animationDelay: "0.3s" }}
                />
              </div>
            </div>
          </motion.div>
        )}
      </div>

      {/* Input */}
      <div
        className="border-t px-3 pb-3 flex flex-col gap-2"
        style={{ borderColor: "var(--panel-border)" }}
      >
        {interactionMode === "publishing" ? (
          <div className="pt-2.5">
            <PublishingPlatformPicker compact />
          </div>
        ) : null}
        {/* Quote block */}
        {interactionMode === "story" && activeSelection && (
          <div className="mt-2.5">
            <SelectionContextCard
              selection={activeSelection}
              onClear={clearSelection}
            />
          </div>
        )}

        {interactionMode === "story" ? <ChatImageRemixTray remix={remix} /> : null}
        {interactionMode === "story" && imageTextResult ? (
          <article
            className="mt-1.5 rounded-md border border-border bg-background px-2.5 py-2"
            aria-label="图片本地编辑结果"
            data-testid="chat-image-local-edit-result"
          >
            <div className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
              {imageTextResult.rotated ? (
                <RotateCw className="h-3 w-3" />
              ) : (
                <ScanText className="h-3 w-3" />
              )}
              <span>
                图片 #{imageTextResult.imageId}
                {imageTextResult.rotated ? " · 已倒转 180°" : ""}
              </span>
              <button
                type="button"
                onClick={() => setImageTextResult(null)}
                className="ml-auto rounded p-1 hover:bg-muted"
                aria-label="关闭图片处理结果"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
            {imageTextResult.text ? (
              <>
                <textarea
                  value={imageTextResult.text}
                  onChange={event =>
                    setImageTextResult(current =>
                      current ? { ...current, text: event.target.value } : current
                    )
                  }
                  rows={5}
                  aria-label="聊天框 OCR 识别结果"
                  className="mt-2 w-full resize-y rounded-md border border-border bg-muted/20 px-2.5 py-2 text-[11px] leading-5 outline-none focus:border-[var(--nayin-accent)]"
                />
                <button
                  type="button"
                  onClick={() =>
                    void navigator.clipboard.writeText(imageTextResult.text)
                  }
                  className="mt-1.5 inline-flex items-center gap-1 rounded px-2 py-1 text-[9.5px] text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <Copy className="h-3 w-3" />
                  复制文字
                </button>
              </>
            ) : (
              <p className="mt-1.5 text-[10px] text-muted-foreground">
                {imageTextResult.rotated ? "构图变换已保存。" : "没有识别到文字。"}
              </p>
            )}
          </article>
        ) : null}
        {interactionMode === "story" ? (
          <AssetSwapProposalCard swap={assetSwap} />
        ) : null}

        {interactionMode === "story" && pendingMedia.length > 0 ? (
          <div
            className={`min-w-0 ${!activeSelection ? "mt-2.5" : "mt-1.5"}`}
            data-testid="story-agent-media-tray"
          >
            <div className="flex gap-1.5 overflow-x-auto pb-1 custom-scrollbar">
              {pendingMedia.map(attachment => (
                <figure
                  key={attachment.id}
                  className="group relative h-13 w-13 shrink-0 overflow-hidden rounded-md bg-muted"
                  title={`${attachment.file.name} · ${formatBytes(attachment.file.size)}`}
                >
                  {attachment.kind === "image" ? (
                    <img
                      src={attachment.previewUrl}
                      alt={attachment.file.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <video
                      src={attachment.previewUrl}
                      aria-label={attachment.file.name}
                      className="h-full w-full object-cover"
                      muted
                      playsInline
                      preload="metadata"
                    />
                  )}
                  <span className="absolute bottom-1 left-1 flex h-4 w-4 items-center justify-center rounded bg-black/65 text-white">
                    {attachment.kind === "image" ? (
                      <ImageIcon className="h-2.5 w-2.5" />
                    ) : (
                      <Video className="h-2.5 w-2.5" />
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => removePendingMedia(attachment.id)}
                    disabled={isImportingMedia}
                    className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded bg-black/65 text-white opacity-85 transition-opacity hover:opacity-100 disabled:opacity-40"
                    aria-label={`移除 ${attachment.file.name}`}
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </figure>
              ))}
            </div>
            <p className="mt-0.5 truncate text-[9.5px] text-muted-foreground">
              {pendingMedia.length} 个素材 · 图片分析归类 · 视频暂放当前镜头
            </p>
          </div>
        ) : null}

        {voice.isBusy && (
          <div
            className={`flex items-center gap-1.5 text-[10px] ${!activeSelection && pendingMedia.length === 0 ? "mt-2.5" : "mt-1.5"}`}
            style={{ color: "var(--nayin-accent-bright)" }}
          >
            {voice.isRecording ? (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-nayin animate-pulse" />
                录音中，再点方块停止
              </>
            ) : (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                正在把声音转成文字…
              </>
            )}
          </div>
        )}

        <div
          className={`flex items-end gap-2 ${!activeSelection && pendingMedia.length === 0 ? "pt-2.5" : "pt-1.5"}`}
        >
          {interactionMode === "story" ? (
            <>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isReplying || voice.isBusy || isImportingMedia}
                className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                aria-label="添加图片或视频"
                title="添加图片或视频"
              >
                <Paperclip className="w-4 h-4" />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*"
                multiple
                className="hidden"
                onChange={handleMediaSelect}
              />
            </>
          ) : null}
          <button
            type="button"
            onClick={voice.toggleRecording}
            disabled={isReplying || voice.isTranscribing || isImportingMedia}
            className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
            style={
              voice.isRecording
                ? {
                    background: "var(--nayin-glow)",
                    color: "var(--nayin-accent-bright)",
                  }
                : undefined
            }
            aria-label={voice.isRecording ? "停止录音" : "开始录音"}
            title={voice.isRecording ? "停止录音" : "语音输入"}
          >
            {voice.isTranscribing ? (
              <TranscribingGlyph />
            ) : voice.isRecording ? (
              <RecordingGlyph />
            ) : (
              <Mic className="w-4 h-4" />
            )}
          </button>
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={e => {
              setInput(e.target.value);
              // auto-resize
              const ta = e.currentTarget;
              ta.style.height = "auto";
              ta.style.height = `${Math.min(ta.scrollHeight, 96)}px`;
            }}
            onKeyDown={handleKey}
            placeholder={inputPlaceholder}
            disabled={isReplying || isImportingMedia}
            className="flex-1 resize-none rounded-lg border px-3 py-2 text-xs leading-relaxed bg-transparent focus:outline-none focus:ring-2 transition-shadow disabled:opacity-60"
            style={{
              borderColor: "var(--panel-border)",
              // @ts-expect-error custom prop for tailwind ring color via inline style
              "--tw-ring-color": "var(--nayin-accent)",
            }}
          />
          <button
            type="button"
            onClick={handleSubmit}
            disabled={
              (!input.trim() &&
                (interactionMode === "publishing" ||
                  pendingMedia.length === 0)) ||
              isReplying ||
              voice.isBusy ||
              isImportingMedia
            }
            className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:shadow-nayin"
            style={{
              background: "var(--nayin-accent)",
              color: "var(--background)",
              boxShadow: "0 2px 12px -4px var(--nayin-glow)",
            }}
            aria-label="发送"
          >
            {isReplying || isImportingMedia ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
