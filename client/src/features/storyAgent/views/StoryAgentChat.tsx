import { useTimelineFeedbackLocation } from "../useTimelineFeedbackLocation";
import { focusFeedbackQuote, isFeedbackQuote, locateTimelineFeedback } from "../timelineFeedbackLocation";
import { keyframeGroupEdit } from "../keyframeGroupEdit";
import { KeyframePlanDisclosure } from "./KeyframePlanDisclosure";
import { shotKeyframeBeats, keyframeChatTurns, orderedKeyframeRefs, reviewedKeyframeTarget, openKeyframeReview, keyframeApproval, matchingKeyframeReview } from "../shotKeyframeBrief";
import { ChatComposerDock } from "./ChatComposerDock";
import { prepareKeyframeScan, scannedEditPlan } from "../keyframeRegionScan";
import { ChatImageRegionHover } from "./ChatImageRegionHover";
import { chatPictureParts, pictureRegionLabel, pictureRegionNote, withoutPictureRegionNotes, type PictureRegion } from "@shared/chatPictureRegion";
import { InlineChatComposer, type InlineChatComposerHandle } from "./InlineChatComposer";
import { composerImages } from "./imageGenerationDraft";
import { ChatImageReferenceChip } from "./ChatImageReferenceChip";
import { ChatPhotoPreview } from "./ChatPhotoPreview";
import { ChatVideoCuePlan } from "./ChatVideoCuePlan";
import { cueReplyId, cueReferences, cueTarget, currentCueTurn, requestsVideoCues, reviewTakeId, priorObjectOrigin, originLine } from "../videoCueDraft";
import { NextShotDraftButton } from "./NextShotDraftButton";
import { useLocalVideoFeedback } from "../useLocalVideoFeedback";
import { localNotePrefix, localReplyPrefix, looksLikeVideoFeedback, sameVideoDirection, startingLocalFeedback } from "@shared/localVideoFeedback";
import { VideoTakeChatReview } from "./VideoTakeChatReview";
import { VideoFeedbackActivity } from "./VideoFeedbackActivity";
import { feedbackActivityId, isFeedbackActivityId } from "@shared/videoFeedbackActivity";
import { ChatImageEditBatch } from './ChatImageEditBatch';
import { SourceReviewedPlanCard as ChatImageEditPlanCard } from './SourceReviewedPlanCard';
import { imageEditPlanQuote, createChatImageEditPlan, localEraseReceiptId, imageEditPlanReply, imageEditPlanOutput, confirmedImageEditPlanId, adjustedImageEditPlanId } from '@shared/chatImageEditPlan';
import { imageEditGenerationError, type ImageEditPurchase } from '../imageEditPurchase';
import { isImageObjectRemoval } from '@shared/imageObjectRemoval';
import { hasInlineChatImages, inlineImageToken } from "@shared/inlineChatImages";
import { compileInlineChatDraft, continueInlineImageEdit, referenceWarehouseSelection, selectedRegionReply } from "../inlineChatDraft";
import { readWarehouseChatSelection } from "@/features/creationEditor/warehouseChatSelection";
import { estimateStoryboardMaskedEditCost } from "@shared/imageRenderCost";
import { useStudioDraftState } from "../studioDraftState";
import { trpc } from "@/lib/trpc";
import { isStudioAssistantRequest, studioConfirmation } from "@shared/studioAssistant";
import { FrameReviewRecovery } from "./FrameReviewRecovery";
import { cloudShapeDecision, isCloudAppearanceEdit, isFrameRegionChat, isFrameRegionReviewImage, latestFrameRegionReview, regionReviewDecision, regionInheritanceDecision } from "@shared/frameRegionReview";
import { useFrameRegionReviewChat } from "../useFrameRegionReviewChat";
import { ChatFrameRegionReview } from "./ChatFrameRegionReview";
import { usePausedFrameChat } from "../usePausedFrameChat";
import { useShotSplitChat } from "../useShotSplitChat";
import { useShotContentChat } from "../useShotContentChat";
import { warehouseFileChatIds, warehouseFileChatRequest, WAREHOUSE_FILE_CHAT_EVENT } from "@shared/warehouseFiles";
import { parseVisualUnderstandingChat } from "@shared/visualEditUnderstanding";
import { explicitReferenceShotNumber, isFrameReferenceChat, usesPausedFrame } from "@shared/chatFrameReference";
import { ChatFrameReferences } from "./ChatFrameReferences";
import { parseCreationEmotionChat } from "@shared/creationEmotionChat";
import { WarehouseCompletionNotice } from "@/features/creationEditor/views/WarehouseShotGroups";
import { openShotWarehouse, shotExplicitImageIds } from "@/features/creationEditor/warehouseShotMedia";
import { conversationWarehouseShot, isShotConversationNavigation, shotConversationMessages, shotConversationSelection, resolveConversationShot, hasConversationShotReference, isShotConversationQuestion } from "../shotConversation";
import { focusShotChat, SHOT_CHAT_FOCUS_EVENT } from "../shotChatFocus";
import { recoverConversationTarget } from "../conversationTargetRecovery";
import { parseImageRevisionDecision } from "@shared/chatImageRevision";
import { parseColorTransferIntent } from "@shared/colorTransferIntent";
import { parseLuminanceGradeIntent } from "@shared/luminanceGradeIntent";
import { parseRegionalGradeIntent } from "@shared/regionalGradeIntent";
import { ChatImageRevisionGallery, ChatImageRevisionCards } from "./ChatImageRevisionGallery";
import { chatRevisionSlots } from "../chatRevisionOrder";
import { parseArtSystemChat } from "@shared/artSystemChat";
import { parseArtPreviewChat } from "@shared/artPreview";
import { ArtPreviewGallery } from "./ArtPreviewGallery";
import { storySpineStore } from "../spine/storySpine";
import { useBookVideoWorkspace } from "@/features/bookVideo/BookVideoWorkspace";
import { parseSoundChat } from "@shared/soundChat";
import { parseVisualProductionChat, usesSelectedImageRevision } from "@shared/visualProductionChat";
import { mediaChatQuestionStore, answerMediaChatQuestion, cancelMediaChatSession } from "../mediaChatSession";
import { selectionBelongsToStory } from "../selectionStoryScope";
import { useUiText as useDesktopUiText, useUiLanguage } from "@/features/uiLanguage/UiLanguage";
import { findReviewImageFrame, frameLocationLabel } from "../frameRegionPresentation";
import { focusWarehouseConversation, useWarehouseConversationFocus } from "@/features/creationEditor/warehouseConversationFocus";
import { BookVideoChat, type BookVideoChatHandle } from "@/features/bookVideo/BookVideoChat";
import { useBookVideoSession } from "@/features/bookVideo/bookVideoSession";
import { BookMediaChat, type BookMediaChatHandle } from "@/features/publishingAlbum/BookMediaChat";
import { useBookMediaSession } from "@/features/publishingAlbum/bookMediaSession";
import { useBookModuleActions } from '@/features/publishingAlbum/bookModuleActions';
import { useBookImageCompositionSession } from '@/features/publishingAlbum/bookImageCompositionSession';
import { type BookImageCompositionHandle } from '@/features/publishingAlbum/BookImageCompositionChat';
import { BookImageCompositionHistory } from '@/features/publishingAlbum/BookImageCompositionHistory';
import { isBookImageCreationIntent } from '@shared/bookImageComposition';
import { BookRewriteButton } from '@/features/publishingAlbum/BookRewriteButton';
import { bookRewriteChatSnapshot } from '@/features/publishingAlbum/bookRewriteChat';
import { useContext } from "react";
import { useIsMutating, useMutationState } from "@tanstack/react-query";
import { DesktopStoryMenuContext } from "@/app/shell/DesktopStoryMenuContext";
import StoryLogoMenu from "@/app/shell/StoryLogoMenu";
import { creativeVersionIntent } from "@shared/creativeVersionIntent";
/**
 * StoryAgentChat — Conversational guide that surfaces specific, sensory
 * memories and condenses them into story cards.
 *
 * Sits in the DROP ZONE slot of the analysis page.
 */
import {
  Fragment,
  useEffect,
  useRef,
  useState,
  useMemo,
  useCallback,
  type KeyboardEvent,
  type DragEvent,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTwoImageChat } from "../useTwoImageChat";
import { rejectsBothImageCandidates, selectedImageFrameRole, twoImageReply } from "../twoImageChat";
import { formatComputeQuote } from "@shared/computeMoney";
import { isPhotoSaveOnlyReply, PHOTO_EXTRACTION_QUESTION } from "@shared/photoExtraction";
import { chatPhotoSubmissionAction, isVideoImageEditRequest } from "../chatMediaAttachments";
import {
  Send,
  Sparkles,
  RefreshCcw,
  Loader2,
  ChevronLeft,
  X,
  Image as ImageIcon,
  UploadCloud,
  Video,
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
import StoryCoverThumbnail from "./StoryCoverThumbnail";
import ChatAssistantAvatar from "./ChatAssistantAvatar";
import { ChatCompanionStatus } from "./ChatCompanionStatus";
import { scrollToLatestChatTurn } from "../chatMessageScroll";
import StoryChatContents from "./StoryChatContents";
import { useDesktopChatQueue } from "../useDesktopChatQueue";
import { useDesktopWritingSession } from "@/features/writingCompanion/desktopWritingSession";
import { layoutModuleLabel } from "@shared/layoutModuleContext";
import { LayoutMemoryDetails } from "@/features/publishingAlbum/LayoutMemoryDetails";
import { useStorySpine } from "../spine/storySpine";
import { TextDraftVersions } from "@/features/publishingDraft/TextDraftVersions";
import { StudioCreateMenu } from "@/features/publishingDraft/StudioCreateMenu";
import { stripAssistantReasoning } from "@shared/assistantReplyText";
import { requestMemoryCard } from "@/features/memoryWarehouse/memoryWarehouseEvents";
import {
  displayAssistantName,
  type ChatMessage,
  type StoryboardImageRerenderActionReference,
} from "@/features/storyAgent/types";
import { useNayin } from "@/features/nayin/NayinContext";
import EmotiveWuxingIcon from "@/features/nayin/views/EmotiveWuxingIcon";
import { useVoiceInput } from "@/features/storyAgent/hooks/useVoiceInput";
import { ChatVoiceOptions } from "./ChatVoiceOptions";
import { ChatComposerTools } from "./ChatComposerTools";
import { formatBytes, optimizeImageForUpload } from "@/lib/imageUpload";
import PublishingPlatformPicker from "@/features/publishingDraft/PublishingPlatformPicker";
import StoryJobIntakePrompt, { getJobIntakeStep } from "./StoryJobIntakePrompt";
import SelectionContextCard from "./SelectionContextCard";
import { ShotChatInspector } from "./ShotChatInspector";
import ChatImageRemixTray from "./ChatImageRemixTray";
import { ChatImageEditRecovery } from './ChatImageEditRecovery';
import { failedImageEditRecovery, quotedImageEditRecovery, recoveredImageEditQuoteMessages } from '../failedImageEditRecovery';
import type { PhotoAssetRequest } from "./ChatPhotoAssets";
import AssetSwapProposalCard from "./AssetSwapProposalCard";
import { useAssetSwapProposal } from "../useAssetSwapProposal";
import { useCreationFlowChat } from "../useCreationFlowChat";
import { chatImageRefsStore } from "../chatImageRefsStore";
import { storyboardFrameRoleGenerationParams, storyboardShotFrameImages } from "./storyboardReviewModel";
import { explicitImageFrameRole, resolveExplicitFrameRole } from "../chatFrameRole";
import { useChatImageRemix } from "../useChatImageRemix";
import { routeSelectionSubmission } from "../selectionSubmissionRouter";
import { selectionReadiness } from "@shared/selectionContext";
import EditingTransitionCandidateCard from "../components/EditingTransitionCandidateCard";
import {
  loadStoryConversationDraft,
  saveStoryConversationDraft,
} from "../storyConversationStore";
import { tokenizeChatMessageText } from "../chatMessageFormat";
import { BookFormattedText } from "@/features/publishingAlbum/BookMathText";
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
  isPhotoAssetRequest,
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
import { SoundDirectorQuestionCard } from "@/features/creationEditor/soundDirector/SoundDirectorQuestionCard";
import { SoundPlanTable } from "@/features/creationEditor/soundDirector/SoundPlanTable";
import {
  shouldRouteChatToSoundDirector,
  useStorySoundDirector,
} from "@/features/creationEditor/soundDirector/useStorySoundDirector";

type OpenCreationChatDetail = {
  imageId?: number;
  stableShotId?: string | null;
  storyId?: number;
  draftMessage?: string;
  preserveSelection?: boolean;
  autoSubmit?: boolean;
  focusComposer?: boolean;
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

  if (attachment.kind === "file") return null;
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
  workspaceContext,
  showHeader = true,
  interactionMode = "story",
  onOpenPublishingWorkspace,
  showCreationActions = false,
}: {
  workspaceContext?: "book" | "video";
  showHeader?: boolean;
  interactionMode?: "story" | "publishing";
  onOpenPublishingWorkspace?: () => void;
  showCreationActions?: boolean;
}) {
  const _ui = useDesktopUiText();
  const { language } = useUiLanguage();
  const hasStudioShots = useStorySpine(state => state.storyShots.length > 0);
  const { element, visualTheme } = useNayin();
  const desktopStoryMenu = useContext(DesktopStoryMenuContext);

  const {
    messages,
    cardRefs,
    isReplying,
    activeStoryId,
    remoteStoryId,
    storyTitle,
    activeStoryCoverImageUrl,
    saveStatus,
    lastSavedAt,
    returningGreeting,
    confirmedIntent,
    pendingIntentDraft,
    pendingIntentCommitProposalId,
    publishing,
    activeSelection,
  } = useStoryAgentChatSlice();
  const cuttingWord = useIsMutating({ predicate: mutation =>
    (mutation.state.variables as { storyId?: number } | undefined)?.storyId === activeStoryId &&
    JSON.stringify(mutation.options.mutationKey ?? []).includes('"cutWordTiming"')
  }) > 0;
  const cutProgress = cuttingWord ? _ui("正在剪画面，正在对齐屏幕文字和原旁白…") : undefined;
  const generatingCount = useIsMutating({ predicate: mutation => {
    const route = JSON.stringify(mutation.options.mutationKey ?? []);
    const input = mutation.state.variables as { storyId?: number } | undefined;
    return input?.storyId === activeStoryId && /writingCompanionCompose|generate|render|Generate|Render/.test(route);
  } });
  const frameImageRevisions = trpc.storyAgent.chatImageRevisions.useQuery(
    { storyId: activeStoryId ?? 0 },
    { enabled: workspaceContext === "video" && Boolean(activeStoryId && activeStoryId > 0), refetchInterval: workspaceContext === "video" ? 5000 : false }
  );
  const pendingCloudRequests = useMutationState({
    filters: { status: "pending", predicate: mutation =>
      (mutation.state.variables as { storyId?: number } | undefined)?.storyId === activeStoryId &&
      JSON.stringify(mutation.options.mutationKey ?? []).includes('"generateCloud"') },
    select: mutation => (mutation.state.variables as { requestId: string }).requestId,
  });
  const {
    sendMessage,
    loadStory,
    resetConversation,
    backToList,
    confirmPendingIntent,
    dismissPendingIntent,
    clearSelection,
    setActiveSelection,
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
  // The conversation follows its explicit quote. Commands can still read
  // the live playhead selection when the user sends a message.
  const creationEditor = useOptionalCreationEditor({ observeShotSelection: false });
  useStudioDraftState(activeStoryId, Boolean(creationEditor?.isSaving || creationEditor?.timelineWritePending));
  const creationFlow = useCreationFlowChat(creationEditor?.refetch, Boolean(creationEditor?.isSaving || creationEditor?.timelineWritePending));
  const soundDirector = useStorySoundDirector(
    creationEditor?.activeStoryId ?? remoteStoryId ?? activeStoryId ?? null
  );
  const writingSource = useDesktopWritingSession(state => state.session);
  const accountId = useStorySpine(state => state.accountId);
  const storyList = useStorySpine(state => state.storyList);
  const feedbackLoadEpoch = useStorySpine(state => state.storyLoadEpoch);
  const scopeEpoch = useStorySpine(state => state.storyScopeEpoch);
  const writingSession = workspaceContext !== "video" && writingSource?.storyId === activeStoryId && writingSource.accountId === accountId && writingSource.epoch === scopeEpoch
    ? writingSource : null;
  const bookMediaSource = useBookMediaSession(state => state.session);
  const compositionSource = useBookImageCompositionSession(state => state.session);
  const composition = compositionSource?.storyId === activeStoryId && compositionSource.accountId === accountId && compositionSource.epoch === scopeEpoch && writingSession?.snapshot.scope === compositionSource.scope ? compositionSource : null;
  const compositionHandle = useRef<BookImageCompositionHandle | null>(null);
  const bookMedia = workspaceContext !== "video" && !composition && bookMediaSource?.storyId === activeStoryId && bookMediaSource.accountId === accountId && bookMediaSource.epoch === scopeEpoch ? bookMediaSource : null;
  const bookMediaHandle = useRef<BookMediaChatHandle | null>(null);
  const videoSource=useBookVideoSession(state=>state.session);
  const bookVideo=videoSource?.storyId===activeStoryId&&videoSource.accountId===accountId&&videoSource.epoch===scopeEpoch?videoSource:null;
  const videoWorkspace = useBookVideoWorkspace();
  const discussingBookVideo = Boolean(bookVideo && (workspaceContext !== "video" || videoWorkspace?.reviewRequested));
  const bookVideoHandle=useRef<BookVideoChatHandle|null>(null);
  const videoProgressScope = `${accountId}:${activeStoryId}:${scopeEpoch}`;
  const [videoProgressState, setVideoProgressState] = useState({ scope: "", message: "" });
  const onVideoProgressChange = useCallback((message: string) => {
    setVideoProgressState({ scope: videoProgressScope, message });
  }, [videoProgressScope]);
  const videoProgress = videoProgressState.scope === videoProgressScope ? videoProgressState.message : "";
  useEffect(() => { if (composition) requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })); }, [composition]);
  useEffect(() => { if (bookVideo) useBookImageCompositionSession.getState().setSession(null); }, [bookVideo]);
  useEffect(()=>{if(bookMedia && bookVideo) useBookVideoSession.getState().setSession(null)},[bookMedia,bookVideo]);
  useEffect(()=>{if(bookVideo) requestAnimationFrame(()=>scrollRef.current?.scrollTo({top:scrollRef.current.scrollHeight,behavior:"smooth"}))},[bookVideo]);
  const layoutContext = Boolean(writingSession?.snapshot.module || writingSession?.snapshot.layoutMemory);
  const chatQueue = useDesktopChatQueue({
    blocked: isReplying || creationFlow.busy || (soundDirector.active && !layoutContext),
    run: async item => {
      if (item.selection) {
        await sendSelectionEdit(item.text, { selection: item.selection, clientMessageId: item.id, imageProvider: item.imageProvider });
        return true;
      }
      return sendMessage(item.text, undefined, undefined, { clientMessageId: item.id, writingContext: item.writingContext, workspaceContext: item.workspaceContext, selection: item.productionSelection ?? null });
    },
  });
  const activeSelectionReadiness = activeSelection
    ? selectionReadiness(
        activeSelection,
        creationEditor?.activeStoryId ?? remoteStoryId ?? null
      )
    : undefined;
  const remix = useChatImageRemix(
    creationEditor?.activeStoryId ?? remoteStoryId ?? null
  );
  const twoImages = useTwoImageChat({
    storyId: creationEditor?.activeStoryId ?? remoteStoryId ?? null, accountId,
    adopt: async (imageId, targetStableShotId) => {
      if (!creationEditor) throw new Error("镜头尚未加载");
      await creationEditor.assignStoryImageToShot({ imageId, targetStableShotId });
    },
  });
  const [closedShotHistory, setClosedShotHistory] = useState<string | null>(null);
  const [shotFocusRevision, setShotFocusRevision] = useState(0);
  const recoveredConversationScope = useRef("");
  useEffect(() => {
    if (workspaceContext !== "video" || !accountId || !activeStoryId ||
      creationEditor?.activeStoryId !== activeStoryId || creationEditor.isLoading ||
      creationEditor.materialState?.storyId !== activeStoryId || !messages.length) return;
    const scope = `${accountId}:${activeStoryId}:${scopeEpoch}`;
    if (recoveredConversationScope.current === scope) return;
    recoveredConversationScope.current = scope;
    if (activeSelection) return; // A fresh click or explicit clear always wins.
    const target = recoverConversationTarget({ storyId: activeStoryId, messages,
      shots: creationEditor.shots, materialState: creationEditor.materialState });
    if (target) {
      setActiveSelection(target);
      setClosedShotHistory(`${activeStoryId}:${target.stableShotId}`);
    }
  }, [accountId, activeStoryId, scopeEpoch, workspaceContext, creationEditor?.activeStoryId,
    creationEditor?.isLoading, creationEditor?.materialState, creationEditor?.shots, messages, activeSelection, setActiveSelection]);
  const openConversationShot = (stableShotId: string) => {
    const shot = creationEditor?.shots.find(s => (s.stableShotId ?? s.shotIdentity) === stableShotId);
    if (!shot || !activeStoryId) return;
    setClosedShotHistory(null);
    setActiveSelection(shotConversationSelection(activeStoryId, shot));
    focusShotChat(activeStoryId, stableShotId);
  };
  const selectConversationImage = (image: { imageId: number; imageUrl: string; shotNo: number; stableShotId: string }, forFeedback = false) => {
    if (!activeStoryId) return;
    setClosedShotHistory(forFeedback ? `${activeStoryId}:${image.stableShotId}` : null);
    setActiveSelection({ sourceType: "storyboard-image", sourceId: String(image.imageId),
      storyId: activeStoryId, imageId: image.imageId, shotNo: image.shotNo,
      stableShotId: image.stableShotId, cueCode: creationEditor?.shots.find(shot => (shot.stableShotId ?? shot.shotIdentity) === image.stableShotId)?.cueCode, selectedText: `图片 #${image.imageId}`,
      fullText: `图片 #${image.imageId}`, objectVersion: `image:${image.imageId}`,
      materialStatus: "candidate-image" });
    if (forFeedback) focusInput();
  };
  const libraryQuery = trpc.useUtils().storyAgent.storyMaterialState;
  const pendingImageClick = useRef(0);
  async function referenceChatImage(imageId: number, stableShotId?: string | null, note?: string) {
    if (!activeStoryId || workspaceContext !== "video" || creationEditor?.materialState?.storyId !== activeStoryId ||
        storySpineStore.getState().activeStoryId !== activeStoryId) return;
    const click = ++pendingImageClick.current;
    let image = inlineImagesRef.current.find(item => item.imageId === imageId);
    if (!image) {
      const selected = storySpineStore.getState().activeSelection;
      try {
        const state = await libraryQuery.fetch({ storyId: activeStoryId }, { staleTime: 0 });
        if (click !== pendingImageClick.current || storySpineStore.getState().accountId !== accountId ||
            storySpineStore.getState().activeStoryId !== activeStoryId ||
            storySpineStore.getState().activeSelection !== selected) return;
        if (state?.storyId === activeStoryId) image = composerImages(state, language).find(item => item.imageId === imageId);
      } catch { toast.error("仓库读取失败，请重试"); return; }
      if (!image) { toast.info("这张图片在当前故事中不可用"); return; }
    }
    if (!inlineInputRef.current?.insert(image, note)) return;
    const origins = image.image?.libraryShotIds ?? [];
    const source = stableShotId ?? image.image?.shotIdentity ?? (origins.length === 1 ? origins[0] : null);
    const shot = source && creationEditor.shots.find(row => (row.stableShotId ?? row.shotIdentity) === source);
    const selected = storySpineStore.getState().activeSelection;
    if (selected?.storyId === activeStoryId && selected.imageId === imageId &&
        (selected.stableShotId ?? null) === (shot ? source : null)) return;
    if (shot && source) {
      selectConversationImage({ imageId, imageUrl: image.imageUrl, shotNo: shot.shotNo, stableShotId: source });
    } else {
      setActiveSelection({ sourceType: "storyboard-image", sourceId: String(imageId), storyId: activeStoryId,
        imageId, selectedText: `图片 #${imageId}`, fullText: `图片 #${imageId}`, objectVersion: `image:${imageId}`, materialStatus: "candidate-image" });
    }
  }
  const referenceImageHandler = useRef(referenceChatImage);
  referenceImageHandler.current = referenceChatImage;
  const referenceCandidate = (image: { imageId: number; stableShotId: string; storyId?: number }) => {
    if (image.storyId == null || image.storyId === activeStoryId) referenceChatImage(image.imageId, image.stableShotId);
  };
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
  function currentShotQuote(quote: NonNullable<ChatMessage["selectionQuote"]>) {
    const shot = quote.storyId === activeStoryId && quote.stableShotId
      ? creationEditor?.shots.find(row => (row.stableShotId ?? row.shotIdentity) === quote.stableShotId) : undefined;
    return shot ? { ...quote, shotNo: shot.shotNo, cueCode: shot.cueCode } : quote;
  }
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
  const [input, setInput] = useState("");
  const [busyImageBatch, setBusyImageBatch] = useState<string | null>(null);
  const [imageEditPurchase, setImageEditPurchase] = useState<ImageEditPurchase | null>(null);
  useEffect(() => { setImageEditPurchase(null); }, [activeStoryId]);
  const latestInlineTurn = [...messages].reverse().find(message => message.role === "assistant" && (message.imageEditPlan || message.imageRevision || /^已收到 \d 张引用/.test(message.content)));
  const inlineQuoteMessage = latestInlineTurn?.imageRevision || latestInlineTurn?.imageEditPlan ? undefined : latestInlineTurn;
  const inlineQuoteRequest = inlineQuoteMessage ? [...messages.slice(0, messages.findIndex(message => message.id === inlineQuoteMessage.id))].reverse().find(message => message.role === "user" && hasInlineChatImages(message.content))?.content : undefined;
  const remixMessage = useRef<{ storyId: number; quoteId: string; selection: typeof activeSelection } | null>(null);
  const recoveryAttempt = useRef("");
  useEffect(() => {
    if (workspaceContext !== "video" || !activeStoryId || !inlineQuoteMessage || creationEditor?.isLoading || !messages.length || remix.status !== "idle") return;
    const key = `${accountId}:${activeStoryId}:${inlineQuoteMessage.id}`;
    if (recoveryAttempt.current === key) return;
    recoveryAttempt.current = key;
    remixMessage.current = { storyId: activeStoryId, quoteId: inlineQuoteMessage.id, selection: storySpineStore.getState().activeSelection };
    void remix.restore(inlineQuoteMessage.id);
  }, [accountId, activeStoryId, workspaceContext, inlineQuoteMessage?.id, creationEditor?.isLoading, messages.length, remix.status, remix.restore]);
  useEffect(() => {
    const result = remix.result;
    const pending = remixMessage.current;
    if (!result?.target || !activeStoryId || pending?.storyId !== activeStoryId) return;
    remixMessage.current = null;
    const imageRevision = { storyId: activeStoryId, stableShotId: result.target.stableShotId, shotNo: result.target.shotNo, imageId: result.imageId, imageUrl: result.imageUrl };
    storySpineStore.getState().setMessages(current => [...current.map(message => message.id === pending.quoteId ? {
      ...message, content: "图片修改已完成，结果见下方。",
    } : message), { id: `remix-result:${pending.quoteId}`, role: "assistant", timestamp: Date.now(), imageRevision,
      content: `新图 #${result.imageId} 已保存到仓库，可继续输入修改要求。尚未替换剪辑。实际扣费：尚无结算回执。` }]);
    // Only advance the chat subject if the user has not clicked another subject while waiting.
    if (storySpineStore.getState().activeSelection === pending.selection) {
      selectConversationImage(imageRevision);
      setClosedShotHistory(`${activeStoryId}:${imageRevision.stableShotId}`);
    }
  }, [remix.result, activeStoryId]);
  const [voicePreview, setVoicePreview] = useState("");
  const feedbackClock = useTimelineFeedbackLocation(workspaceContext === "video" ? activeStoryId : null,
    [workspaceContext, accountId, activeStoryId, scopeEpoch, feedbackLoadEpoch].join("/"), input);
  const [voiceNotice, setVoiceNotice] = useState<{ message: string; recovery?: "keyboard" } | null>(null);
  useEffect(() => {
    setVoicePreview("");
    setVoiceNotice(null);
  }, [accountId, activeStoryId]);
  const [revisionProvider, setRevisionProvider] = useState<"midjourney" | "gpt-image">("gpt-image");
  const splitChat = useShotSplitChat({ storyId: activeStoryId, stableShotId: activeSelection?.stableShotId, editor: creationEditor });
  const contentEdits = useShotContentChat({ storyId: activeStoryId, selection: activeSelection, render: rerenderSelectionImage });
  const mediaQuestion = mediaChatQuestionStore(state => state.question?.storyId === activeStoryId ? state.question : null);
  useEffect(() => () => { if (activeStoryId) cancelMediaChatSession(activeStoryId); }, [activeStoryId]);
  const [photoAssetRequest, setPhotoAssetRequest] =
    useState<PhotoAssetRequest | null>(null);
  const [pendingMedia, setPendingMedia] = useState<PendingChatMedia[]>([]);
  useEffect(() => {
    const selectFile = (event:Event) => {
      const detail=(event as CustomEvent<{storyId:number;fileId:number;name:string}>).detail;
      if(detail?.storyId!==activeStoryId)return;
      setInput(current=>warehouseFileChatRequest([{id:detail.fileId,name:detail.name}],current||"看看这个文件能读取哪些内容。"));
      clearSelection();
    };
    window.addEventListener(WAREHOUSE_FILE_CHAT_EVENT,selectFile);
    return ()=>window.removeEventListener(WAREHOUSE_FILE_CHAT_EVENT,selectFile);
  },[activeStoryId,clearSelection]);
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
  const messageNodes = useRef(new Map<string, HTMLDivElement>());
  const readingHistory = useRef(false);
  useEffect(() => { readingHistory.current = false; }, [accountId, activeStoryId]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const chatRootRef = useRef<HTMLDivElement>(null);
  const draftEpoch = useRef(0);
  const scanReader = trpc.useUtils().storyAgent.visualUnderstanding.scanKeyframes;
  const scanInFlight = useRef<string | null>(null);
  const [scanStatus, setScanStatus] = useState("");
  useEffect(() => { scanInFlight.current = null; setScanStatus(""); }, [accountId, activeStoryId, scopeEpoch]);
  const pictureReader = trpc.useUtils().storyAgent.visualUnderstanding.pictureRegion;
  const inlineInputRef = useRef<InlineChatComposerHandle>(null);
  const inlineImages = useMemo(() => creationEditor?.materialState ? composerImages(creationEditor.materialState, language).filter(image => image.imageId) : [], [creationEditor?.materialState, language]);
  const localFeedback = useLocalVideoFeedback(activeStoryId, accountId, messages);
  const [openedCue,setOpenedCue]=useState<{id:string;latest:string;openedAt:number}|null>(null);
  const latestCue = useMemo(() => workspaceContext === "video" && activeStoryId ? currentCueTurn(messages, activeStoryId) : undefined, [workspaceContext, activeStoryId, messages]);
  const cueTurn = useMemo(()=>{
    if(!activeStoryId || !latestCue || openedCue?.latest!==latestCue.reply.id)return latestCue;
    const index=messages.findIndex(row=>row.id===openedCue.id);
    return index>=0 ? currentCueTurn(messages.slice(0,index+1),activeStoryId)??latestCue : latestCue;
  },[activeStoryId,latestCue,openedCue,messages]);
  const cueShot = cueTurn && creationEditor?.activeStoryId === activeStoryId ? cueTarget(cueTurn.request.content, creationEditor?.shots ?? [], cueTurn.request.selectionQuote?.stableShotId) : undefined;
  const failedImageEdit = useMemo(() => failedImageEditRecovery(messages, activeStoryId, inlineImages) ?? quotedImageEditRecovery(messages, activeStoryId, inlineImages), [messages, activeStoryId, inlineImages]);
  const inlineImagesRef = useRef(inlineImages); inlineImagesRef.current = inlineImages;
  const focusInput = () => { if (inlineInputRef.current) inlineInputRef.current.focus(); else inputRef.current?.focus({ preventScroll: true }); };
  const selectedImage =
    activeSelection?.sourceType === "storyboard-image"
      ? creationEditor?.materialState?.warehouseImages?.find(image => image.id === activeSelection.imageId) ?? creationEditor?.materialState?.shots
          .flatMap(shot => [
            ...shot.imageVersions,
            ...(shot.relatedImages ?? []),
          ])
          .find(image => image.id === activeSelection.imageId)
      : undefined;
  const reviewPausedFrame = useFrameRegionReviewChat();
  const pausedFrameChat = usePausedFrameChat({ storyId: activeStoryId, enabled: workspaceContext === "video", text: input, selectedImageId: activeSelection?.imageId, selectedImageUrl: selectedImage?.imageUrl, proposeFrame: contentEdits.proposeFrame,
    reviewFrame: (frame, text, options) => reviewPausedFrame(frame.storyId, text, { stableShotId: frame.stableShotId, imageId: frame.imageId }, frame, options),
    onFrameReady: frame => { setClosedShotHistory(`${frame.storyId}:${frame.stableShotId}`); readingHistory.current = false; },
    focusComposer: focusInput });
  useEffect(() => {
    if (
      interactionMode === "story" &&
      activeSelection?.sourceType === "storyboard-image"
    ) {
      // Selecting a row by focusing its text field must not steal that editor's caret.
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && focused !== inputRef.current &&
        focused.matches('input, textarea, [contenteditable="true"], [role="textbox"]')) return;
      focusInput();
      inputRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [activeSelection, interactionMode]);
  const draftStoryIdRef = useRef<number | null>(null);
  const pendingMediaRef = useRef<PendingChatMedia[]>([]);
  const mediaSubmissionRef = useRef(false);
  const mediaScopeEpochRef = useRef(0);
  const mediaStoryIdRef = useRef(
    creationEditor?.activeStoryId ?? remoteStoryId ?? null
  );
  mediaStoryIdRef.current =
    creationEditor?.activeStoryId ?? remoteStoryId ?? null;
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
  const displayStoryId = remoteStoryId ?? activeStoryId;
  const storyDisplayTitle =
    storyTitle?.trim() ||
    (displayStoryId && displayStoryId > 0
      ? storyList.find(item => item.id === displayStoryId)?.title?.trim()
      : undefined) ||
    (remoteStoryId || (activeStoryId && activeStoryId > 0)
      ? _ui("故事 #{0}", [remoteStoryId ?? activeStoryId])
      : _ui("新故事草稿"));
  const selectedChatShot = workspaceContext === "video" && activeSelection && !activeSelection.selection &&
    activeSelection.storyId === activeStoryId && creationEditor?.activeStoryId === activeStoryId &&
    ["shot", "storyboard-image", "animatic-video"].includes(activeSelection.sourceType) && activeSelection.stableShotId
      ? creationEditor.shots.find(shot => (shot.stableShotId ?? shot.shotIdentity) === activeSelection.stableShotId)
      : undefined;
  const shotHistoryKey = selectedChatShot ? `${activeStoryId}:${selectedChatShot.stableShotId ?? selectedChatShot.shotIdentity}` : null;
  const showingShotHistory = Boolean(shotHistoryKey && closedShotHistory !== shotHistoryKey);
  const conversationMessages = showingShotHistory && selectedChatShot && activeStoryId
    ? shotConversationMessages(messages, activeStoryId, selectedChatShot.stableShotId ?? selectedChatShot.shotIdentity ?? "", selectedChatShot) : messages;
  const revisionSlots = chatRevisionSlots(conversationMessages, workspaceContext === "video" ?
    (frameImageRevisions.data ?? []).filter(revision => !showingShotHistory ||
      (revision.stableShotId === activeSelection?.stableShotId && !revision.decision && !revision.requestId.startsWith("image:"))) : []);
  const shotMaterial = selectedChatShot && creationEditor?.materialState?.shots.find(s => s.stableShotId === (selectedChatShot.stableShotId ?? selectedChatShot.shotIdentity));
  useWarehouseConversationFocus({ storyId: activeStoryId, enabled: workspaceContext === "video", messages: conversationMessages, container: scrollRef, nodes: messageNodes });
  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent<{ storyId: number }>).detail;
      if (workspaceContext !== "video" || detail?.storyId !== activeStoryId) return;
      setClosedShotHistory(null);
      setShotFocusRevision(revision => revision + 1);
    };
    window.addEventListener(SHOT_CHAT_FOCUS_EVENT, open);
    return () => window.removeEventListener(SHOT_CHAT_FOCUS_EVENT, open);
  }, [activeStoryId, workspaceContext]);
  const inputPlaceholder =
    composition ? '说说这张图还想怎么改…' :
    workspaceContext === "video" && pendingMedia.some(item => item.kind === "image") ? _ui("说说图片想怎么改…") :
    bookVideo && workspaceContext !== "video" ? "说说视频给谁看、想表达什么，或继续调整方案…" :
    pausedFrameChat.placeholder && (!selectedChatShot || pausedFrameChat.hasManualFrame) && !soundDirector.active && !pendingMedia.length && !activeSelection?.selection ? pausedFrameChat.placeholder :
    selectedChatShot && activeSelection?.imageId ? (language === "en" ? `Describe changes to image #${activeSelection.imageId}…` : `说说图片 #${activeSelection.imageId} 想怎么改…`) :
    selectedChatShot ? _ui("说说第 {0} 镜想怎么改…", [displayShotCode(selectedChatShot)]) :
    workspaceContext === "video" && !activeSelection?.selection && !pendingMedia.length && !soundDirector.active ? _ui("直接说想改哪个镜头的画面、音乐或视频…") :
    activeSelection?.sourceType === "storyboard-image"
      ? "描述这张图怎么改，例如：让小猫看向镜头…"
    : interactionMode === "publishing"
      ? "先把真实想法说出来，聊聊会一次只追问一个关键点…"
      : soundDirector.active && soundDirector.session?.question
        ? "回答当前声音问题，或点击上面的选项…"
        : soundDirector.active && soundDirector.session?.complete
          ? "请在上方声音方案中修改；结束声音导演后可继续普通聊天"
          : activeSelection
            ? "告诉聊聊这处想怎么改…"
            : pendingMedia.length > 0
              ? pendingMedia.some(item => item.kind === "image")
                ? "想提取哪部分？例如小猫、背景，或只保存图片…"
                : "补一句你希望怎么用这些素材…"
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
    const save = () => {
      window.removeEventListener("pagehide", save);
      saveStoryConversationDraft(activeStoryId, input);
    };
    const timer = window.setTimeout(save, 200);
    window.addEventListener("pagehide", save);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pagehide", save);
    };
  }, [activeStoryId, input]);

  const saveLabel =
    saveStatus === "saving"
      ? "云端保存中"
      : saveStatus === "error"
        ? "云端保存失败，本地备份还在"
        : remoteStoryId || (activeStoryId && activeStoryId > 0)
          ? _ui("已云端保存 #{0}", [remoteStoryId ?? activeStoryId])
          : "待云端保存";
  const saveTitle =
    saveStatus === "saved" && lastSavedAt
      ? _ui("保存到当前账号的云端故事库：{0}", [new Date(lastSavedAt).toLocaleString()])
      : "保存到当前账号的云端故事库";

  const resizeAndFocusInput = useCallback(() => {
    requestAnimationFrame(() => {
      if (inlineInputRef.current) { inlineInputRef.current.focus(); return; }
      const ta = inputRef.current;
      if (!ta) return;
      ta.focus();
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
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
      if (detail?.imageId && detail.storyId === storySpineStore.getState().activeStoryId) {
        const { imageId, stableShotId, storyId } = detail;
        requestAnimationFrame(() => {
          if (storySpineStore.getState().activeStoryId === storyId)
            void referenceImageHandler.current(imageId, stableShotId);
        });
        return;
      }
      if (!detail?.draftMessage) { if (detail?.focusComposer) resizeAndFocusInput(); return; }
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

  const handleVoiceError = useCallback((message: string, recovery?: "keyboard") => {
    if (!input.trim()) feedbackClock.reset();
    setVoiceNotice({ message, recovery });
  }, [input, feedbackClock.reset]);

  const allowLocalTranscription = import.meta.env.DEV && typeof location !== "undefined" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  const voice = useVoiceInput({
    language: "zh",
    preferLive: true,
    allowLocalTranscription,
    scopeKey: `${accountId}:${activeStoryId}`,
    onPreview: setVoicePreview,
    onRecordingStarted: () => feedbackClock.begin(!input.trim()),
    onTranscribed: handleVoiceTranscribed,
    onError: handleVoiceError,
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

  useEffect(() => {
    mediaScopeEpochRef.current += 1;
    setPendingMedia(current => {
      current.forEach(item => URL.revokeObjectURL(item.previewUrl));
      return [];
    });
    setPhotoAssetRequest(null);
  }, [creationEditor?.activeStoryId, remoteStoryId]);

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

  const scrollToLatestMessage = useCallback(() => {
    if (scrollRef.current) scrollToLatestChatTurn(scrollRef.current, messageNodes.current, conversationMessages, chatQueue.items);
  }, [conversationMessages, chatQueue.items]);
  // Only entering/closing history changes reading mode; incoming messages do not.
  const historyMode = useRef("");
  useEffect(() => {
    const key = `${accountId}:${activeStoryId}:${shotHistoryKey}:${showingShotHistory}:${shotFocusRevision}`;
    if (historyMode.current === key) return;
    historyMode.current = key;
    readingHistory.current = false;
    scrollToLatestMessage();
  }, [accountId, activeStoryId, shotHistoryKey, showingShotHistory, shotFocusRevision, scrollToLatestMessage]);
  const followCurrentConversation = (target: { stableShotId?: string | null } | null = activeSelection) => {
    readingHistory.current = false;
    setClosedShotHistory(target?.stableShotId && activeStoryId ? `${activeStoryId}:${target.stableShotId}` : null);
  };
  const handleRevisionContentChange = useCallback(() => {
    if (!readingHistory.current) requestAnimationFrame(() => {
      if (!readingHistory.current) scrollToLatestMessage();
    });
  }, [scrollToLatestMessage]);

  // Auto-scroll on new messages
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || readingHistory.current) return;
    scrollToLatestMessage();
  }, [
    scrollToLatestMessage,
    messages,
    chatQueue.items,
    isReplying,
    returningGreeting,
    showJobIntake,
    pendingIntentDraft,
    materialAdvices,
    mediaProgress,
    photoAssetRequest,
    soundDirector.active,
    soundDirector.session?.workspace.revision,
  ]);

  const handleRegenerateImage = async () => {
    const text = input.trim();
    if (!text) {
      inputRef.current?.focus();
      return;
    }
    if (activeSelection?.sourceType !== "storyboard-image" || isReplying || voice.isBusy ||
      isImportingMedia || pendingMedia.length > 0 || soundDirector.active || mediaSubmissionRef.current) return;
    mediaSubmissionRef.current = true;
    setInput("");
    try {
      await sendSelectionEdit(text, { regenerateImage: true, imageProvider: revisionProvider });
    } finally {
      mediaSubmissionRef.current = false;
      resizeAndFocusInput();
    }
  };

  const canLocateFeedback = workspaceContext === "video" && activeStoryId && !pendingMedia.length &&
    !composition && !soundDirector.active && !mediaQuestion && !pausedFrameChat.hasManualFrame &&
    !activeSelection?.imageId && (!activeSelection?.selection || activeSelection.selection.kind === "time");
  const previousTurn = messages.at(-1);
  const previousFeedback = previousTurn?.role === "assistant" && previousTurn.id === "reply:" + messages.at(-2)?.id
    ? messages.at(-2)?.selectionQuote : undefined;
  const feedbackDraft = [input, voicePreview].filter(Boolean).join(" ").trim();
  const feedbackPreview = canLocateFeedback && feedbackDraft && feedbackClock.snapshot && !hasInlineChatImages(feedbackDraft)
    ? locateTimelineFeedback(feedbackDraft, feedbackClock.snapshot, previousFeedback) : null;
  const handleSubmit = async () => {
    draftEpoch.current++;
    const submittedInput = input;
    let entered = creationFlow.resolveVersionReply?.(input.trim()) ?? input.trim();
    if (canLocateFeedback && !readWarehouseChatSelection(activeStoryId)?.imageIds.length && entered && !voice.isBusy && !isImportingMedia && !hasInlineChatImages(entered)) {
      const clock = feedbackClock.begin();
      const result = clock && locateTimelineFeedback(entered, clock, previousFeedback);
      if (result?.error) { toast.info(result.error); return; }
      if (result?.selection) {
        followCurrentConversation();
        if (isReplying || chatQueue.items.length) {
          if (!chatQueue.enqueue(entered, undefined, "video", undefined, undefined, result.selection)) return;
          setInput("");
        } else {
          await sendMessage(entered, undefined, undefined, { workspaceContext: "video", selection: result.selection,
            onMessageAdded: () => setInput(current => current === submittedInput ? "" : current) });
        }
        resizeAndFocusInput(); return;
      }
    }
    if (workspaceContext === "video" && activeStoryId && creationEditor?.activeStoryId === activeStoryId && !pendingMedia.length &&
        !composition && !soundDirector.active && !pausedFrameChat.hasManualFrame && !readWarehouseChatSelection(activeStoryId)?.imageIds.length && !activeSelection?.selection &&
        !activeSelection?.imageId && !hasInlineChatImages(entered) && !voice.isBusy && !isImportingMedia) {
      const shot = hasConversationShotReference(entered) ? resolveConversationShot(entered,creationEditor.shots) :
        selectedChatShot ?? cueShot ?? creationEditor.selectedShot;
      const stable = shot?.stableShotId ?? shot?.shotIdentity;
      const previous = messages.findLast(row=>row.id.startsWith(localReplyPrefix) && row.selectionQuote?.stableShotId === stable &&
        row.selectionQuote?.storyId === activeStoryId && row.content.startsWith("已"));
      const preview = stable && (cueShot?.stableShotId ?? cueShot?.shotIdentity) === stable && cueTurn ? reviewTakeId(cueTurn.request.content) : undefined;
      const latestPreview = previous && (!preview || previous.timestamp > (openedCue?.id === cueTurn?.reply.id && openedCue ? openedCue.openedAt : cueTurn?.request.timestamp ?? 0)) ? previous.selectionQuote?.videoTakeId : preview;
      const take = (activeSelection?.stableShotId === stable && activeSelection?.videoTakeId) || latestPreview || shot?.timelineItem?.primaryVideoEdit?.takeId;
      const known = messages.some(row=>row.role==="user" && row.id.endsWith("-feedback") && row.selectionQuote?.stableShotId===stable &&
        row.selectionQuote?.storyId===activeStoryId && sameVideoDirection(row.content,entered));
      if (shot && take && (looksLikeVideoFeedback(entered) || known) && localFeedback.submit(shot,take,entered)) {
        followCurrentConversation(shotConversationSelection(activeStoryId,shot));
        setInput(current=>current===submittedInput ? "" : current); resizeAndFocusInput(); return;
      }
    }
    if (workspaceContext === "video" && activeStoryId && creationEditor?.materialState?.storyId === activeStoryId && !pendingMedia.length) {
      let scan;
      try { scan = prepareKeyframeScan(entered, messages, activeStoryId, activeSelection?.stableShotId); }
      catch (error) { toast.info((error as Error).message); return; }
      if (scan) {
        if (scanInFlight.current) { toast.info("正在检查这组关键帧"); return; }
        const request = crypto.randomUUID();
        scanInFlight.current = request; setScanStatus(`正在检查同组 ${scan.ids.length} 张原图…`);
        const shot = scan.board.selectionQuote!;
        try {
          const rows = await scanReader.fetch({storyId:activeStoryId, shotId:shot.stableShotId!, boardId:scan.board.id,
            imageId:scan.imageId, region:scan.region}, {retry:false});
          const state = storySpineStore.getState();
          if (scanInFlight.current !== request || state.activeStoryId !== activeStoryId || state.accountId !== accountId ||
              state.storyScopeEpoch !== scopeEpoch || state.activeSelection?.stableShotId !== activeSelection?.stableShotId) return;
          const plan = scannedEditPlan(scan, rows, inlineImagesRef.current);
          const hits = rows.filter(row => row.status === "matched").length;
          const now = Date.now();
          state.setMessages(current => [...current,
            {id:request,role:"user",content:entered,timestamp:now,selectionQuote:shot},
            {id:"region-scan:"+request,role:"assistant",timestamp:now+1,selectionQuote:shot,imageEditPlan:plan,
              content:`检查了同组 ${rows.length} 张原图。除你圈的 #${scan.imageId} 外，${hits ? `另有 ${hits} 张定位到相同内容` : "没有可靠定位到其他相同内容"}。已勾选 ${hits+1} 张，可核对位置并调整本次修改范围。`}]);
          setInput(current => current === submittedInput ? "" : current);
          followCurrentConversation(shot);
        } catch (error) {
          if (scanInFlight.current === request) toast.error(error instanceof Error ? error.message : "这组图片未能检查，请重试");
        } finally {
          if (scanInFlight.current === request) { scanInFlight.current=null; setScanStatus(""); }
        }
        return;
      }
    }
    const regionDraft = hasInlineChatImages(entered) && withoutPictureRegionNotes(entered) !== entered;
    const keyframeScope = !regionDraft && workspaceContext === "video" && activeStoryId && creationEditor?.activeStoryId === activeStoryId &&
      !activeSelection?.selection && (!activeSelection || (activeSelection.storyId === activeStoryId &&
        ["shot", "storyboard-image", "animatic-video"].includes(activeSelection.sourceType)));
    const boardShot = keyframeScope ? cueTarget(entered, creationEditor.shots, selectedChatShot?.stableShotId ?? selectedChatShot?.shotIdentity) : undefined;
    const boardQuote = activeStoryId && boardShot ? shotConversationSelection(activeStoryId, boardShot) : undefined;
    const beats = keyframeScope ? shotKeyframeBeats(entered) : null;
    const appendBoard = (steps: string[], refs: Parameters<typeof keyframeChatTurns>[2]) => {
      const existing = matchingKeyframeReview(entered, refs, storySpineStore.getState().messages, boardQuote!);
      if (existing) {
        followCurrentConversation(boardQuote); setInput(""); requestAnimationFrame(() => messageNodes.current.get(existing.id)?.scrollIntoView({block:"center"})); return;
      }
      const rows = keyframeChatTurns(entered, steps, refs, boardQuote!);
      storySpineStore.getState().setMessages(current => [...current, ...rows]);
      followCurrentConversation(boardQuote); setInput(""); resizeAndFocusInput();
    };
    try {
      if (beats && !boardQuote) { toast.info("请点选一个镜头，再发送关键帧想法。"); return; }
      if (beats && pendingMedia.some(item => item.kind !== "image")) { toast.info("关键帧参考请使用图片，视频和文件请分开发送。"); return; }
      if (boardQuote && !pendingMedia.length) {
        const revisit = openKeyframeReview(entered, messages, boardQuote);
        if (revisit) { followCurrentConversation(boardQuote); setInput(""); requestAnimationFrame(() => messageNodes.current.get(revisit.id)?.scrollIntoView({block:"center"})); return; }
        const approval = !activeSelection?.imageId && keyframeApproval(entered, messages, boardQuote);
        if (approval) {
          const now = Date.now();
          storySpineStore.getState().setMessages(current => [...current,
            {id:crypto.randomUUID(),role:"user",content:entered,selectionQuote:boardQuote,timestamp:now},
            {id:crypto.randomUUID(),role:"assistant",content:approval,selectionQuote:boardQuote,timestamp:now+1}]);
          followCurrentConversation(boardQuote); setInput(""); resizeAndFocusInput(); return;
        }
        const group = !beats && keyframeGroupEdit(entered, messages, boardQuote, inlineImages, activeSelection?.imageId);
        if (group) {
          if (isReplying || voice.isBusy || isImportingMedia || creationEditor?.isLoading || mediaSubmissionRef.current || creationFlow.busy || busyImageBatch || imageEditPurchase) {
            toast.info("上一项仍在处理，整组要求已保留在输入框。"); return;
          }
          if (group.repeatId) {
            messageNodes.current.get(group.repeatId)?.scrollIntoView({ block: "center" });
          } else {
            storySpineStore.getState().setMessages(current => [...current, ...group.turns]);
          }
          followCurrentConversation(boardQuote); setInput(""); resizeAndFocusInput(); return;
        }
        const target = !beats && !activeSelection?.imageId ? reviewedKeyframeTarget(entered, messages, boardQuote, inlineImages) : null;
        if (beats || target) {
          if (isReplying || voice.isBusy || isImportingMedia || creationEditor?.isLoading || mediaSubmissionRef.current || creationFlow.busy) { toast.info("正在处理上一项，关键帧要求已留在输入框。"); return; }
          const refs = target ? [target] : orderedKeyframeRefs(entered, inlineImages, []);
          if (!refs.length && boardShot?.imageId && boardShot.imageUrl) refs.push({imageId:boardShot.imageId,imageUrl:boardShot.imageUrl,label:"本镜当前画面"});
          appendBoard(beats ?? [entered], refs); return;
        }
      }
    } catch (error) { toast.info(error instanceof Error ? error.message : "请核对关键帧参考图。"); return; }
    if (workspaceContext === "video" && activeStoryId && !pendingMedia.length && !regionDraft && requestsVideoCues(entered)) {
      if (voice.isBusy || isImportingMedia || creationEditor?.activeStoryId !== activeStoryId || creationEditor.isLoading) {
        toast.info("镜头正在加载，视频要求已留在输入框"); return;
      }
      const target = cueTarget(entered, creationEditor.shots, activeSelection?.storyId === activeStoryId ? activeSelection.stableShotId : null);
      if (!target) { toast.info("请点一个镜头，或写明镜号，再核对逐秒方案"); return; }
      try {
        const selected = readWarehouseChatSelection(activeStoryId);
        if (selected && !hasInlineChatImages(entered) && /参考.{0,5}(?:这些|这两张|所选)|选中的图/.test(entered) && selected.stableShotId === (target.stableShotId ?? target.shotIdentity))
          entered = [entered, ...selected.imageIds.map(inlineImageToken)].join(" ");
        const ids = cueReferences(entered);
        if (ids.some(id => !inlineImages.some(image => image.imageId === id))) throw new Error("引用图片不在当前故事，请从仓库重新选择");
      } catch (reason) { toast.info(reason instanceof Error ? reason.message : "请核对引用图片"); return; }
      const selectionQuote = shotConversationSelection(activeStoryId, target), id = crypto.randomUUID(), now = Date.now();
      const reviewId=reviewTakeId(entered);
      const reviewed=reviewId && /沿用已锁定主体/.test(entered) ? priorObjectOrigin(storySpineStore.getState().messages,activeStoryId,selectionQuote.stableShotId??"",cueReferences(entered)[0]) : undefined;
      storySpineStore.getState().setMessages(rows => [...rows,
        { id, role:"user", content:entered, selectionQuote, timestamp:now },
        { id:cueReplyId(id), role:"assistant", content:reviewId ? "回看候选 Take #"+reviewId+"。播放后可填写反馈。"+(reviewed?"\n"+originLine(reviewed):"") : "已收到视频要求。请核对总时长、逐秒画面和关键帧，再查看报价。尚未渲染。", selectionQuote, timestamp:now+1 }]);
      followCurrentConversation(selectionQuote); setInput(""); resizeAndFocusInput(); return;
    }
    let warehouseSelection: ReturnType<typeof readWarehouseChatSelection> = null;
    if (workspaceContext === "video" && activeStoryId && !hasInlineChatImages(entered) && !pendingMedia.length) {
      const selected = readWarehouseChatSelection(activeStoryId);
      try {
        const referenced = referenceWarehouseSelection(entered, selected?.imageIds ?? []);
        if (referenced !== entered) warehouseSelection = selected;
        entered = referenced;
      }
      catch (error) { toast.info(error instanceof Error ? error.message : "请先选择图片"); return; }
    }
    let reviewReply: string | null = null;
    if (workspaceContext === "video" && activeStoryId && activeSelection?.storyId === activeStoryId &&
        activeSelection.imageId && activeSelection.stableShotId && hasInlineChatImages(entered)) {
      const review = latestFrameRegionReview(messages, activeStoryId, "", activeSelection.stableShotId);
      reviewReply = selectedRegionReply(entered, activeSelection.imageId, review);
    }
    const text = reviewReply ?? (workspaceContext === "video" && activeSelection?.storyId === activeStoryId
      ? continueInlineImageEdit(entered, activeSelection.imageId, inlineImages, Boolean(activeSelection.selection) || usesPausedFrame(entered) || isFrameReferenceChat(entered) || Boolean(regionReviewDecision(entered)) || Boolean(regionInheritanceDecision(entered)))
      : entered);
    if (text || pendingMedia.length) followCurrentConversation();
    if (workspaceContext === "video" && !beats && hasInlineChatImages(text)) {
      if (isReplying || voice.isBusy || isImportingMedia || creationFlow.busy || remix.status === "generating") { toast.info("正在处理上一条，图片和文字已保留"); return; }
      if (pendingMedia.length) { toast.info("请先发送或移除待上传附件，再发送仓库图片引用"); return; }
      try {
        const draft = compileInlineChatDraft(text, inlineImages);
        if (draft.edit) {
          const warehouseShot = warehouseSelection && creationEditor?.shots.find(shot => (shot.stableShotId ?? shot.shotIdentity) === warehouseSelection.stableShotId);
          const target = warehouseShot && warehouseSelection ? { stableShotId: warehouseSelection.stableShotId, shotNo: warehouseShot.shotNo }
            : activeSelection?.storyId === activeStoryId && activeSelection.stableShotId
            ? { stableShotId: activeSelection.stableShotId, shotNo: activeSelection.shotNo ?? 0, selectionImageId: activeSelection.imageId } : undefined;
          // Several pictures are ambiguous: they may be independent edit targets, not
          // one base plus context. Collect intent before creating any paid quote.
          const needsRemovalDetails = !regionDraft && isImageObjectRemoval(withoutPictureRegionNotes(draft.instruction));
          if (draft.refs.length > 1 || needsRemovalDetails) {
            const selectionQuote = target ? { sourceType: 'shot' as const, sourceId: target.stableShotId, storyId: activeStoryId!, stableShotId: target.stableShotId, shotNo: target.shotNo, selectedText: text } : undefined;
            remix.cancel();
            remixMessage.current = null;
            contentEdits.dismiss(); splitChat.dismiss();
            storySpineStore.getState().setMessages(current => [...current,
              { id: crypto.randomUUID(), role: 'user', content: text, timestamp: Date.now(), selectionQuote },
              { id: crypto.randomUUID(), role: 'assistant', content: needsRemovalDetails
                ? '已记录删除要求，旧粉色范围不用于这次改图。请在下方明确删哪个、留哪个（位置、大小或颜色），核对张数和预计费用后点击“确认并生成”。结果保留为候选。'
                : '请核对每张图的用途、输出张数、修改和保留要求。缩略图可放大查看；预计费用在下方，点击“确认并生成”后开始改图。', timestamp: Date.now() + 1,
                imageEditPlan: createChatImageEditPlan(draft.refs, draft.instruction), selectionQuote },
            ]);
            setInput('');
            resizeAndFocusInput(); return;
          }
          if (remix.arm(draft.instruction, draft.refs, target)) {
            contentEdits.dismiss(); splitChat.dismiss();
            const selectionQuote = target
              ? { sourceType: "shot" as const, sourceId: target.stableShotId, storyId: activeStoryId!, stableShotId: target.stableShotId, shotNo: target.shotNo, selectedText: text } : undefined;
            const quote = formatComputeQuote(estimateStoryboardMaskedEditCost().estimatedCny);
            const regionRef = regionDraft ? chatPictureParts(text).find(part => part.note) : undefined;
            const subject = regionRef?.note ? `已收到 1 张引用，修改图片 #${regionRef.imageId} 的选区（${pictureRegionLabel(regionRef.note, language === "en")}）。` : `已收到 ${draft.refs.length} 张引用，图1为底图。`;
            const quoteId = crypto.randomUUID();
            remixMessage.current = { storyId: activeStoryId!, quoteId, selection: storySpineStore.getState().activeSelection };
            storySpineStore.getState().setMessages(current => [...current,
              { id: crypto.randomUUID(), role: "user", content: text, timestamp: Date.now(), selectionQuote },
              { id: quoteId, role: "assistant", content: `${subject}预计 ${quote}，尚未开始改图。确认后提交，新图保留为候选。`, timestamp: Date.now() + 1, selectionQuote: selectionQuote ? { ...selectionQuote, selectedText: "图片修改报价" } : undefined },
            ]);
            setInput("");
          }
        } else {
          // Inline references are the complete image selection; the last clicked image cannot override them.
          const sent = await sendMessage(text, undefined, undefined, { workspaceContext, selection: selectedChatShot && activeStoryId ? shotConversationSelection(activeStoryId, selectedChatShot) : null });
          if (sent) setInput(current => current === submittedInput ? "" : current);
        }
      } catch (error) { toast.error(error instanceof Error ? error.message : "图片引用暂时无法发送"); }
      resizeAndFocusInput(); return;
    }
    if (workspaceContext === "video" && activeStoryId) {
      const shot = conversationWarehouseShot(text, activeStoryId, creationEditor?.shots ?? [], activeSelection);
      const id = shot?.stableShotId ?? shot?.shotIdentity;
      if (id) openShotWarehouse(activeStoryId, id);
      if (shot && id && isShotConversationNavigation(text) && !pendingMedia.length && !voice.isBusy && !isImportingMedia) {
        setActiveSelection(shotConversationSelection(activeStoryId, shot));
        setInput("");
        focusShotChat(activeStoryId, id);
        setClosedShotHistory(null);
        resizeAndFocusInput();
        return;
      }
    }
    if ((isStudioAssistantRequest(text) || studioConfirmation(text)) && !isReplying && !pendingMedia.length && !voice.isBusy && !isImportingMedia) {
      setInput("");
      await sendMessage(text, undefined, undefined, { workspaceContext, writingContext: bookRewriteChatSnapshot(writingSession?.getSnapshot(), useBookModuleActions.getState().session) });
      resizeAndFocusInput();
      return;
    }
    let review;
    try { review = latestFrameRegionReview(messages, activeStoryId ?? 0, text, activeSelection?.stableShotId); }
    catch (error) { if (isFrameReferenceChat(text)) { toast.info(error instanceof Error ? error.message : "Choose one shot"); return; } }
    const unrelatedImage = activeSelection?.imageId && !isFrameRegionReviewImage(review, activeSelection.imageId);
    const explicitReview = isFrameReferenceChat(text) || Boolean(regionReviewDecision(text)) || Boolean(regionInheritanceDecision(text)) ||
      Boolean(review?.tasks.some(task=>task.shapeQuote)&&cloudShapeDecision(text)) || Boolean(review?.activeTarget==="cloud"&&isCloudAppearanceEdit(text));
    // A clicked review image is already a frozen frame, even when the user
    // calls it “this frame”. Do not send it back through content search.
    const reviewCanHandle = explicitReview || Boolean(activeSelection?.imageId && !unrelatedImage) ||
      (!unrelatedImage && !pausedFrameChat.hasManualFrame && !usesPausedFrame(text));
    if (workspaceContext === "video" && text && reviewCanHandle && isFrameRegionChat(text, review) && !pendingMedia.length && !voice.isBusy && !isImportingMedia) {
      if (contentEdits.pending) contentEdits.dismiss();
      readingHistory.current = false;
      let shotNo: number | null;
      try { shotNo = explicitReferenceShotNumber(text); }
      catch (error) { toast.info(error instanceof Error ? error.message : "请指定一个镜头 / Choose one shot"); return; }
      const shot = shotNo == null ? undefined : creationEditor?.shots.find(shot => shot.shotNo === shotNo);
      const target = shot && activeStoryId ? shotConversationSelection(activeStoryId, shot) : activeSelection;
      if (target?.stableShotId && activeStoryId) {
        setActiveSelection(target); followCurrentConversation(target);
      }
      if (isReplying || chatQueue.items.length > 0) {
        if (!chatQueue.enqueue(text, undefined, workspaceContext, undefined, revisionProvider, target)) return;
      } else {
        setInput(""); resizeAndFocusInput();
        await sendMessage(text, undefined, undefined, { workspaceContext, selection: target });
        return;
      }
      setInput(""); resizeAndFocusInput(); return;
    }
    if (text && !pendingMedia.length && !voice.isBusy && !isImportingMedia) {
      const frameResult = await pausedFrameChat.handle(text);
      if (frameResult) {
        if (frameResult === "handled") setInput(current => current.trim() === text ? "" : current);
        resizeAndFocusInput(); return;
      }
    }
    if (workspaceContext === "video" && text && !pendingMedia.length && !voice.isBusy && !isImportingMedia && await splitChat.handle(text)) {
      contentEdits.dismiss();
      setInput(current => current.trim() === text ? "" : current); resizeAndFocusInput(); return;
    }
    if (workspaceContext === "video" && text && !pendingMedia.length && !voice.isBusy && !isImportingMedia && await contentEdits.handle(text)) {
      splitChat.dismiss();
      setInput(current => current.trim() === text ? "" : current); resizeAndFocusInput(); return;
    }
    // 「只调亮度」「按图一的颜色改图二」走本地免费调色：排在选区改图、镜头对话之前，否则会被当成付费改图报价。
    if (text && activeStoryId && !pendingMedia.length && !voice.isBusy && !isImportingMedia && (parseRegionalGradeIntent(text) || parseLuminanceGradeIntent(text) || parseColorTransferIntent(text))) {
      setInput("");
      const surface = workspaceContext ?? "video";
      if (isReplying || creationFlow.busy) chatQueue.enqueue(text, undefined, surface);
      else await sendMessage(text, undefined, undefined, { workspaceContext: surface, selection: parseRegionalGradeIntent(text) ? activeSelection : null });
      resizeAndFocusInput();
      return;
    }
    if (text && parseVisualUnderstandingChat(text) && !pendingMedia.length && !voice.isBusy && !isImportingMedia) {
      if (isReplying || chatQueue.items.length) chatQueue.enqueue(text, undefined, workspaceContext, undefined, revisionProvider, activeSelection);
      else { setInput(""); resizeAndFocusInput(); await sendMessage(text, undefined, undefined, { workspaceContext, selection: activeSelection }); return; }
      setInput(""); resizeAndFocusInput(); return;
    }
    if (warehouseFileChatIds(text).length && !pendingMedia.length && !voice.isBusy && !isImportingMedia) {
      if (isReplying || chatQueue.items.length) chatQueue.enqueue(text,undefined,workspaceContext);
      else {setInput("");await sendMessage(text,undefined,undefined,{workspaceContext});resizeAndFocusInput();return;}
      setInput("");resizeAndFocusInput();return;
    }
    // A creative-emotion command can mention music, pictures or a selected shot.
    // It must reach the shared intention handler before editing/generation branches.
    if (parseCreationEmotionChat(text) && !pendingMedia.length && !voice.isBusy && !isImportingMedia) {
      const named = workspaceContext === "video" ? resolveConversationShot(text, creationEditor?.shots ?? []) : undefined;
      const target = named && activeStoryId ? shotConversationSelection(activeStoryId, named) : undefined;
      if (target && activeStoryId) {
        setActiveSelection(target);
        followCurrentConversation(target);
      }
      if (isReplying || chatQueue.items.length > 0) {
        if (!chatQueue.enqueue(text, undefined, workspaceContext, undefined, revisionProvider, target)) return;
        setInput("");
        resizeAndFocusInput();
        return;
      }
      setInput("");
      resizeAndFocusInput();
      await sendMessage(text, undefined, undefined, { workspaceContext, ...(target ? { selection: target } : {}) });
      return;
    }
    // 「第 3 镜把图片 #2047 设为尾帧」：按编号设帧角色，免费，只改镜头设定。
    const explicitFrame = workspaceContext === "video" && creationEditor && !isReplying && !pendingMedia.length ? explicitImageFrameRole(text) : null;
    if (explicitFrame && creationEditor) {
      const found = resolveExplicitFrameRole(explicitFrame, creationEditor.shots, selectedChatShot);
      if ("error" in found) { toast.info(found.error); return; }
      try {
        await creationEditor.updatePersistedShotFields(found.shot.stableShotId ?? found.shot.shotIdentity!, { generationParams: storyboardFrameRoleGenerationParams(found.shot.generationParams, found.images, explicitFrame.imageId, explicitFrame.role, found.shot.durationMs) });
        setInput(""); toast.success(`第 ${found.shot.shotNo} 镜：图片 #${explicitFrame.imageId} 已设为${explicitFrame.role === "first" ? "首帧" : explicitFrame.role === "last" ? "尾帧" : "参考帧"}`); resizeAndFocusInput();
      } catch (error) { toast.error(error instanceof Error ? error.message : "帧设置保存失败"); }
      return;
    }
    if (workspaceContext === "video" && text && !pendingMedia.length && !voice.isBusy && !isImportingMedia &&
      hasConversationShotReference(text) && !parseArtPreviewChat(text) && !parseImageRevisionDecision(text)) {
      const shot = resolveConversationShot(text, creationEditor?.shots ?? []);
      if (!shot || !activeStoryId) {
        toast.info(_ui("请说清一个镜号，我会打开它的对话；尚未修改。"));
        return;
      }
      const target = shotConversationSelection(activeStoryId, shot);
      setActiveSelection(target);
      setInput("");
      followCurrentConversation(target);
      if (isReplying) chatQueue.enqueue(text, undefined, workspaceContext, undefined, revisionProvider, target);
      else await sendMessage(text, undefined, undefined, {workspaceContext, selection: target});
      resizeAndFocusInput();
      return;
    }
    const frameRequest = selectedImageFrameRole(text);
    if (frameRequest && workspaceContext === "video" && activeSelection?.sourceType === "storyboard-image" && activeSelection.imageId && selectedChatShot && creationEditor && !isReplying && !pendingMedia.length) {
      const imageId = activeSelection.imageId;
      const shotId = activeSelection.stableShotId!;
      const imageUrl = selectedImage?.imageUrl ?? twoImages.state?.candidates.find(image => image.imageId === imageId)?.imageUrl;
      if (!imageUrl) { toast.error("图片尚未加载，请从仓库重新选择"); return; }
      try {
        const images = storyboardShotFrameImages(selectedChatShot);
        const sourceReference = selectedChatShot.imageVersions?.find(image => image.id === imageId && image.referenceOnly);
        if (sourceReference && !images.some(image => image.id === imageId)) images.push(sourceReference);
        if (!images.some(image => image.id === imageId)) {
          toast.error("这张图还未关联到该镜头，暂时无法设置帧角色。");
          return;
        }
        await creationEditor.updatePersistedShotFields(shotId, { generationParams: storyboardFrameRoleGenerationParams(selectedChatShot.generationParams, images, imageId, frameRequest, selectedChatShot.durationMs) });
        setInput(""); toast.success(`图片 #${imageId} 已设为${frameRequest === "first" ? "首帧" : frameRequest === "last" ? "尾帧" : "参考帧"}`); resizeAndFocusInput();
      } catch (error) { toast.error(error instanceof Error ? error.message : "参考帧保存失败"); }
      return;
    }
    if (workspaceContext === "video" && text && !pendingMedia.length && twoImages.state &&
      (twoImages.state.status === "confirming" || twoImages.state.status === "done") &&
      twoImageReply(text, twoImages.state.status)) {
      setInput("");
      void twoImages.answer(text);
      resizeAndFocusInput();
      return;
    }
    if (workspaceContext === "video" && twoImages.state?.status === "done" && rejectsBothImageCandidates(text)) {
      twoImages.dismiss();
    }
    if (workspaceContext === "video" && text && !pendingMedia.length && twoImages.revise(text)) {
      setInput(""); resizeAndFocusInput(); return;
    }
    if (mediaQuestion && text && activeStoryId) {
      if (answerMediaChatQuestion(activeStoryId, text) === "answered") {
        setInput(""); resizeAndFocusInput(); return;
      }
    }
    if (text || pendingMedia.length) readingHistory.current = false;
    if (text && !pendingMedia.length && !voice.isBusy && !isImportingMedia && isReplying) {
      const production = parseVisualProductionChat(text);
      const useSelectionEdit = activeSelection && !parseSoundChat(text) &&
        !(workspaceContext === "video" && activeSelection.sourceType === "shot" && !activeSelection.selection) &&
        !(workspaceContext === "video" && selectedChatShot && isShotConversationQuestion(text)) &&
        !parseArtPreviewChat(text) && !parseImageRevisionDecision(text) && !parseArtSystemChat(text, false) &&
        (!production || usesSelectedImageRevision(production, activeSelection) || activeSelection.selection);
      if (chatQueue.enqueue(text, undefined, workspaceContext, useSelectionEdit ? activeSelection : undefined, /\b(?:MJ|Midjourney)\b/i.test(text) ? "midjourney" : revisionProvider, workspaceContext === "video" ? activeSelection : null)) { setInput(""); resizeAndFocusInput(); }
      return;
    }
    if (workspaceContext === "video" && text && (parseArtPreviewChat(text) || parseImageRevisionDecision(text)) &&
        !isReplying && !voice.isBusy && !isImportingMedia && !pendingMedia.length) {
      setInput("");
      await sendMessage(text, undefined, undefined, { workspaceContext });
      resizeAndFocusInput();
      return;
    }
    if (text && parseArtSystemChat(text, Boolean(storySpineStore.getState().artDirection.recipe?.system) && !activeSelection) &&
        !isReplying && !voice.isBusy && !isImportingMedia && !pendingMedia.length) {
      setInput("");
      await sendMessage(text, undefined, undefined, { workspaceContext });
      resizeAndFocusInput();
      return;
    }
    if (workspaceContext === "video" && text && parseVisualProductionChat(text) &&
        !usesSelectedImageRevision(parseVisualProductionChat(text), activeSelection) &&
        !activeSelection?.selection && (!activeSelection || ["shot", "storyboard-image", "animatic-video"].includes(activeSelection.sourceType)) &&
        !isReplying && !voice.isBusy && !isImportingMedia && !pendingMedia.length) {
      if (activeSelection && !selectionBelongsToStory(activeSelection, activeStoryId)) {
        clearSelection(); toast.error("选区属于另一个故事，请重新选择"); return;
      }
      setInput("");
      await sendMessage(text, undefined, undefined, { workspaceContext });
      resizeAndFocusInput();
      return;
    }
    if (workspaceContext && text && parseSoundChat(text) && !isReplying && !voice.isBusy && !isImportingMedia && !pendingMedia.length) {
      setInput("");
      await sendMessage(text, undefined, undefined, { workspaceContext });
      resizeAndFocusInput();
      return;
    }
    // A whole shot is a conversation target, not a highlighted text range.
    // It must work before the shot has an image, without fabricating a text selection.
    if (workspaceContext === "video" && selectedChatShot && (activeSelection?.sourceType === "shot" || isShotConversationQuestion(text)) &&
        text && !isReplying && !voice.isBusy && !isImportingMedia && !pendingMedia.length) {
      setInput("");
      await sendMessage(text, undefined, undefined, { workspaceContext, selection: activeSelection });
      resizeAndFocusInput();
      return;
    }
    if (text && !pendingMedia.length && !voice.isBusy && !isImportingMedia) {
      if (composition) {
        if (compositionHandle.current?.submit(text)) { setInput(''); resizeAndFocusInput(); }
        return;
      }
      const modules = useBookModuleActions.getState().session;
      if (writingSession && modules?.storyId === activeStoryId && modules.composeImage && isBookImageCreationIntent(text)) {
        try { await modules.composeImage(text); setInput(''); resizeAndFocusInput(); }
        catch (e) { toast.error(e instanceof Error ? e.message : '未能整理素材'); }
        return;
      }
    }
    if (discussingBookVideo && text && !pendingMedia.length && !voice.isBusy && !isImportingMedia) {
      if(await bookVideoHandle.current?.submit(text)){setInput("");resizeAndFocusInput()}
      return;
    }
    if (bookMedia && text && !pendingMedia.length && !voice.isBusy && !isImportingMedia) {
      if (bookMediaHandle.current?.submit(text)) { setInput(""); resizeAndFocusInput(); }
      return;
    }
    if (text && creativeVersionIntent(text) && !isReplying && !voice.isBusy && !isImportingMedia && !pendingMedia.length) {
      if (creationFlow.busy) return;
      if (await creationFlow.submit(text, () => { setInput(""); resizeAndFocusInput(); })) return;
    }
    const ordinaryText = !pendingMedia.length &&
      (layoutContext || (!soundDirector.active && activeSelection == null));
    if (text && ordinaryText && !voice.isBusy && !isImportingMedia &&
      (writingSession || isReplying || chatQueue.items.length > 0)) {
      const snapshot = bookRewriteChatSnapshot(writingSession?.getSnapshot(), useBookModuleActions.getState().session);
      if (chatQueue.enqueue(text, snapshot, workspaceContext)) {
        setInput("");
        resizeAndFocusInput();
      }
      return;
    }
    if (text && !isReplying && !voice.isBusy && !isImportingMedia && !pendingMedia.length) {
      if (creationFlow.busy) return;
      if (await creationFlow.submit(text, () => { setInput(""); resizeAndFocusInput(); })) return;
    }
    if (interactionMode === "publishing" && !pendingMedia.length && activeSelection?.sourceType !== "storyboard-image") {
      if (!text || voice.isBusy || isImportingMedia) return;
      if (chatQueue.enqueue(text, undefined, workspaceContext)) setInput("");
      resizeAndFocusInput();
      return;
    }
    if (
      shouldRouteChatToSoundDirector({
        active: soundDirector.active,
        hasQuestion: Boolean(soundDirector.session?.question),
        text,
      })
    ) {
      setInput("");
      const accepted = await soundDirector.answer({ freeText: text });
      if (!accepted) setInput(text);
      resizeAndFocusInput();
      return;
    }
    if (soundDirector.active) return;
    if (
      (!text && pendingMedia.length === 0) ||
      isReplying ||
      voice.isBusy ||
      isImportingMedia ||
      mediaSubmissionRef.current
    ) {
      return;
    }

    const videoImageEdit = workspaceContext === "video" && pendingMedia.some(item => item.kind === "image") && isVideoImageEditRequest(text);
    const savingPhotos = pendingMedia.length > 0 && pendingMedia.every(item => item.kind === "image") && isPhotoSaveOnlyReply(text);
    const selectionRoute = beats || videoImageEdit || savingPhotos ? { kind: "attachments" as const } : routeSelectionSubmission({
      selection: activeSelection,
      activeStoryId: creationEditor?.activeStoryId ?? remoteStoryId ?? null,
      pendingMediaCount: pendingMedia.length,
    });
    if (selectionRoute.kind === "blocked") {
      toast.error(selectionRoute.reason);
      if (selectionRoute.clearSelection) clearSelection();
      return;
    }

    const photoAction = beats || videoImageEdit ? "generate" : chatPhotoSubmissionAction(
      text,
      pendingMedia.some(item => item.kind === "image")
    );
    if (photoAction === "ask") {
      toast.info(PHOTO_EXTRACTION_QUESTION);
      resizeAndFocusInput();
      return;
    }
    if (photoAction === "extract" && text.length > 2000) {
      toast.error("请把提取范围控制在 2000 字以内");
      return;
    }

    if (
      selectionRoute.kind === "ordinary-chat" &&
      isPhotoAssetRequest(text) &&
      creationEditor?.activeStoryId
    ) {
      setPhotoAssetRequest({
        storyId: creationEditor.activeStoryId,
        instruction: text,
        notice:
          "请在下方展开对应资产，核对照片特征后确认生成费用；没有照片时，先用聊天框添加照片。",
      });
      setInput("");
      resizeAndFocusInput();
      return;
    }

    // 多图重组只在没有明确活动选区时接管；明确选区永远是唯一修改范围。
    if (selectionRoute.kind === "ordinary-chat" && remix.refs.length > 0) {
      if (remix.arm(text)) {
        setInput("");
        resizeAndFocusInput();
      }
      return;
    }

    if (
      selectionRoute.kind === "text-edit" ||
      selectionRoute.kind === "image-edit" ||
      selectionRoute.kind === "image-region-edit" ||
      selectionRoute.kind === "editing-command"
    ) {
      const routedSelection = selectionRoute.selection;
      const localImageIntent = parseChatImageLocalEditInstruction(text);
      if (
        selectionRoute.kind === "image-edit" &&
        localImageIntent &&
        routedSelection.imageId != null &&
        creationEditor
      ) {
        const selectedImageId = routedSelection.imageId;
        const shot = routedSelection.stableShotId
          ? creationEditor.shots.find(
              item =>
                (item.stableShotId ?? item.shotIdentity) ===
                routedSelection.stableShotId
            )
          : creationEditor.shots.find(
              item => item.shotNo === routedSelection.shotNo
            );
        const stableShotId =
          shot?.stableShotId ??
          shot?.shotIdentity ??
          routedSelection.stableShotId;
        if (!shot || !stableShotId) {
          toast.error("这张图片还没有可编辑的镜头位置");
          return;
        }
        const currentTransform = {
          ...DEFAULT_TIMELINE_TRANSFORM,
          ...(shot.timelineItem?.transform ?? {}),
          ...(shot.timelineItem?.imageTransforms?.[String(selectedImageId)] ??
            {}),
        };
        const rotationDeg = localImageIntent.rotate180
          ? rotateTimelineImage180(currentTransform.rotationDeg ?? 0)
          : (currentTransform.rotationDeg ?? 0);
        setInput("");
        setMediaProgress(
          localImageIntent.extractText
            ? "正在按当前方向提取文字…"
            : "正在倒转图片…"
        );
        try {
          if (localImageIntent.rotate180) {
            await creationEditor.updateTimelineImageTransform({
              stableShotId,
              imageId: selectedImageId,
              transform: { ...currentTransform, rotationDeg },
              textOverlay:
                shot.timelineItem?.imageTextOverlays?.[
                  String(selectedImageId)
                ] ?? null,
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
      if (selectionRoute.kind === "image-edit" && assetSwap.arm(text)) {
        setInput("");
        resizeAndFocusInput();
        return;
      }
      setInput("");
      await sendSelectionEdit(text, { imageProvider: /\b(?:MJ|Midjourney)\b/i.test(text) ? "midjourney" : revisionProvider });
      resizeAndFocusInput();
      return;
    }

    if (selectionRoute.kind === "ordinary-chat") {
      if (chatQueue.enqueue(text, undefined, workspaceContext)) setInput("");
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
    const mediaScopeEpoch = mediaScopeEpochRef.current;
    const isCurrentMediaScope = () =>
      mediaStoryIdRef.current === storyId &&
      mediaScopeEpochRef.current === mediaScopeEpoch;

    mediaSubmissionRef.current = true;
    setIsImportingMedia(true);
    setMediaProgress(`正在导入 0 / ${attachments.length}`);
    try {
      for (let index = 0; index < attachments.length; index += 1) {
        if (!isCurrentMediaScope()) return;
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
          if (!isCurrentMediaScope()) return;
          imported.push({
            attachment,
            kind: result.kind,
            fileName: attachment.file.name,
            assetId: result.kind === "image" ? result.imageId : result.kind === "file" ? result.file.id : result.takeId,
            imageUrl: result.kind === "image" ? result.imageUrl : undefined,
            photoIndex:
              attachment.kind === "image"
                ? attachments
                    .slice(0, index + 1)
                    .filter(item => item.kind === "image").length
                : undefined,
            totalPhotos: attachments.filter(item => item.kind === "image")
              .length,
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
        if (beats && failures.length) break;
        setMediaProgress(`正在导入 ${index + 1} / ${attachments.length}`);
      }

      if (!isCurrentMediaScope()) return;
      if (failures.length > 0) {
        toast.error(failures.slice(0, 2).join("；"));
      }
      if (imported.length === 0) return;

      if (beats && boardQuote) {
        const refs = buildImportedImageRefs(imported);
        try {
          if (failures.length) throw Error("有参考图未导入。已入库图片保留在输入框，补齐后可继续。");
          if (storySpineStore.getState().activeSelection?.stableShotId !== activeSelection?.stableShotId)
            throw Error("镜头选区已变化。参考图已入库，请重新核对镜头。");
          appendBoard(beats, orderedKeyframeRefs(entered, inlineImages, refs));
        } catch (error) {
          setInput(current => [current, ...refs.map(ref => inlineImageToken(ref.imageId))].join(" ").trim());
          toast.info(error instanceof Error ? error.message : "请核对本组参考图。");
        }
        return;
      }
      const importedFiles = imported.filter(item => item.kind === "file");
      if (importedFiles.length) {
        setInput("");
        await sendMessage(warehouseFileChatRequest(importedFiles.map(file=>({id:file.assetId,name:file.fileName})),text),undefined,undefined,{workspaceContext});
        if(imported.length>importedFiles.length)toast.info("其他图片或视频也已保存，尚未分析 / Other media saved; not analyzed");
        resizeAndFocusInput(); return;
      }
      if (photoAction === "save") {
        const saved = imported.filter(item => item.kind === "image");
        if (saved.length && storySpineStore.getState().activeStoryId === storyId) {
          const refs = saved.map(item => inlineImageToken(item.assetId)).join(" ");
          storySpineStore.getState().setMessages(rows => [...rows, {
            id: `saved-photos:${crypto.randomUUID()}`, role: "assistant", timestamp: Date.now(),
            ...(targetShot && workspaceContext === "video" ? { selectionQuote: shotConversationSelection(storyId, targetShot) } : {}),
            content: (workspaceContext === "video" ? (language === "en" ? "Saved to Library. Click a photo to reference it in chat." : "已存入仓库，点图可引用到聊天。")
              : (language === "en" ? "Saved to Library. Select a photo to see it full size." : "已存入仓库，点图可看大图。")) + "\n" + refs,
          }]);
        }
        setPhotoAssetRequest({
          storyId,
          instruction: "",
          notice: "照片已保存到素材库，没有识图提取、生成新图或替换镜头。",
        });
        setInput("");
        resizeAndFocusInput();
        return;
      }

      if (
        photoAction === "extract" &&
        imported.some(item => item.kind === "image")
      ) {
        const extraction = await extractImportedPhotoFeatures({
          imported,
          focus: text,
          extract: photo => {
            if (!isCurrentMediaScope())
              throw new Error("已切换故事，停止提取后续照片");
            return creationEditor.extractPhotoVisualFeatures(photo);
          },
          onProgress: (completed, total) =>
            setMediaProgress(`正在按你的要求提取 ${completed} / ${total}`),
        });
        if (!isCurrentMediaScope()) return;
        setPhotoAssetRequest({
          storyId,
          instruction: text,
          notice: extraction.createdKinds.length
            ? "照片已入库，识别结果是待检查版本。展开对应资产核对特征，再确认艺术化要求和生成费用。"
            : "照片已保留，但没有找到符合要求的完整特征。请补充更清晰的照片或说明要保留哪一部分；不会编造看不见的外观。",
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

      if (
        photoAction === "extract" &&
        imported.some(item => item.kind === "image")
      ) {
        setInput("");
        resizeAndFocusInput();
        return;
      }

      if (videoImageEdit && imported.some(item => item.kind === "image")) {
        const refs = buildImportedImageRefs(imported);
        // Preserve the already selected shot's visual style while keeping the
        // user's uploaded images first and their requested content in control.
        if (targetShot?.imageId && targetShot.imageUrl && refs.length < 4 && !refs.some(ref => ref.imageId === targetShot.imageId)) {
          refs.push({ imageId: targetShot.imageId, imageUrl: targetShot.imageUrl, label: "当前镜头已选画面（美术参考）" });
        }
        if (failures.length || !targetStableShotId || !targetShot || !twoImages.arm(refs, text, targetStableShotId, displayShotCode(targetShot))) {
          toast.error(failures.length ? "有图片未导入，请补齐后重试；已导入图片在仓库。" : "请先选择要放入的镜头");
          return;
        }
        setInput(""); resizeAndFocusInput(); return;
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
      mediaSubmissionRef.current = false;
      setIsImportingMedia(false);
      setMediaProgress(null);
    }
    resizeAndFocusInput();
  };

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const renderQueueStatus = (id: string) => {
    const item = chatQueue.items.find(message => message.id === id);
    if (!item) return null;
    return <div className="mt-1 flex items-center gap-2 text-[10px] opacity-80">
      <span>{item.status === "failed" ? _ui("未收到完整回复，已暂停") : item.status === "sending" ? _ui("等待回复") : _ui("排队中")}</span>
      {item.status !== "sending" && <button type="button" onClick={() => {
        void navigator.clipboard.writeText(item.text).then(() => toast.success("已复制，原消息仍保留在队列中"), () => toast.error("请选中文字复制"));
      }}>{_ui("复制")}</button>}
      {item.status !== "sending" && <button type="button" onClick={() => chatQueue.takeBack(item.id)}>
        {item.status === "failed" ? _ui("已核对，移出队列") : _ui("取消排队")}
      </button>}
      {chatQueue.paused && item.status === "queued" && chatQueue.items[0]?.id === item.id &&
        !chatQueue.items.some(message => message.status === "failed") &&
        <button type="button" onClick={chatQueue.resume}>{_ui("发送")}</button>}
    </div>;
  };

  const lastAssistantId = [...messages]
    .reverse()
    .find(message => message.role === "assistant")?.id;

  const creationBlocked = isReplying || chatQueue.items.length > 0 || voice.isBusy ||
    isImportingMedia || pendingMedia.length > 0 || soundDirector.active;

  const showWritingContext = !discussingBookVideo && writingSession && (!activeSelection || layoutContext);
  const writingSnapshot = showWritingContext ? writingSession.snapshot : null;
  const selectedImageFrame = selectedChatShot && activeSelection?.imageId
    ? findReviewImageFrame(messages.flatMap(message => message.frameReview ? [message.frameReview] : []), activeStoryId,
      selectedChatShot.stableShotId ?? selectedChatShot.shotIdentity ?? "", activeSelection.imageId)
    : undefined;
  const imageContext = selectedChatShot && activeSelection?.imageId
    ? (language === "en" ? `Current chat: Shot ${displayShotCode(selectedChatShot)} · Image #${activeSelection.imageId}` : `当前聊天：第 ${displayShotCode(selectedChatShot)} 镜 · 图片 #${activeSelection.imageId}`)
      + (selectedImageFrame ? ` · ${frameLocationLabel(selectedImageFrame, language === "en")}` : "")
    : undefined;
  const videoContext = pausedFrameChat.hasManualFrame ? [pausedFrameChat.contextLabel, activeSelection?.imageId ? (language === "en" ? `Image reference #${activeSelection.imageId}` : `图片引用 #${activeSelection.imageId}`) : undefined].filter(Boolean).join(" · ")
    : imageContext ?? (selectedChatShot ? (language === "en" ? `Current chat: Shot ${displayShotCode(selectedChatShot)}` : `当前聊天：第 ${displayShotCode(selectedChatShot)} 镜`) : pausedFrameChat.contextLabel);
  const contextStatus = composition ? _ui('正在创作图片 · 已带入 {0} 个模块', [composition.sources.length]) : discussingBookVideo ? _ui("正在讨论视频创作") : writingSnapshot
    ? writingSnapshot.module
      ? `${_ui("已定位：")}${writingSnapshot.module.selection ? layoutModuleLabel(writingSnapshot.module) : writingSnapshot.module.kind === "text" ? writingSnapshot.module.text || _ui("空白段落") : layoutModuleLabel(writingSnapshot.module)}${writingSnapshot.module.kind === "image" && !bookMedia && !writingSnapshot.module.pagePreview ? _ui("（画面暂不可用）") : ""}`
      : writingSnapshot.layoutMemory ? _ui("正在聊当前排版") : writingSnapshot.selection
        ? `${_ui("已选中：")}${writingSnapshot.draft.slice(writingSnapshot.selection.start, writingSnapshot.selection.end)}`
        : _ui("已定位：全文")
    : workspaceContext === "video" ? videoContext || _ui("当前视频 · 可以直接说音乐小一点、旁白音量或淡入淡出") : activeSelection ? _ui("正在聊你选中的内容") : _ui("想聊什么？");
  const staticVideoContext = workspaceContext === "video" && !composition && !discussingBookVideo && !writingSnapshot && !activeSelection?.selection ? videoContext : undefined;
  const companionMessages = [
    videoProgress,
    creationFlow.busy ? _ui("正在处理创作指令…") : generatingCount > 0 ? _ui("正在生成…") : "",
    isImportingMedia ? _ui("正在看你的素材…") : voice.isTranscribing ? _ui("正在听你说…") : mediaQuestion ? _ui("等待你的确认 · 也可以继续发送其他内容") : isReplying ? _ui("正在思考 · 可以继续输入") : "",
    staticVideoContext ? "" : contextStatus,
  ];
  const companionAvatar = desktopStoryMenu ? <StoryLogoMenu
    {...desktopStoryMenu} element={element} visualTheme={visualTheme} placement="top"
    trigger={awake => <ChatAssistantAvatar awake={awake} visualTheme={visualTheme} element={element}
      mood={isReplying || videoProgress ? "thinking" : undefined} notificationKey={lastAssistantId}
      activity={generatingCount > 0 || creationFlow.busy || videoProgress ? "generating" : isImportingMedia || voice.isTranscribing ? "reading" : isReplying ? "thinking" : "idle"}
      animated={isReplying || Boolean(videoProgress) || generatingCount > 0 || creationFlow.busy || isImportingMedia || voice.isTranscribing} />}
  /> : <ChatAssistantAvatar visualTheme={visualTheme} element={element}
    mood={isReplying ? "thinking" : undefined} notificationKey={lastAssistantId} animated={isReplying} />;
  const compactActivity = cutProgress || contentEdits.statusMessage || videoProgress || (isReplying ? _ui("已收到，正在处理 · 可以继续输入") : companionMessages.find(Boolean));
  const composerActivity = compactActivity ? (<p role="status" aria-live="polite" className="text-[11px] leading-4 text-muted-foreground" data-testid="chat-edit-status">
          {compactActivity}
          {contentEdits.resumeInstruction && <button type="button" disabled={Boolean(input.trim())} className="ml-1 text-primary underline disabled:opacity-40"
            onClick={() => { setInput(contentEdits.resumeInstruction!); resizeAndFocusInput(); }}>{language === "en" ? "Restore request" : "重填要求"}</button>}
        </p>) : null;
  const shotComposerContext = selectedChatShot ? (<div className="flex min-w-0 items-center gap-1" data-testid="chat-shot-context-row">
            {!activeSelection?.imageId && pausedFrameChat.panel}
            <button type="button" aria-expanded={showingShotHistory}
              title={videoContext}
              className="shrink-0 rounded px-1 text-left text-[11px] text-muted-foreground focus-visible:outline focus-visible:outline-2"
              onClick={() => { setClosedShotHistory(showingShotHistory ? shotHistoryKey : null); if (!showingShotHistory && activeStoryId && selectedChatShot) focusShotChat(activeStoryId, selectedChatShot.stableShotId ?? selectedChatShot.shotIdentity!); }}>
              {_ui("第 {0} 镜", [displayShotCode(selectedChatShot)])}{selectedImageFrame ? ` · ${selectedImageFrame.shotTimeSec.toFixed(2)}s` : activeSelection?.videoTakeId ? ` · Take ${activeSelection.videoTakeId}` : ""}
            </button>
            {workspaceContext === "video" && activeStoryId && creationEditor?.activeStoryId === activeStoryId && <>
              <span className="text-[11px] text-muted-foreground">·</span>
              <WarehouseCompletionNotice storyId={activeStoryId} shots={creationEditor.shots} materialState={creationEditor.materialState}
                stableShotId={selectedChatShot.stableShotId ?? selectedChatShot.shotIdentity} compact />
            </>}
            <button type="button" aria-label={_ui("取消选中")} onClick={clearSelection} className="ml-auto shrink-0 rounded p-1 hover:bg-foreground/10"><X className="h-3 w-3" /></button>
          </div>) : null;

  return (
    <div
      className="monitor-panel relative h-full flex flex-col"
      onDragEnter={
        interactionMode === "story" || showCreationActions ? handleMediaDragEnter : undefined
      }
      onDragOver={interactionMode === "story" || showCreationActions ? handleMediaDragOver : undefined}
      onDragLeave={
        interactionMode === "story" || showCreationActions ? handleMediaDragLeave : undefined
      }
      onDrop={interactionMode === "story" || showCreationActions ? handleMediaDrop : undefined}
      ref={chatRootRef}
      data-picture-regions={workspaceContext === "video" && activeStoryId ? "true" : undefined}
      data-testid="story-agent-media-dropzone"
    >
      {workspaceContext === "video" && activeStoryId && creationEditor?.materialState?.storyId === activeStoryId &&
        <ChatImageRegionHover key={`${accountId}:${activeStoryId}:${scopeEpoch}:${activeSelection?.stableShotId}:${activeSelection?.sourceId}`}
          root={chatRootRef} images={inlineImages} en={language === "en"}
          onPick={(image, region?: PictureRegion) => {
            if (!region) { void referenceChatImage(image.imageId!); return; }
            const current = inlineImagesRef.current.find(item => item.imageId === image.imageId && item.imageUrl === image.imageUrl);
            const state = storySpineStore.getState();
            if (!current || state.accountId !== accountId || state.activeStoryId !== activeStoryId) return;
            const en = language === "en";
            const epoch = draftEpoch.current;
            const note = pictureRegionNote(region, { text: "", object: "", available: false }, en);
            const update = inlineInputRef.current?.selectRegion(current, note);
            if (!update) return;
            void pictureReader.fetch({ storyId: activeStoryId, imageId: image.imageId!, region }, { retry: false }).then(result => {
              const latest = storySpineStore.getState();
              if (epoch === draftEpoch.current && latest.storyScopeEpoch === state.storyScopeEpoch && latest.accountId === accountId &&
                  latest.activeStoryId === activeStoryId && latest.activeSelection?.sourceId === state.activeSelection?.sourceId)
                update(pictureRegionNote(region, result, en));
            }).catch(() => { /* The exact selection is already in the draft. */ });
          }} />}
      {(interactionMode === "story" || showCreationActions) && isMediaDragActive ? (
        <div
          className="pointer-events-none absolute inset-2 z-50 flex items-center justify-center rounded-md border-2 border-dashed bg-background/92"
          style={{ borderColor: "var(--nayin-accent)" }}
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <UploadCloud className="h-5 w-5 text-nayin-bright" />
            {_ui("放入聊聊素材篮")}</div>
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
          title={_ui("返回列表")}
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <div className="status-dot" />
        <span>{_ui("聊聊 · 创作对话")}</span>
        <span className="ml-auto flex items-center gap-2">
          {cardRefs.length > 0 && (
            <span
              className="text-[10px] font-mono px-1.5 py-0.5 rounded-full"
              style={{
                background: "var(--nayin-glow)",
                color: "var(--nayin-accent-bright)",
              }}
            >
              {cardRefs.length} {_ui("张卡片")}</span>
          )}
          <span
            className="hidden items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded-full sm:inline-flex"
            style={{
              background: "var(--nayin-glow)",
              color: "var(--nayin-accent-bright)",
            }}
            title={_ui(saveTitle)}
          >
            {saveStatus === "saving" ? (
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
            ) : (
              <Cloud className="h-2.5 w-2.5" />
            )}
            {_ui(saveLabel)}
          </span>
          <button
            type="button"
            onClick={resetConversation}
            className="text-[10px] opacity-50 hover:opacity-100 transition-opacity flex items-center gap-1"
            title={_ui("开始一个新故事，不删除云端故事库里的旧故事")}
          >
            <RefreshCcw className="w-3 h-3" />
            {_ui("新故事")}</button>
        </span>
      </div>

      <div
        className="border-b px-3 py-2.5"
        style={{ borderColor: "var(--panel-border)" }}
      >
        <section
          className="story-context-surface rounded-md border px-3 py-2"
          data-active-selection={activeSelection ? "true" : "false"}
          style={{
            borderColor: activeSelection
              ? "var(--nayin-accent-dim)"
              : "var(--panel-border)",
            background: activeSelection
              ? "var(--nayin-glow)"
              : "var(--panel-header)",
          }}
          aria-label={_ui("聊聊当前上下文")}
        >
          <div className="group flex items-start gap-2.5">
            {visualTheme === "shiguang" ? (
              <StoryCoverThumbnail
                src={activeStoryCoverImageUrl}
                className="h-[68px] w-[50px] rounded-[8px] shadow-[0_3px_10px_rgba(67,83,62,0.12)]"
              />
            ) : null}
            <span className="mt-0.5 shrink-0 text-nayin-bright">
              <Link2 className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5 text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
                <span>{_ui("当前故事")}</span>
                <span>·</span>
                <span>{_ui(intentLabel(currentIntent))}</span>
              </div>
              {isRenamingTitle ? (
                <div className="mt-1 flex items-center gap-1" data-renaming="true">
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
                    aria-label={_ui("故事名称")}
                    className="h-7 min-w-0 flex-1 rounded border border-[var(--nayin-accent-dim)] bg-background px-2 text-[12px] font-semibold outline-none ring-2 ring-[var(--nayin-glow)]"
                  />
                  <button
                    type="button"
                    onClick={() => void saveStoryTitle()}
                    disabled={isSavingTitle || !titleDraft.trim()}
                    aria-label={_ui("保存故事名称")}
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
                    aria-label={_ui("取消修改故事名称")}
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
                    aria-label={_ui("修改故事名称")}
                    title={_ui("修改故事名称")}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-65 transition hover:bg-[var(--nayin-glow)] hover:text-nayin-bright hover:opacity-100"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      {workspaceContext === "video" ? <FrameReviewRecovery storyId={activeStoryId} busy={isReplying} /> : null}
      <StoryChatContents
        key={`${accountId}:${activeStoryId}`}
        messages={conversationMessages}
        disabled={creationBlocked}
        onLocate={id => {
          const node = messageNodes.current.get(id);
          if (!node) return;
          const message = conversationMessages.find(message => message.id === id);
          if (message && activeStoryId) focusWarehouseConversation(message, activeStoryId);
          readingHistory.current = true;
          node.focus({ preventScroll: true });
          node.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
        }}
        onLatest={() => {
          readingHistory.current = false;
          scrollToLatestMessage();
        }}
      />
      <div
        ref={scrollRef}
        onLoadCapture={handleRevisionContentChange}
        onWheel={() => { readingHistory.current = true; }}
        onTouchMove={() => { readingHistory.current = true; }}
        className={`monitor-panel-body story-chat-scroll-surface min-h-0 ${bookMedia ? "max-h-12 shrink-0" : "flex-1"} overflow-y-auto custom-scrollbar space-y-3 pr-1`}
      >
        {showingShotHistory && selectedChatShot && creationEditor && activeStoryId && (
          <ShotChatInspector key={`history:${shotHistoryKey}`}
            storyId={activeStoryId} shot={selectedChatShot} fields={creationEditor.storyboardFieldVersions}
            videoHistory={creationEditor.materialState?.timeline.extensions?.videoEditHistory}
            archiveImages={creationEditor.materialState?.warehouseImages}
            relatedImageIds={[...[...(shotMaterial?.relatedImages ?? []), ...(shotMaterial?.imageVersions ?? [])].map(image => image.id), ...shotExplicitImageIds(selectedChatShot)]}
            imageUrl={selectedChatShot.imageUrl ?? undefined}
            selectedImageId={activeSelection?.imageId} onSelectImage={referenceCandidate} />
        )}
        <ChatImageRevisionCards revisions={revisionSlots.get(null) ?? []} onContentChange={handleRevisionContentChange}
          onSelectImage={referenceCandidate} selectedImageId={activeSelection?.imageId} onOpenShot={openConversationShot} shotLabel={labelForShot} />
        <AnimatePresence key={`messages:${showingShotHistory ? shotHistoryKey : "all"}`} initial={false}>
          {conversationMessages.map(m => (
            <Fragment key={m.id}>
            <motion.div
              key={m.id}
              ref={node => { if (node) messageNodes.current.set(m.id, node); else messageNodes.current.delete(m.id); }}
              tabIndex={-1}
              data-chat-message-id={m.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className={`flex scroll-mt-3 items-start gap-2 rounded-md outline-none focus:ring-1 focus:ring-primary/40 ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-[12.5px] leading-relaxed ${
                  m.role === "user" ? "rounded-tr-sm" : "desktop-companion-bubble border"
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
                {showingShotHistory && m.role === "user" && !m.selectionQuote && !m.imageRevision && (
                  <p className="mb-1 text-[10px] opacity-70">{_ui("旧对话中的镜号提及")}</p>
                )}
                {/* The opaque reply covers the character's lower body, never its text. */}
                {m.selectionQuote && !isFeedbackActivityId(m.id) && !m.id.startsWith(localNotePrefix) && !m.id.startsWith(localReplyPrefix) && !m.imageRevision && m.imageEditPlan?.status !== 'submitted' && m.id !== inlineQuoteMessage?.id && m.selectionQuote.selectedText !== m.content && (
                  <div className="mb-1.5">
                    <SelectionContextCard
                      selection={currentShotQuote(m.selectionQuote)}
                      onOpen={m.selectionQuote.storyId === activeStoryId && activeStoryId && isFeedbackQuote(m.selectionQuote)
                        ? () => toast.info(focusFeedbackQuote(activeStoryId, m.selectionQuote!))
                        : m.selectionQuote.storyId === activeStoryId && m.selectionQuote.stableShotId ? () => openConversationShot(m.selectionQuote!.stableShotId!) : undefined}
                      compact
                    />
                  </div>
                )}
                {!m.frameReview && m.frameReferences?.length ? <ChatFrameReferences shotLabel={labelForShot} showThumbnails={m.id.startsWith("first-draft:")} frames={m.frameReferences} storyId={activeStoryId} selectedImageId={activeSelection?.imageId} onSelect={referenceCandidate} /> : null}
                {m.imageRevision ? (
                  <div className="mb-1 flex items-center gap-2">
                    <ChatImageReferenceChip imageId={m.imageRevision.imageId} imageUrl={m.imageRevision.imageUrl} onReference={() => referenceCandidate(m.imageRevision!)} />
                    <button type="button" className="text-[10px] underline" aria-label={_ui("选中新版图片继续修改")}
                      disabled={m.imageRevision.storyId !== activeStoryId}
                      onClick={() => referenceCandidate(m.imageRevision!)}>
                      {_ui("继续修改")}
                    </button>
                  </div>
                ) : null}
                {m.role === "user" && m.photoUrl && (
                  <img
                    src={m.photoUrl}
                    alt={_ui("用户上传照片")}
                    className={`h-28 max-w-full rounded-xl border border-white/20 object-cover ${
                      m.content.trim() ? "mb-1.5" : ""
                    }`}
                  />
                )}
                {latestCue && m.id!==cueTurn?.reply.id && m.id.startsWith("video-cues:") && m.role==="assistant" && m.selectionQuote?.storyId===activeStoryId &&
                  <button type="button" className="mb-1 text-xs underline" aria-label={"继续此视频对话："+(messages.find(row=>cueReplyId(row.id)===m.id)?.content??"").slice(0,55)}
                    onClick={()=>setOpenedCue({id:m.id,latest:latestCue.reply.id,openedAt:Date.now()})}>继续此视频对话</button>}
                {m.role === "assistant" && m.id.startsWith(localReplyPrefix) && activeStoryId && accountId ? (() => {
                  const note = messages.find(row=>row.id===localNotePrefix+m.id.slice(localReplyPrefix.length));
                  const shot = creationEditor?.shots.find(s=>(s.stableShotId ?? s.shotIdentity) === m.selectionQuote?.stableShotId);
                  const pending = m.selectionQuote?.objectVersion === "local-feedback-pending" || (note && m.content === startingLocalFeedback(note.content));
                  return <div className="space-y-1">{pending && !localFeedback.errors[m.id]
                    ? <VideoFeedbackActivity localEdit storyId={activeStoryId} id={feedbackActivityId(m.id.slice(localReplyPrefix.length))} text={"制作中\n"+m.content}/>
                    : <p role="status">{pending && localFeedback.errors[m.id] || m.content}</p>}
                    {pending && localFeedback.errors[m.id] && <button type="button" className="underline" onClick={()=>localFeedback.retry(m.id)}>重新连接</button>}
                    {!pending && shot && m.selectionQuote?.videoTakeId && <VideoTakeChatReview key={m.selectionQuote.videoTakeId} takeId={m.selectionQuote.videoTakeId}
                      accountId={accountId} storyId={activeStoryId} shot={shot} savedText="" images={[]} onFeedback={localFeedback.submit}/>}
                  </div>;
                })() : m.role === "assistant" && activeStoryId && isFeedbackActivityId(m.id) ? (
                  <VideoFeedbackActivity id={m.id} storyId={activeStoryId} text={m.content} />
                ) : m.id === cueTurn?.reply.id && cueShot && activeStoryId && accountId ? (reviewTakeId(cueTurn.request.content)
                  ? <VideoTakeChatReview key={`${accountId}:${activeStoryId}:${cueTurn.request.id}`} accountId={accountId} storyId={activeStoryId} shot={cueShot} request={cueTurn.request} savedText={m.content} images={inlineImages} onFeedback={localFeedback.submit}/>
                  : <ChatVideoCuePlan key={`${accountId}:${activeStoryId}:${cueTurn.request.id}`} accountId={accountId} storyId={activeStoryId} shot={cueShot} request={cueTurn.request} savedText={m.content} images={inlineImages} />) : m.content.trim() && m.imageEditPlan?.status !== 'submitted' && !(m.id === inlineQuoteMessage?.id && ["generating", "pending", "done", "error"].includes(remix.status)) && (
                  <p
                    className="whitespace-pre-wrap"
                    data-chat-message-text
                    data-selection-source={`chat:${m.id}`}
                  >
                    {(m.role === 'user' || m.id.startsWith('saved-photos:')) && hasInlineChatImages(m.content) ? chatPictureParts(m.content).map((part, index) => {
                      const image = part.imageId && inlineImages.find(image => image.imageId === part.imageId);
                      if (image && m.id.startsWith('saved-photos:')) return <ChatPhotoPreview key={index} src={image.imageUrl} imageId={part.imageId} name={`#${part.imageId}`} saved onReference={workspaceContext === "video" ? () => referenceChatImage(part.imageId!, m.selectionQuote?.stableShotId) : undefined} />;
                      return image ? <ChatImageReferenceChip key={`${m.id}:${index}`} imageId={part.imageId!} imageUrl={image.imageUrl} note={part.note} onReference={workspaceContext === "video" ? () => referenceChatImage(part.imageId!, undefined, part.note) : undefined} /> : part.imageId ? `图片 #${part.imageId}` : workspaceContext === "video" && m.id.startsWith("saved-photos:") ? part.text.replace(/点放大镜看原图|点缩略图(?:可看原图|看大图)/g, "悬停放大，拖框可选区域").replace("Select a photo to see it full size.", "Hover to enlarge and drag to select an area.") : part.text;
                    }) : m.role === 'assistant' && m.bookRewrite ? <BookFormattedText text={displayAssistantName(stripAssistantReasoning(m.content))} /> : tokenizeChatMessageText(
                      m.role === "assistant"
                        ? displayAssistantName(stripAssistantReasoning(m.content))
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
                {workspaceContext === "video" && m.role === "assistant" && m.id.startsWith("start-shot:") && activeStoryId && accountId && m.selectionQuote?.storyId === activeStoryId && creationEditor?.activeStoryId === activeStoryId && (
                  <NextShotDraftButton message={m} storyId={activeStoryId} accountId={accountId} shots={creationEditor.shots} hasDraft={messages.some(row => row.id === "first-draft:" + m.id)} />
                )}
                {workspaceContext === 'video' && m.imageEditPlan && !messages.some(message => message.id === confirmedImageEditPlanId(m.id) || message.id === adjustedImageEditPlanId(m.id) || message.id === localEraseReceiptId(m.id)) && <KeyframePlanDisclosure message={m}><ChatImageEditPlanCard storyId={m.selectionQuote?.storyId} plan={m.imageEditPlan} planId={m.id} onReference={referenceChatImage}
                  onErased={receipt => {
                    const state = storySpineStore.getState();
                    if (state.accountId !== accountId || state.storyScopeEpoch !== scopeEpoch || state.activeStoryId !== m.selectionQuote?.storyId) return;
                    state.setMessages(rows => rows.some(row => row.id === receipt.id) ? rows : [...rows, {
                      id: receipt.id, role: "assistant", content: receipt.text, timestamp: receipt.timestamp, selectionQuote: m.selectionQuote,
                    }]);
                    if (state.activeSelection?.stableShotId === activeSelection?.stableShotId) followCurrentConversation(m.selectionQuote);
                  }}
                  disabled={isReplying || remix.status === 'generating' || Boolean(busyImageBatch) || Boolean(imageEditPurchase) || Boolean(m.selectionQuote && m.selectionQuote.storyId !== activeStoryId)}
                  batch={m.imageEditPlan.status === 'submitted' && activeStoryId && m.selectionQuote?.storyId === activeStoryId ? <ChatImageEditBatch
                    key={`${activeStoryId}:${m.id}`} storyId={activeStoryId} planMessageId={m.id}
                    disabled={isReplying || remix.status === 'generating' || Boolean(busyImageBatch && busyImageBatch !== m.id) || Boolean(imageEditPurchase && imageEditPurchase.planMessageId !== m.id)}
                    purchase={imageEditPurchase?.storyId === activeStoryId && imageEditPurchase.planMessageId === m.id ? imageEditPurchase : undefined}
                    onPurchaseConsumed={() => setImageEditPurchase(current => current?.planMessageId === m.id ? null : current)}
                    onBusyChange={busy => setBusyImageBatch(current => busy ? m.id : current === m.id ? null : current)}
                    onSelect={referenceCandidate} /> : undefined}
                  onChange={plan => {
                    if (!activeStoryId || storySpineStore.getState().activeStoryId !== activeStoryId) return;
                    storySpineStore.getState().setMessages(current => m.imageEditPlan?.status === 'submitted'
                      ? current.some(message => message.id === adjustedImageEditPlanId(m.id)) ? current : [...current, { ...m, id: adjustedImageEditPlanId(m.id), timestamp: Date.now(), imageEditPlan: plan }]
                      : current.map(message => message.id === m.id ? { ...message, imageEditPlan: plan } : message));
                  }}
                  onSubmit={() => {
                    const state = storySpineStore.getState();
                    if (!activeStoryId || state.activeStoryId !== activeStoryId || isReplying || remix.status === 'generating' || busyImageBatch || imageEditPurchase) return;
                    const saved = state.messages.find(message => message.id === m.id);
                    const plan = saved?.imageEditPlan;
                    const selectionQuote = saved?.selectionQuote;
                    const planMessageId = confirmedImageEditPlanId(m.id);
                    if (!plan || plan.status !== 'draft' || imageEditGenerationError(plan) || state.messages.some(message => message.id === planMessageId || message.id === adjustedImageEditPlanId(m.id)) || selectionQuote?.storyId !== activeStoryId || !selectionQuote.stableShotId) return;
                    const { unitCny: unitEstimatedCny, totalCny } = imageEditPlanQuote(plan);
                    state.setMessages(current => [...current,
                      { id: crypto.randomUUID(), role: 'user', content: imageEditPlanReply(plan, totalCny), timestamp: Date.now(), selectionQuote },
                      { id: planMessageId, role: 'assistant', content: '修改要求和预计费用已确认，正在提交生成。结果会显示在这里并存入仓库，不替换剪辑。', imageEditPlan: { ...plan, status: 'submitted' as const }, timestamp: Date.now() + 1, selectionQuote },
                    ]);
                    setImageEditPurchase({ storyId: activeStoryId, planMessageId, stableShotId: selectionQuote.stableShotId, unitEstimatedCny, plan });
                    followCurrentConversation();
                  }}
                  onQuote={(imageId, copy) => {
                    if (!activeStoryId || storySpineStore.getState().activeStoryId !== activeStoryId || remix.status === 'generating') return;
                    const saved = storySpineStore.getState().messages.find(message => message.id === m.id);
                    if (!saved?.imageEditPlan || saved.selectionQuote?.storyId !== activeStoryId || !saved.selectionQuote.stableShotId) return;
                    const plan = saved.imageEditPlan;
                    const selectionQuote = saved.selectionQuote;
                    try {
                      const output = imageEditPlanOutput(plan, imageId, copy);
                      const shot = creationEditor?.shots.find(shot => (shot.stableShotId ?? shot.shotIdentity) === selectionQuote.stableShotId);
                      if (!shot) throw new Error('原镜头已变化，请先重新核对。');
                      const target = { stableShotId: saved.selectionQuote.stableShotId, shotNo: shot.shotNo };
                      if (!remix.arm(output.instruction, output.refs, target)) return;
                      const quoteId = crypto.randomUUID();
                      remixMessage.current = { storyId: activeStoryId, quoteId, selection: storySpineStore.getState().activeSelection };
                      const quote = formatComputeQuote(estimateStoryboardMaskedEditCost().estimatedCny);
                      storySpineStore.getState().setMessages(current => [...current,
                        { id: crypto.randomUUID(), role: 'user', content: `${output.refs.map(ref => `[[ref:image%3A${ref.imageId}]]`).join(' ')}\n${output.instruction}`, timestamp: Date.now(), selectionQuote },
                        { id: quoteId, role: 'assistant', content: `已收到 ${output.refs.length} 张引用，仅修改图片 #${imageId}，生成第 ${copy} 张候选。预计 ${quote}，尚未开始改图。确认后提交，原图与剪辑保留。`, timestamp: Date.now() + 1, selectionQuote: { ...selectionQuote, selectedText: '图片修改报价' } },
                      ]);
                      followCurrentConversation();
                    } catch (error) { toast.error(error instanceof Error ? error.message : '无法准备这张图片的报价'); }
                  }} /></KeyframePlanDisclosure>}
                {workspaceContext === 'video' && failedImageEdit && messages.at(-1)?.id === m.id &&
                  (failedImageEdit.failureId === m.id || (failedImageEdit.quoteId === m.id && remix.status === 'idle')) && <ChatImageEditRecovery request={failedImageEdit}
                  disabled={isReplying || voice.isBusy || isImportingMedia || creationFlow.busy || remix.status === 'generating' || Boolean(input.trim()) || pendingMedia.length > 0}
                  onQuote={() => {
                    const state = storySpineStore.getState();
                    if (state.activeStoryId !== activeStoryId || isReplying || voice.isBusy || isImportingMedia || creationFlow.busy || input.trim() || pendingMedia.length > 0 || remix.status === 'generating') return;
                    const request = failedImageEditRecovery(state.messages, activeStoryId, inlineImages) ?? quotedImageEditRecovery(state.messages, activeStoryId, inlineImages);
                    if (!request || (request.failureId !== m.id && request.quoteId !== m.id) || creationEditor?.activeStoryId !== request.storyId) return;
                    const shot = creationEditor?.shots.find(shot => (shot.stableShotId ?? shot.shotIdentity) === request.stableShotId);
                    if (!shot) { toast.error('原镜头已变化，请先重新核对。'); return; }
                    if (!remix.arm(request.instruction, [request.ref], {stableShotId:request.stableShotId,shotNo:shot.shotNo,selectionImageId:request.ref.imageId})) return;
                    remixMessage.current = {storyId:request.storyId,quoteId:request.quoteId,selection:state.activeSelection};
                    const quoteMessages = recoveredImageEditQuoteMessages(request, formatComputeQuote(estimateStoryboardMaskedEditCost().estimatedCny), Date.now());
                    storySpineStore.getState().setMessages(current => current.some(message => message.id === request.quoteId) ? current : [...current,...quoteMessages]);
                    followCurrentConversation();
                  }} />}
                {workspaceContext === "video" && m.id === inlineQuoteMessage?.id && (
                  remix.status === "confirming" ? <div className="mt-2 flex gap-2">
                    <button type="button" className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground" onClick={() => void remix.confirm(m.id)}>确认并生成</button>
                    {inlineQuoteRequest && m.selectionQuote?.stableShotId && <button type="button" className="rounded border px-2 py-1 text-xs" onClick={() => {
                      const selectionQuote = m.selectionQuote;
                      if (storySpineStore.getState().activeStoryId !== selectionQuote?.storyId) return;
                      try {
                        const { refs, instruction } = compileInlineChatDraft(inlineQuoteRequest, inlineImages);
                        const plan = createChatImageEditPlan(refs, instruction);
                        plan.renderRoute = 'storyboard';
                        if (refs.length > 1) {
                          plan.mode = 'compose';
                          plan.images = plan.images.map((image, index) => index === 0
                            ? { ...image, role: 'target' }
                            : { ...image, role: 'reference', purpose: '按原话中对这张图的说明参考。' });
                        }
                        plan.preserve ||= '沿用原图美术风格，保留用户未要求改动的内容。';
                        remix.cancel();
                        storySpineStore.getState().setMessages(rows => [...rows, { id: crypto.randomUUID(), role: 'assistant', content: '请核对出图流程和合计费用。', timestamp: Date.now(), selectionQuote, imageEditPlan: plan }]);
                      } catch (error) { toast.error(error instanceof Error ? error.message : '请重新核对参考图。'); }
                    }}>查看省算力报价</button>}
                    <button type="button" className="rounded border px-2 py-1 text-xs" onClick={() => {
                      remix.cancel();
                      storySpineStore.getState().setMessages(current => [...current, { id: crypto.randomUUID(), role: "assistant", content: "已取消这次图片修改报价，未生成、未扣费，原图和剪辑保留。", timestamp: Date.now(), selectionQuote: m.selectionQuote }]);
                    }}>取消</button>
                  </div> : remix.status !== "idle" ? <ChatImageRemixTray onReference={referenceChatImage} remix={{ ...remix, refs: [] }} />
                    : inlineQuoteRequest && failedImageEdit?.quoteId !== m.id ? <button type="button" disabled={Boolean(input.trim())} className="mt-1 text-xs underline disabled:opacity-40"
                      onClick={() => { setInput(inlineQuoteRequest); resizeAndFocusInput(); }}>重填要求，重新核对报价</button> : null
                )}
                {m.frameReview ? <div className="mt-2"><ChatFrameRegionReview shotLabel={labelForShot} onContentChange={handleRevisionContentChange} review={m.frameReview} storyId={activeStoryId} selectedImageId={activeSelection?.imageId} onSelect={referenceCandidate}
                  onFeedback={frame => { if (frame.storyId === activeStoryId) selectConversationImage(frame, true); }} imageRevisions={frameImageRevisions.data} pendingCloudRequests={pendingCloudRequests} /></div> : null}
                {m.role === "user" && renderQueueStatus(m.id)}
                {m.role === 'assistant' && m.bookRewrite && <BookRewriteButton proposal={m.bookRewrite} storyId={activeStoryId} />}
                {m.promptCandidate ? (
                  <div className="mt-2 border-t border-border/60 pt-2">
                    <div className="text-[10px] text-muted-foreground">
                      {m.promptCandidate.label}
                      {m.promptCandidate.status === "pending"
                        ? _ui(" · 等待确认")
                        : m.promptCandidate.status === "confirmed"
                          ? _ui(" · 已确认")
                          : _ui(" · 已拒绝")}
                    </div>
                    {m.promptCandidate.status === "pending" ? (
                      <div className="mt-1.5 flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => void confirmSelectionCandidate(m.id)}
                          className="inline-flex h-7 items-center gap-1 rounded-md bg-[var(--nayin-accent)] px-2 text-[10px] font-medium text-background"
                        >
                          <Check className="h-3 w-3" />
                          {_ui("确认修改")}</button>
                        <button
                          type="button"
                          onClick={() => void rejectSelectionCandidate(m.id)}
                          className="inline-flex h-7 items-center rounded-md border border-border px-2 text-[10px] text-muted-foreground"
                        >
                          {_ui("不采用")}</button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {!workspaceContext && m.imageRerenderAction &&
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
                        ? _ui("确认修改后可重渲")
                        : _ui("重新渲染 {0}", [m.imageRerenderAction.cueCode ??
                            String(m.imageRerenderAction.shotNo).padStart(
                              4,
                              "0"
                            )])}
                    </button>
                    <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                      {_ui("点击后先核对参考帧和预计算力消耗；确认后才提交，旧候选会保留。")}</p>
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
                    <span className="text-nayin-bright">{_ui("+ 1 张卡片入册")}</span>
                  </div>
                )}
              </div>
            </motion.div>
            <ChatImageRevisionCards revisions={revisionSlots.get(m.id) ?? []} onContentChange={handleRevisionContentChange}
              onSelectImage={referenceCandidate} selectedImageId={activeSelection?.imageId} onOpenShot={openConversationShot} shotLabel={labelForShot} />
            </Fragment>
          ))}
        </AnimatePresence>
        {workspaceContext === "video" && activeStoryId != null && activeStoryId > 0 && <ArtPreviewGallery shotCode={id => { const shot = creationEditor?.shots.find(s => (s.stableShotId ?? s.shotIdentity) === id); return shot && displayShotCode(shot); }} key={`previews:${activeStoryId}`} storyId={activeStoryId} includePlans onReference={referenceChatImage} />}
        {activeStoryId != null && activeStoryId > 0 && <BookVideoChat key={`${accountId}:${activeStoryId}:${scopeEpoch}`} storyId={activeStoryId} accountId={accountId} epoch={scopeEpoch} session={bookVideo} handle={bookVideoHandle} onProgressChange={onVideoProgressChange} onAdopt={async()=>{await loadStory(activeStoryId,{silent:true,expectedActiveStoryId:activeStoryId})}} />}
        {activeStoryId != null && activeStoryId > 0 && <BookImageCompositionHistory key={`images:${accountId}:${activeStoryId}:${scopeEpoch}`} storyId={activeStoryId} session={composition} handle={compositionHandle} onContinue={()=>resizeAndFocusInput()} />}


        {soundDirector.active ? (
          <div className="space-y-2" aria-live="polite">
            <SoundDirectorQuestionCard director={soundDirector} />
            <SoundPlanTable director={soundDirector} />
            {soundDirector.conflictRevision != null ? (
              <section
                role="alert"
                className="w-[96%] rounded-md border border-amber-300 bg-amber-50 px-2.5 py-2 text-[10px] leading-relaxed text-amber-900"
              >
                {_ui("另一处页面已经更新了声音方案。你当前输入还保留在本页，请先载入较新的版本再决定如何合并。")}<button
                  type="button"
                  onClick={() => void soundDirector.refreshAfterConflict()}
                  className="ml-2 underline underline-offset-2"
                >
                  {_ui("载入最新方案")}</button>
              </section>
            ) : null}
            {soundDirector.error ? (
              <p
                role="alert"
                className="w-[96%] text-[10px] leading-relaxed text-destructive"
              >
                {soundDirector.error}
              </p>
            ) : null}
          </div>
        ) : null}

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
              aria-label={_ui("聊聊素材归类建议")}
            >
              <header className="flex items-center gap-1.5 px-2.5 py-2">
                {visualTheme === "nayin" ? (
                  <EmotiveWuxingIcon
                    element={element}
                    size={26}
                    mood="thinking"
                  />
                ) : null}
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold">{_ui("素材归类建议")}</p>
                  <p className="text-[9.5px] text-muted-foreground">
                    {_ui("采纳后才会进入对应镜头")}</p>
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
                    alt={_ui("待归类图片")}
                    className="h-11 w-11 shrink-0 rounded object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1 text-[9.5px] font-medium">
                      <span className="text-nayin-bright">
                        {_ui(materialAdviceLabel(advice.verdict))}
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
                        {advice.videoDirection.cameraMove || _ui("固定镜头")} ·{" "}
                        {advice.videoDirection.durationSec}s ·{" "}
                        {advice.videoDirection.emotionalTone || _ui("情绪待定")}
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
                        {_ui("放入")}{" "}
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
              evidence={
                pendingIntentDraft.proposal?.evidence ??
                pendingIntentDraft.evidence
              }
              hasPublishingVersion={hasPublishingVersion}
              busy={
                pendingIntentCommitProposalId ===
                pendingIntentDraft.proposal?.id
              }
              acceptLabel={
                hasPublishingVersion ? _ui("到发布工作区确认新版本") : undefined
              }
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
                {_ui("查看用途或观众变化建议")}</button>
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
                {_ui("接着上次聊")}</span>
              <span
                className="flex-1 border-t"
                style={{ borderColor: "var(--panel-border)" }}
              />
            </div>
            <div className="flex items-start justify-start gap-2">
              <div
                className="desktop-companion-bubble max-w-[85%] rounded-2xl border px-3 py-2 text-[12.5px] leading-relaxed"
                style={{
                  background: "var(--card)",
                  borderColor: "var(--nayin-accent-dim)",
                  color: "var(--foreground)",
                }}
              >
                <p className="whitespace-pre-wrap">{returningGreeting}</p>
              </div>
            </div>
          </motion.div>
        )}

        {workspaceContext === "video" && activeStoryId != null && activeStoryId > 0 && <ChatImageRevisionGallery key={`revisions:${accountId}:${activeStoryId}`} storyId={activeStoryId} hidden onContentChange={handleRevisionContentChange} />}

        {workspaceContext === "video" && twoImages.state && (!showingShotHistory || twoImages.state.draft.shotId === activeSelection?.stableShotId) && <section className="mt-2 space-y-2 rounded-md border border-border p-2" aria-label={_ui("对话图片候选")}>
          {twoImages.state.status === "confirming" && <p className="text-xs">{_ui("第 {0} 镜生成两张图，预计 {1}。回复“确认”或“取消”。", [twoImages.state.draft.shotLabel, formatComputeQuote(twoImages.state.draft.unitCost * 2).replace(/算力$/, _ui("算力"))])}</p>}
          {twoImages.state.status === "generating" && <p className="text-xs">{_ui("正在生成两张图，你可以继续聊天。")}</p>}
          {twoImages.state.candidates.length > 0 && <div className="grid grid-cols-2 gap-2">{twoImages.state.candidates.map(image => <figure key={image.imageId}><button type="button" aria-pressed={activeSelection?.imageId === image.imageId} className="block w-full rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--nayin-accent)] aria-pressed:ring-2 aria-pressed:ring-[var(--nayin-accent)]" onClick={() => referenceChatImage(image.imageId, twoImages.state!.draft.shotId)}><img src={image.imageUrl} alt={_ui("第 {0} 张", [image.index + 1])} className="w-full rounded object-contain" /></button><figcaption className="text-xs">{_ui("第 {0} 张", [image.index + 1])}{twoImages.state?.adopted.includes(image.index) ? ` · ${_ui("已加入镜头")}` : ""}</figcaption></figure>)}</div>}
          {twoImages.state.status === "done" && <p className="text-xs">{_ui("图片已完成并保存到仓库。点击图片，再说出你的想法。")}</p>}
          {twoImages.state.error && <p role="status" className="text-xs text-muted-foreground">{_ui(twoImages.state.error)}</p>}
        </section>}

        {workspaceContext === "video" && !selectedChatShot && activeStoryId && activeStoryId > 0 && creationEditor?.activeStoryId === activeStoryId &&
          <WarehouseCompletionNotice key={`warehouse-notice:${accountId}:${activeStoryId}`} storyId={activeStoryId}
            shots={creationEditor.shots} materialState={creationEditor.materialState}
            stableShotId={null}
            onContentChange={handleRevisionContentChange} />}

        {workspaceContext === "video" && splitChat.panel}
        {workspaceContext === "video" && contentEdits.panel}

        {chatQueue.items.filter(item => !messages.some(message => message.id === item.id)).map(item => (
          <div key={item.id} className="flex justify-end"
            ref={node => { if (node) messageNodes.current.set(item.id, node); else messageNodes.current.delete(item.id); }}>
            <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-[var(--nayin-accent)] px-3 py-2 text-[12.5px] text-[var(--background)]">
              <p className="whitespace-pre-wrap" data-chat-message-text>{item.text}</p>
              {renderQueueStatus(item.id)}
            </div>
          </div>
        ))}

      </div>

      {/* Input */}
      <div className="story-chat-composer px-3 pb-2 min-h-0 flex flex-col gap-1.5 bg-transparent" data-compact-video={workspaceContext === "video" || undefined}>
        {interactionMode === "publishing" ? (
          <div className="pt-2.5">
            <PublishingPlatformPicker compact />
          </div>
        ) : null}
        {bookMedia && <BookMediaChat key={`${bookMedia.key}:${bookMedia.imageUrl}`} session={bookMedia} handle={bookMediaHandle} />}
        {/* Quote block */}
        {interactionMode === "story" && !selectedChatShot && activeSelection && !layoutContext && (
          <div className="mt-2.5">
            <SelectionContextCard
              selection={activeSelection}
              onClear={clearSelection}
              compact={activeSelection.sourceType === "storyboard-image"}
              imageUrl={selectedImage?.imageUrl}
              readiness={activeSelectionReadiness}
              productionContext={workspaceContext === "video" && !activeSelection.selection && ["shot", "storyboard-image", "animatic-video"].includes(activeSelection.sourceType) && activeSelectionReadiness?.status !== "stale"}
            />
          </div>
        )}

        {!selectedChatShot && workspaceContext === "video" && contentEdits.statusMessage && composerActivity}

        {interactionMode === "story" && workspaceContext !== "video" ? (
          <ChatImageRemixTray remix={remix} />
        ) : null}
        {interactionMode === "story" && imageTextResult ? (
          <article
            className="mt-1.5 rounded-md border border-border bg-background px-2.5 py-2"
            aria-label={_ui("图片本地编辑结果")}
            data-testid="chat-image-local-edit-result"
          >
            <div className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
              {imageTextResult.rotated ? (
                <RotateCw className="h-3 w-3" />
              ) : (
                <ScanText className="h-3 w-3" />
              )}
              <span>
                {_ui("图片 #")}{imageTextResult.imageId}
                {imageTextResult.rotated ? _ui(" · 已倒转 180°") : ""}
              </span>
              <button
                type="button"
                onClick={() => setImageTextResult(null)}
                className="ml-auto rounded p-1 hover:bg-muted"
                aria-label={_ui("关闭图片处理结果")}
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
                      current
                        ? { ...current, text: event.target.value }
                        : current
                    )
                  }
                  rows={5}
                  aria-label={_ui("聊天框 OCR 识别结果")}
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
                  {_ui("复制文字")}</button>
              </>
            ) : (
              <p className="mt-1.5 text-[10px] text-muted-foreground">
                {imageTextResult.rotated
                  ? _ui("构图变换已保存。")
                  : _ui("没有识别到文字。")}
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
                    <ChatPhotoPreview src={attachment.previewUrl} name={attachment.file.name} />
                  ) : attachment.kind === "file" ? (
                    <span className="flex h-full items-center justify-center p-1 text-[10px] break-all">{attachment.file.name}</span>
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
                  <span className="pointer-events-none absolute bottom-1 left-1 flex h-4 w-4 items-center justify-center rounded bg-black/65 text-white">
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
                    aria-label={_ui("移除 {0}", [attachment.file.name])}
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </figure>
              ))}
            </div>
            <p className="mt-0.5 truncate text-[9.5px] text-muted-foreground">
              {pendingMedia.length} {pendingMedia.some(item => item.kind === "video") ? _ui("个素材待发送 · 视频暂放当前镜头") : _ui("个文件待发送")}</p>
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
                {_ui(voice.isLive ? "听写中，文字会显示在输入框" : "录音中，点停止后文字会出现在聊天输入框里")}</>
            ) : (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                {_ui(voice.status === "requesting" ? "等待浏览器启动语音输入，再点一次可取消" : "正在把声音转成文字…")}</>
            )}
          </div>
        )}

        <ChatComposerDock enabled={Boolean(selectedChatShot)} avatar={companionAvatar}
          activityText={compactActivity ?? ""} summary={<>{shotComposerContext}{composerActivity}</>}>
          <ChatComposerTools horizontal={workspaceContext === "video"}
            showAttachments={interactionMode === "story" || showCreationActions}
            isReplying={isReplying} isImportingMedia={isImportingMedia}
            soundDirectorActive={soundDirector.active} voice={voice}
            voiceOptions={!voice.isBusy && <ChatVoiceOptions key={`${accountId}:${activeStoryId}`}
              notice={voiceNotice?.message ?? ""} allowLocal={allowLocalTranscription} disabled={isImportingMedia}
              onFocusDraft={voiceNotice?.recovery === "keyboard" ? resizeAndFocusInput : undefined}
              onDismiss={() => setVoiceNotice(null)} onFile={file => { feedbackClock.begin(!input.trim()); void voice.transcribeLocalFile(file); }}
              onRecord={() => {
                feedbackClock.begin(!input.trim());
                pausedFrameChat.begin();
                if (allowLocalTranscription) void voice.startLocalRecording();
                else voice.toggleRecording();
              }} />}
            onFiles={stageMediaFiles} onVoice={() => {
              setVoiceNotice(null);
              if (voice.status === "idle") { feedbackClock.begin(!input.trim()); pausedFrameChat.begin(); }
              voice.toggleRecording();
            }} />
          <div className="chat-dock-editor desktop-companion-input min-w-0 flex-1">
        {!selectedChatShot && <div className="desktop-companion-composer flex min-w-0 items-end gap-1.5 pl-3" data-testid="chat-composer-companion" data-theme={visualTheme}>
          {companionAvatar}
          <section aria-label={layoutContext ? _ui("当前模块上下文") : _ui("当前文字上下文")} className="min-w-0 flex-1">
            {staticVideoContext && <p className="text-[11px] leading-relaxed text-muted-foreground" aria-live="polite">{staticVideoContext}</p>}
            {(isReplying || companionMessages.some(Boolean)) && <ChatCompanionStatus key={videoProgressScope} messages={companionMessages}
              priority={cutProgress || (isReplying ? _ui("已收到，正在处理 · 可以继续输入") : undefined)} />}
            {writingSnapshot?.layoutMemory && <LayoutMemoryDetails memory={writingSnapshot.layoutMemory} accountId={accountId} />}
          </section>
        </div>}
          {mediaQuestion && <article className="mb-3 max-h-56 overflow-y-auto rounded-lg border border-border bg-background p-3 text-xs leading-relaxed" aria-label={_ui("制作确认")}>
            <p className="whitespace-pre-wrap">{mediaQuestion.text}</p>
            {mediaQuestion.videoUrl && <video src={mediaQuestion.videoUrl} controls preload="metadata" className="mt-2 max-h-48 w-full rounded" />}
            <p className="mt-2 text-muted-foreground">{_ui(mediaQuestion.kind === "placement" ? "回复“放入”或“先保留”即可。" : "回复“确认”开始，或回复“取消”。")}</p>
          </article>}
          {!selectedChatShot && !activeSelection?.imageId && pausedFrameChat.panel}
          {scanStatus && <p role="status" className="text-xs text-muted-foreground">{scanStatus}</p>}
          {feedbackPreview && <p role="status" data-testid="timeline-feedback-location" className="text-[11px] text-muted-foreground">
            {feedbackPreview.error ?? feedbackPreview.label}
          </p>}
          {workspaceContext === "video" ? <InlineChatComposer
            key={`${accountId}:${activeStoryId}`} ref={inlineInputRef} value={[input, voicePreview].filter(Boolean).join(" ")}
            images={inlineImages} placeholder={_ui(inputPlaceholder)}
            disabled={isImportingMedia || Boolean(voicePreview) || (soundDirector.active && !soundDirector.session?.question && !parseSoundChat(input))}
            onChange={text => { feedbackClock.change(text); pausedFrameChat.change(text); setInput(text); }}
            onSubmit={() => void handleSubmit()} onError={message => toast.info(message)}
          /> : <textarea
            ref={inputRef}
            rows={3}
            value={[input, voicePreview].filter(Boolean).join(" ")}
            readOnly={Boolean(voicePreview)}
            onChange={e => {
              pausedFrameChat.change(e.target.value);
              setInput(e.target.value);
              // auto-resize
              const ta = e.currentTarget;
              ta.style.height = "auto";
              ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
            }}
            onKeyDown={handleKey}
            placeholder={_ui(inputPlaceholder)}
            disabled={
              isImportingMedia ||
              (soundDirector.active && !soundDirector.session?.question && !(workspaceContext && parseSoundChat(input)))
            }
            className={`relative z-[1] block w-full min-h-[68px] max-h-40 resize-none rounded-lg border px-3 py-2 text-xs leading-relaxed bg-transparent focus:outline-none focus:ring-2 transition-shadow disabled:opacity-60`}
            style={{
              borderColor: "var(--panel-border)",
              // @ts-expect-error custom prop for tailwind ring color via inline style
              "--tw-ring-color": "var(--nayin-accent)",
            }}
          />}
          </div>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={
              (!input.trim() && pendingMedia.length === 0) ||
              (isReplying && pendingMedia.length > 0) ||
              (soundDirector.active && !layoutContext && !soundDirector.session?.question && !(workspaceContext && parseSoundChat(input))) ||
              voice.isBusy ||
              isImportingMedia
            }
            className="chat-dock-send h-8 w-8 shrink-0 rounded-full flex items-center justify-center transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:shadow-nayin"
            style={{
              background: "var(--nayin-accent)",
              color: "var(--background)",
              boxShadow: "0 2px 12px -4px var(--nayin-glow)",
            }}
            aria-label={_ui("发送")}
          >
            {isImportingMedia ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
          </button>
        </ChatComposerDock>
        {activeSelection?.sourceType === "storyboard-image" && workspaceContext !== "video" ? (
          <div className="mt-1 flex items-center justify-end gap-2">
            <select
              aria-label={_ui("改图模型")}
              value={revisionProvider}
              onChange={event => setRevisionProvider(event.target.value as "midjourney" | "gpt-image")}
              disabled={isReplying}
              className="h-7 min-w-0 rounded-md border border-[var(--panel-border)] bg-background px-1 text-[11px]"
            >
              <option value="gpt-image">{_ui("GPT Image · 改图")}</option>
              <option value="midjourney">{_ui("MJ · 重绘")}</option>
            </select>
            <button
              type="button"
              className="inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-md border border-[var(--panel-border)] px-2 text-[11px] font-medium text-[var(--nayin-accent)] transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)] disabled:cursor-not-allowed disabled:opacity-45"
              onClick={() => void handleRegenerateImage()}
              disabled={isReplying || voice.isBusy || isImportingMedia || pendingMedia.length > 0 || soundDirector.active}
            >
              {isReplying ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCcw className="h-3 w-3" />}
              {isReplying ? _ui("生成中…") : _ui("重新生成图")}
            </button>
          </div>
        ) : null}
        <div className="flex flex-wrap items-start justify-end gap-2" data-testid="chat-creation-actions">
        <div className={activeSelection?.sourceType === "storyboard-image" ? "hidden" : "contents"}>
        <button type="button" disabled={!input.trim() || isReplying}
          className="mt-1 inline-flex h-7 shrink-0 items-center rounded-md border border-[var(--panel-border)] px-2 text-[11px] transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)] disabled:opacity-45"
          onClick={() => requestMemoryCard({ content: input, origin: "note", sourceStoryId: (remoteStoryId ?? activeStoryId ?? 0) > 0 ? (remoteStoryId ?? activeStoryId) : null })}>
          {_ui("单独记一条")}</button>
        <TextDraftVersions
          key={`${remoteStoryId ?? activeStoryId}:${publishing?.activePlatform ?? "xiaohongshu"}`}
          storyId={remoteStoryId ?? activeStoryId ?? null}
          input={input}
          blocked={isReplying || chatQueue.items.length > 0 || voice.isBusy || isImportingMedia || pendingMedia.length > 0 || soundDirector.active}
        />
        </div>
        {showCreationActions && <StudioCreateMenu
          storyId={remoteStoryId ?? activeStoryId ?? null}
          input={input}
          blocked={creationBlocked}
          hasShots={hasStudioShots}
        />}
        </div>

      </div>
    </div>
  );
}
