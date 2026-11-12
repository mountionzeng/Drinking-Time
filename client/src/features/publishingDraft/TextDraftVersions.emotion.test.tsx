import React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { emptyPublishingDraftState } from "@shared/publishingDraft";
const hooks = vi.hoisted(() => ({ states: [] as any[], refs: [] as any[], state: 0, ref: 0 }));
vi.mock("react", async () => ({
  ...await vi.importActual<typeof import("react")>("react"),
  useState(initial: any) { const i = hooks.state++; if (!(i in hooks.states)) hooks.states[i] = typeof initial === "function" ? initial() : initial; return [hooks.states[i], (next: any) => { hooks.states[i] = typeof next === "function" ? next(hooks.states[i]) : next; }]; },
  useRef(initial: any) { const i = hooks.ref++; return hooks.refs[i] ?? (hooks.refs[i] = { current: initial }); },
  useEffect() {},
}));
const fixture = vi.hoisted(() => ({ state: null as any, writing: null as any, fetch: vi.fn(), generate: vi.fn() }));
vi.mock("@/features/storyAgent/spine/storySpine", () => ({ storySpineStore: { getState: () => fixture.state } }));
vi.mock("@/features/storyAgent/StoryAgentContext", () => ({ useStoryAgent: () => fixture.state, useStoryAgentActions: () => ({}) }));
vi.mock("@/features/uiLanguage/UiLanguage", () => ({ useUiText: () => (s: string) => s }));
vi.mock("@/features/writingCompanion/desktopWritingSession", () => ({
  useDesktopWritingSession: Object.assign((select: any) => select({session: fixture.writing}), { getState: () => ({session: fixture.writing}) }),
}));
vi.mock("./FilmVersionDraft", () => ({ FilmVersionDraft: () => null }));
vi.mock("@/lib/trpc", () => ({ trpc: {
  useUtils: () => ({ textDrafts: { read: { fetch: fixture.fetch, setData: vi.fn() } } }),
  bookWorkflow: { videoSource: { useQuery: () => ({ data: { available: false }, isSuccess: true }) } },
  textSourceLineage: { impact: { useQuery: () => ({}) } },
  textDrafts: { read: { useQuery: () => ({data: {revision: 0, versions: []}}) }, generate: { useMutation: () => ({mutateAsync: fixture.generate}) }, adopt: { useMutation: () => ({}) }, setLearning: { useMutation: () => ({}) } },
} }));
import { TextDraftVersions } from "./TextDraftVersions";
function nodes(node: any): any[] { return !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)]; }
function draw() { hooks.state = hooks.ref = 0; return nodes(TextDraftVersions({storyId: 7, input: "保留小茶杯", blocked: false})); }
async function generate() {
  let tree=draw(); tree.find(n=>n.type==="input" && n.props.value==="text").props.onChange(); tree=draw();
  const button=tree.find(n=>n.type==="button" && n.props.onClick?.toString().includes("generateVersion"));
  expect(button).toBeDefined(); button.props.onClick();
  await vi.waitFor(()=>expect(fixture.generate).toHaveBeenCalledOnce());
  return fixture.generate.mock.calls[0][0];
}
beforeEach(()=>{
  hooks.states=[];hooks.refs=[];vi.clearAllMocks();vi.stubGlobal("React",React);
  fixture.state={activeStoryId:7,remoteStoryId:7,accountId:"account-a",storyScopeEpoch:1,storyLoadEpoch:1,publishing:emptyPublishingDraftState(),publishingBuffers:{},messages:[]};
  fixture.writing={storyId:7,accountId:"account-a",epoch:1,snapshot:{draft:"茶杯放在桌面"},getSnapshot:()=>({draft:"茶杯放在桌面",chapterId:"12",scope:"a:7:chapter:12",cursor:0})};
  fixture.fetch.mockResolvedValue({revision:0,versions:[]});fixture.generate.mockResolvedValue({revision:1,versions:[]});
});
it("sends the current chapter identity and current unsaved text through the actual generate handler",async()=>{
  expect(await generate()).toMatchObject({emotionChapterId:"12",basis:{body:"茶杯放在桌面"},outputFormat:"book-latex"});
});
it.each(["account","epoch","story"])("does not attach a stale %s writing session to a new request",async kind=>{
  if(kind==="account")fixture.writing.accountId="another-account";
  if(kind==="epoch")fixture.writing.epoch=0;
  if(kind==="story")fixture.writing.storyId=8;
  const request=await generate();expect(request.emotionChapterId).toBeUndefined();expect(request.basis).toBeNull();
});
it("does not infer a chapter from a legacy scope string alone",async()=>{
  fixture.writing.getSnapshot=()=>({draft:"茶杯放在桌面",scope:"a:7:chapter:999",cursor:0});
  expect((await generate()).emotionChapterId).toBeUndefined();
});
