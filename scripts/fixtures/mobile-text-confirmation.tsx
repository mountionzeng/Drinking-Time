// Local browser QA fixture; imported only by verify-mobile-text-confirmation.cjs. All reads and writes use fictional in-memory data.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { observable } from "@trpc/server/observable";
import { trpc } from "../../client/src/lib/trpc";
import { MobileImageStudio } from "../../client/src/features/mobileWorkspace/MobileImageStudio";
import { MobileStoryWorkspace } from "../../client/src/features/mobileWorkspace/MobileStoryWorkspace";
import { UiLanguageProvider } from "../../client/src/features/uiLanguage/UiLanguage";
import { NayinProvider } from "../../client/src/features/nayin/NayinContext";
import { MobileNewStoryCompanion } from "../../client/src/features/mobileWorkspace/MobileNewStoryCompanion";
import { MobileMemoryFollowup } from "../../client/src/features/mobileWorkspace/mobileMemoryFollowup";
import {
  emptyPublishingDraftState,
  upsertPublishingPlatformDraft,
} from "../../shared/publishingDraft";
import "../../client/src/index.css";
const content = {
  title: "雨中的旧伞",
  body: "爷爷把旧伞放在窗边。窗外的雨下了一整夜，屋里留着淡淡的茶香。\n\n第二天清早，他修好了松动的伞骨，说这把伞还可以陪我们走很远。",
  tags: [],
};
let publishing = emptyPublishingDraftState();
let history: any = {
  revision: 7,
  versions: [
    {
      id: "qa-draft-1",
      sequence: 1,
      status: "ready",
      generated: content,
      request: { platform: "xiaohongshu", operationToken: "qa-draft-1" },
      memoryCards: [],
    },
  ],
};
const calls: any[] = [];
const qa: any = {
  calls,
  concurrentChange: () => {
    publishing = { ...publishing, revision: publishing.revision + 1 };
  },
  publishing: () => publishing,
};
(window as any).__qa = qa;
const client = trpc.createClient({
  links: [
    () =>
      ({ op }) =>
        observable(observer => {
          calls.push({
            path: op.path,
            type: op.type,
            input: structuredClone(op.input),
          });
          Promise.resolve()
            .then(() => {
              let data: any;
              switch (op.path) {
                case "textDrafts.read":
                  data = history;
                  break;
                case "storyConversation.list":
                  data = {
                    messages: [
                      {
                        id: "qa-msg",
                        role: "assistant",
                        content: "可以保留修伞这个细节，把结尾写得更轻一些。",
                        createdAt: 1792800000000,
                      },
                    ],
                  };
                  break;
                case "publishingDraft.read":
                  data = {
                    publishing,
                    coverRounds: [],
                    coverAsset: null,
                    coverEstimate: { estimatedCny: 0.34 },
                  };
                  break;
                case "publishingDraft.readBody":
                  data = null;
                  break;
                case "artworkShare.layout":
                  data = { candidates: [], inherited: null };
                  break;
                case "storyAgent.storyMaterialState":
                  data = { storyId: 777777, shots: [], unassignedImages: [] };
                  break;
                case "storyContextShare.backStatus":
                  data = { available: true };
                  break;
                case "textDrafts.adopt": {
                  const input: any = op.input;
                  if (
                    input.expectedPublishingRevision !== publishing.revision ||
                    input.expectedRevision !== history.revision
                  ) {
                    observer.error(
                      new Error("发布稿已变化，请刷新并检查最新文字后再采用")
                    );
                    return;
                  }
                  publishing = upsertPublishingPlatformDraft(publishing, {
                    platform: "xiaohongshu",
                    content: input.content,
                    activate: true,
                  });
                  history = {
                    ...history,
                    revision: history.revision + 1,
                    versions: history.versions.map((v: any) =>
                      v.id === input.versionId
                        ? { ...v, adoption: { content: input.content } }
                        : v
                    ),
                  };
                  data = { publishing, history };
                  break;
                }
                default:
                  if (op.type === "mutation")
                    throw new Error("Unexpected mutation " + op.path);
                  data = null;
              }
              observer.next({ result: { data: structuredClone(data) } });
              observer.complete();
            })
            .catch(e => observer.error(e));
        }),
  ],
});
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
function Main() {
  const mode = new URLSearchParams(location.search).get("mode");
  const [stage, setStage] = useState<any>("text");
  const [doc, setDoc] = useState<any>(null);
  const [workingText, setWorkingText] = useState({
    ...content,
    body: (content.body + "\n\n").repeat(8),
  });
  qa.updateText = (body: string) =>
    setWorkingText(current => ({ ...current, body }));
  const controller: any = {
    state: doc,
    loadState: doc ? "ready" : "empty",
    hasUnsavedChanges: false,
    retryLoad: async () => {
      const draft = publishing.drafts[publishing.activePlatform];
      if (draft)
        setDoc({
          status: "clean",
          body: draft.content.body,
          document: {
            platform: publishing.activePlatform,
            versionId: "v1",
            bodyRevision: 1,
          },
        });
    },
    save: async () => {},
    editBody: () => {},
  };
  return (
    <main className="h-dvh bg-background text-foreground">
      {mode === "writing" ? (
        <NayinProvider>
          <MobileMemoryFollowup.Provider
            value={{
              source: {
                storyId: 777777,
                id: "text:current",
                kind: "text",
                title: content.title,
                origin: "note",
                content: workingText.body,
                text: {
                  content: workingText,
                  parentId: null,
                  platform: "xiaohongshu",
                  versionId: "v1",
                  bodyRevision: 1,
                },
              },
              select: () => {},
            }}
          >
            <MobileNewStoryCompanion userId={999999} />
          </MobileMemoryFollowup.Provider>
        </NayinProvider>
      ) : mode === "text" ? (
        <MobileStoryWorkspace
          userId={999999}
          storyId={777777}
          title={content.title}
          stage={stage}
          onStageChange={setStage}
          onBack={() => {}}
          document={controller}
          conversation={{} as any}
        />
      ) : (
        <MobileImageStudio
          userId={999999}
          storyId={777777}
          onBack={() => {
            qa.back = true;
          }}
        />
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={client} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <UiLanguageProvider>
        <Main />
      </UiLanguageProvider>
    </QueryClientProvider>
  </trpc.Provider>
);
