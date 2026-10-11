export function readyDraft(id: string, sequence = 1) {
  return {
    id,
    sequence,
    status: "ready",
    requestHash: id,
    createdAt: 1,
    request: {
      storyId: 1,
      operationToken: "test-operation",
      expectedRevision: 0,
      platform: "xiaohongshu",
      parentId: null,
      basis: null,
      messages: [],
      instruction: "",
      source: "unknown",
    },
    conversationSnapshot: [],
    conversationDelta: [],
    promptVersion: "1",
    libraryVersion: "1",
    systemPrompt: "",
    modelMessage: "",
    generated: { title: id, body: `正文 ${id}`, tags: [] },
  };
}
