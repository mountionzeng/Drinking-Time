import { and, eq } from "drizzle-orm";
import type { SelectionContext } from "../../shared/selectionContext";
import {
  storyConversationMessages,
  storyConversations,
  storyMessageReferences,
} from "../../drizzle/schema";
import {
  getStoryVideoTakeRanges,
  getVideoTakeById,
  getGeneratedImageById,
} from "../db";
import { getDb } from "../db";
import {
  createPersistentLocalPromptLineageStore,
  loadStoryPromptAggregate,
  PromptLineageOwnershipError,
  PromptLineageValidationError,
} from "./promptLineageStore";

type ConversationOwner = {
  storyId: number;
  userId: number;
};

export type AppendStoryConversationTurnInput = ConversationOwner & {
  userMessage: {
    clientMessageId: string;
    content: string;
    selection?: SelectionContext | null;
  };
  assistantMessage: {
    clientMessageId: string;
    content: string;
    candidateRevisionId?: number | null;
  };
};

function referenceObjectId(selection: SelectionContext): string {
  if (selection.rangeId != null) return String(selection.rangeId);
  if (selection.imageId != null) return String(selection.imageId);
  if (selection.videoTakeId != null) return String(selection.videoTakeId);
  return selection.stableShotId?.trim() || selection.sourceId;
}

export async function validateStorySelectionContext(
  owner: ConversationOwner,
  selection: SelectionContext,
): Promise<SelectionContext> {
  if (selection.storyId != null && selection.storyId !== owner.storyId) {
    throw new PromptLineageOwnershipError("选择引用不属于当前故事");
  }
  const aggregate = await loadStoryPromptAggregate(owner);
  if (!aggregate) {
    throw new PromptLineageValidationError("故事提示词尚未迁移");
  }
  let stableShotId = selection.stableShotId?.trim() || null;
  let imageId = selection.imageId ?? null;
  let videoTakeId = selection.videoTakeId ?? null;
  let rangeId = selection.rangeId ?? null;
  if (selection.imageId != null) {
    const image = await getGeneratedImageById(selection.imageId);
    if (
      !image ||
      image.storyId !== owner.storyId ||
      image.userId !== owner.userId ||
      (selection.stableShotId != null &&
        image.shotIdentity != null &&
        image.shotIdentity !== selection.stableShotId)
    ) {
      throw new PromptLineageOwnershipError("图片引用不属于当前故事");
    }
    stableShotId = stableShotId ?? image.shotIdentity;
    imageId = image.id;
  }
  if (selection.rangeId != null) {
    const ranges = await getStoryVideoTakeRanges(owner.storyId, owner.userId);
    const range = ranges.find(candidate => candidate.id === selection.rangeId);
    if (
      !range ||
      (videoTakeId != null && range.takeId !== videoTakeId) ||
      (stableShotId != null && range.stableShotId !== stableShotId)
    ) {
      throw new PromptLineageOwnershipError("时间范围不属于当前故事");
    }
    stableShotId = stableShotId ?? range.stableShotId;
    videoTakeId = videoTakeId ?? range.takeId;
    rangeId = range.id;
  }
  if (videoTakeId != null) {
    const take = await getVideoTakeById(videoTakeId, owner.userId);
    if (
      !take ||
      take.storyId !== owner.storyId ||
      (stableShotId != null && take.stableShotId !== stableShotId)
    ) {
      throw new PromptLineageOwnershipError("视频引用不属于当前故事");
    }
    stableShotId = stableShotId ?? take.stableShotId;
    videoTakeId = take.id;
  }
  if (
    stableShotId &&
    !aggregate.nodes.some(node => node.stableShotId === stableShotId)
  ) {
    throw new PromptLineageOwnershipError("镜头引用不属于当前故事");
  }
  const objectVersion =
    imageId != null
      ? `image:${imageId}`
      : videoTakeId != null
        ? `video:${videoTakeId}`
        : (selection.objectVersion ?? null);
  const sourceId =
    rangeId != null
      ? String(rangeId)
      : imageId != null
        ? String(imageId)
        : videoTakeId != null
          ? String(videoTakeId)
          : selection.sourceId;
  return {
    ...selection,
    sourceId,
    objectVersion,
    storyId: owner.storyId,
    stableShotId,
    imageId,
    videoTakeId,
    rangeId,
  };
}

export async function listStoryConversation(owner: ConversationOwner) {
  const aggregate = await loadStoryPromptAggregate(owner);
  if (!aggregate) {
    throw new PromptLineageValidationError("故事提示词尚未迁移");
  }
  return {
    conversation: aggregate.conversation,
    messages: aggregate.messages,
    references: aggregate.messageReferences,
    candidates: aggregate.messages.flatMap(message => {
      if (message.candidateRevisionId == null) return [];
      const revision = aggregate.revisions.find(
        item => item.id === message.candidateRevisionId,
      );
      const node = revision
        ? aggregate.nodes.find(item => item.id === revision.nodeId)
        : null;
      if (!revision || !node) return [];
      return [
        {
          messageId: message.id,
          revisionId: revision.id,
          nodeId: node.id,
          expectedVersion: aggregate.state.version,
          label: node.dimension,
          status:
            revision.status === "candidate"
              ? ("pending" as const)
              : revision.status,
        },
      ];
    }),
  };
}

export async function appendStoryConversationTurn(
  input: AppendStoryConversationTurnInput,
) {
  const owner = { storyId: input.storyId, userId: input.userId };
  const userContent = input.userMessage.content.trim();
  const assistantContent = input.assistantMessage.content.trim();
  if (!userContent || !assistantContent) {
    throw new PromptLineageValidationError("对话消息不能为空");
  }
  const selection = input.userMessage.selection
    ? await validateStorySelectionContext(owner, input.userMessage.selection)
    : null;
  if (input.assistantMessage.candidateRevisionId != null) {
    const aggregate = await loadStoryPromptAggregate(owner);
    if (
      !aggregate?.revisions.some(
        revision =>
          revision.id === input.assistantMessage.candidateRevisionId,
      )
    ) {
      throw new PromptLineageOwnershipError(
        "候选提示词引用不属于当前故事",
      );
    }
  }

  const db = await getDb();
  if (!db) {
    const store = await createPersistentLocalPromptLineageStore();
    await store.appendConversationTurn(owner, {
      messages: [
        {
          role: "user",
          content: userContent,
          source: "story-agent",
          clientMessageId: input.userMessage.clientMessageId,
          reference: selection
            ? {
                objectType: selection.sourceType,
                objectId: referenceObjectId(selection),
                objectVersion: selection.objectVersion ?? null,
                selection,
              }
            : null,
        },
        {
          role: "assistant",
          content: assistantContent,
          source: "story-agent",
          clientMessageId: input.assistantMessage.clientMessageId,
          candidateRevisionId:
            input.assistantMessage.candidateRevisionId ?? null,
        },
      ],
    });
    return listStoryConversation(owner);
  }

  await db.transaction(async tx => {
    await tx
      .insert(storyConversations)
      .values(owner)
      .onDuplicateKeyUpdate({
        set: { updatedAt: new Date() },
      });
    const [conversation] = await tx
      .select()
      .from(storyConversations)
      .where(
        and(
          eq(storyConversations.storyId, input.storyId),
          eq(storyConversations.userId, input.userId),
        ),
      )
      .limit(1);
    if (!conversation) {
      throw new PromptLineageValidationError("无法创建故事会话");
    }

    const append = async (message: {
      role: "user" | "assistant";
      content: string;
      clientMessageId: string;
      candidateRevisionId?: number | null;
      selection?: SelectionContext | null;
    }) => {
      const [existing] = await tx
        .select()
        .from(storyConversationMessages)
        .where(
          and(
            eq(storyConversationMessages.conversationId, conversation.id),
            eq(
              storyConversationMessages.clientMessageId,
              message.clientMessageId,
            ),
          ),
        )
        .limit(1);
      if (existing) return;
      const [inserted] = await tx.insert(storyConversationMessages).values({
        ...owner,
        conversationId: conversation.id,
        role: message.role,
        content: message.content,
        source: "story-agent",
        clientMessageId: message.clientMessageId,
        candidateRevisionId: message.candidateRevisionId ?? null,
      });
      if (message.selection) {
        await tx.insert(storyMessageReferences).values({
          ...owner,
          messageId: inserted.insertId,
          objectType: message.selection.sourceType,
          objectId: referenceObjectId(message.selection),
          objectVersion: message.selection.objectVersion ?? null,
          selection: message.selection,
        });
      }
    };

    await append({
      role: "user",
      content: userContent,
      clientMessageId: input.userMessage.clientMessageId,
      selection,
    });
    await append({
      role: "assistant",
      content: assistantContent,
      clientMessageId: input.assistantMessage.clientMessageId,
      candidateRevisionId: input.assistantMessage.candidateRevisionId,
    });
    await tx
      .update(storyConversations)
      .set({ updatedAt: new Date() })
      .where(eq(storyConversations.id, conversation.id));
  });

  return listStoryConversation(owner);
}
