// Isolated browser regression: real editor + store, fictional in-memory transport.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { observable } from "@trpc/server/observable";
import { trpc } from "../../client/src/lib/trpc";
import PublishingDraftWorkspace from "../../client/src/features/publishingDraft/PublishingDraftWorkspace";
import { storySpineStore } from "../../client/src/features/storyAgent/spine/storySpine";
import { emptyPublishingDraftState, upsertPublishingPlatformDraft, applyPublishingWordingEdit } from "../../shared/publishingDraft";
import { emptyFinishedProductState } from "../../shared/finishedProductVersion";
import { Toaster } from "sonner";
import "../../client/src/index.css";
const content = { title: "雨中的旧伞", body: "这是一个虚构故事。朋友 B 的文字版本：爷爷修好了那把旧伞。", tags: [] };
let publishing = upsertPublishingPlatformDraft({
  ...emptyPublishingDraftState(),
  core: { revision: 1, facts: ["虚构故事"], thesis: "旧物承载记忆", emotion: "温暖", voiceTraits: [], visualConcept: "旧伞", updatedAt: 1 },
}, { platform: "xiaohongshu", content });
storySpineStore.setState({ activeStoryId: 777777, publishing, publishingBuffers: {}, storyTitle: content.title });
const qa: any = { calls: [], hold: false, fail: false, release: () => {}, state: () => storySpineStore.getState(), saved: () => publishing };
(window as any).__qa = qa;
const client = trpc.createClient({ links: [() => ({ op }) => observable(observer => {
  qa.calls.push({ path: op.path, type: op.type, input: structuredClone(op.input) });
  Promise.resolve().then(async () => {
    let data: any = null;
    if (op.path === "publishingDraft.applyEdit") {
      if (qa.hold) await new Promise<void>(resolve => { qa.release = resolve; });
      if (qa.fail) throw new Error("这份发布稿已经在别处更新，请刷新后再应用");
      const input = op.input as any;
      publishing = applyPublishingWordingEdit(publishing, input.platform, input.content);
      data = { publishing, storyId: 777777, status: "applied" };
    } else if (op.path === "publishingDraft.generateCover") {
      // Stops at a synthetic quote response; never contacts an image provider.
      data = { status: "confirmation_required", estimate: { estimatedCny: 0.34, currency: "CNY" } };
    } else if (op.type === "mutation") {
      throw new Error(`Unexpected mutation: ${op.path}`);
    } else if (op.path === "publishingDraft.read") {
      data = { storyId: 777777, publishing, coverRounds: [], coverAsset: null, coverEstimate: { estimatedCny: 0.34 } };
    } else if (op.path === "publishingDraft.finishedProduct") {
      data = { publishing, finishedProduct: emptyFinishedProductState() };
    } else if (op.path === "textDrafts.read") {
      data = { revision: 0, versions: [] };
    } else if (op.path === "artworkShare.layout") {
      data = { candidates: [], inherited: null };
    }
    observer.next({ result: { data } });
    observer.complete();
  }).catch(error => observer.error(error));
})] });
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } } });
function Workspace() {
  const [view, setView] = useState<"text" | "images">("text");
  return <main className="mx-auto flex h-screen max-w-4xl flex-col">
    <button onClick={() => setView(view === "text" ? "images" : "text")}>切换测试工作区</button>
    <PublishingDraftWorkspace view={view} onOpenImages={() => setView("images")} />
  </main>;
}
createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={client} queryClient={queryClient}><QueryClientProvider client={queryClient}>
    <Workspace /><Toaster />
  </QueryClientProvider></trpc.Provider>
);
