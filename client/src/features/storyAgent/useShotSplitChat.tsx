import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatComputeQuote } from "@shared/computeMoney";
import { estimateViduQ2TransitionCny } from "@shared/videoRenderCost";
import { parseShotSplitChat, type ShotSplitPlan } from "@shared/shotSplitChat";
import { useUiLanguage } from "@/features/uiLanguage/UiLanguage";
import type { useOptionalCreationEditor } from "@/features/creationEditor/CreationEditorContext";
import { storySpineStore } from "./spine/storySpine";
import { hasMediaChatSession } from "./mediaChatSession";

type Editor = NonNullable<ReturnType<typeof useOptionalCreationEditor>>;
type Proposal = { storyId:number; epoch:number; stableShotId:string; shotNo:number; plan:ShotSplitPlan; images:Array<{id:number;imageUrl:string}>; quote:number; message:string; phase:"quote"|"ready"|"applying"|"done" };

/** Plans and applies only a reversible edit. Rendering keeps its separate quote. */
export function useShotSplitChat(input: {storyId:number|null; stableShotId?:string|null; editor:Editor|null}) {
  const utils = trpc.useUtils();
  const { language } = useUiLanguage();
  const en = language === "en";
  const [state,setState] = useState<Proposal|null>(null);
  const [notice,setNotice] = useState<{storyId:number|null;message:string}|null>(null);
  const active = useRef<Proposal|null>(null);
  const current = (s:Proposal) => active.current === s && storySpineStore.getState().activeStoryId === s.storyId && storySpineStore.getState().storyScopeEpoch === s.epoch;
  const publish = (s:Proposal) => { if(current(s)) setState({...s}); };
  const visible = state?.storyId === input.storyId && state.epoch === storySpineStore.getState().storyScopeEpoch ? state : null;
  const dismiss = () => { active.current=null;setState(null);setNotice(null); };
  const explain = (zh:string,english:string) => { dismiss();setNotice({storyId:input.storyId,message:en?english:zh});return true; };
  const record = (s:Proposal,role:"user"|"assistant",content:string) => {
    if(!current(s)) return;
    storySpineStore.getState().setMessages(messages=>[...messages,{id:crypto.randomUUID(),role,content,timestamp:Date.now(),selectionQuote:{sourceType:"shot",sourceId:s.stableShotId,storyId:s.storyId,stableShotId:s.stableShotId,shotNo:s.shotNo,selectedText:content}}]);
  };
  const handle = async (text:string) => {
    const s = active.current;
    if(s && current(s) && /^(取消|cancel)[。.!！]?$/i.test(text.trim()) && s.phase !== "applying") {record(s,"user",text);record(s,"assistant",en?"Cancelled. Nothing changed.":"已取消，镜头未改。");dismiss();return true;}
    if(s && current(s) && /^(确认拆镜|confirm split|取消|cancel)[。.!！]?$/i.test(text.trim()) && (s.phase === "applying" || s.phase === "quote")) return true;
    if (s && current(s) && s.phase === "ready" && /^(确认拆镜|confirm split|取消|cancel)[。.!！]?$/i.test(text.trim())) {
      if (/取消|cancel/i.test(text)) {dismiss();return true;}
      record(s,"user",text);
      s.phase="applying";s.message=en?"Splitting shot…":"正在保存拆镜方案…";publish(s);
      try {
        await input.editor!.splitTimelineVideoClip({stableShotId:s.stableShotId,cutFrame:Math.floor((s.plan.expectedStartFrame+s.plan.expectedEndFrame)/2),startEndPlan:s.plan});
        s.message=en?"Split saved. Previous video timing, music and subtitles are retained. Ask to generate either shot to review its current quote.":"两段首尾帧方案已保存，原视频切片、音乐和字幕时序保留。说“生成第几镜视频”可查看当前报价，再决定生成。";
      } catch(error) {s.message=error instanceof Error?error.message:"拆镜未完成";}
      s.phase="done";publish(s);record(s,"assistant",s.message);return true;
    }
    const command=parseShotSplitChat(text);
    if(!command) return false;
    if(!input.storyId || !input.editor) return explain("请先打开视频剪辑台；尚未调用模型。","Open the video editor first. No model was called.");
    if(s && current(s) && s.phase === "applying") return true;
    if(hasMediaChatSession(input.storyId)) return explain("请等当前任务结束后再拆镜；尚未拆镜。","Wait for the current task before splitting. Nothing changed.");
    const shot=input.editor.shots.find(shot=>command.shotNo ? shot.shotNo===command.shotNo : shot.stableShotId===input.stableShotId);
    if(!shot?.stableShotId) return explain("请选中镜头或写明第几镜；尚未调用模型。","Select a shot or specify its number. No model was called.");
    const row=input.editor.timelineLayoutRows.find(row=>row.item.stableShotId===shot.stableShotId);
    if(!row) return explain("当前镜头还不在剪辑线上；尚未拆镜。","This shot is not on the timeline. Nothing changed.");
    let params:Record<string,any>={};
    try {params=typeof shot.generationParams==="string"?JSON.parse(shot.generationParams):shot.generationParams??{};} catch { /* ask for explicit images below */ }
    const roles=params.storyboardFrameRoles??{};
    const ids=command.imageIds.length?command.imageIds:[roles.firstImageId??params.firstFrameImageId,(roles.referenceImageIds??params.referenceFrameImageIds??[])[0],roles.lastImageId??params.lastFrameImageId];
    const images=ids.flatMap(id=>{const image=shot.imageVersions?.find(image=>image.id===id);return image?[image]:[];});
    const proposal:Proposal={storyId:input.storyId,epoch:storySpineStore.getState().storyScopeEpoch,stableShotId:shot.stableShotId,shotNo:shot.shotNo,
      plan:{imageIds:ids as [number,number,number],durationSec:command.durationSec as 4|5,expectedStartFrame:row.startFrame,expectedEndFrame:row.endFrame},images,quote:0,message:"",phase:"quote"};
    setNotice(null);active.current=proposal;record(proposal,"user",text);
    if(![4,5].includes(command.durationSec)||images.length!==3||new Set(ids).size!==3) {
      proposal.phase="done";proposal.message=en?"Specify three image IDs in order and 4 or 5 seconds per generated segment.":"请按顺序指定三张不同的图片，生成时长各 4 或 5 秒。例如：第3镜拆成两段，用 #2045、#2046、#2047，每段4秒。";publish(proposal);return true;
    }
    proposal.message=en?"Preparing split quote · No charge":"正在核对拆镜方案 · 免费";publish(proposal);
    try {
      const reading=await utils.storyAgent.quoteChatLlm.fetch({steps:[{step:"video-director",count:2}]});
      proposal.quote=2*estimateViduQ2TransitionCny({durationSec:command.durationSec,resolution:"720p",uploadCount:2}).estimatedCny+reading.totalCny;
      proposal.phase="ready";proposal.message=en?"Reply ‘confirm split’ to save this plan, or ‘cancel’. Rendering is quoted separately.":"回复“确认拆镜”保存此方案，或“取消”。这次只拆镜和设置帧，不提交生成。";
    } catch {proposal.phase="done";proposal.message=en?"Quote unavailable; nothing changed.":"报价暂不可用，镜头未改。";}
    publish(proposal);record(proposal,"assistant",`${proposal.message} #${ids.join(" → #")} · ${command.durationSec}s × 2`);return true;
  };
  const panel=notice?.storyId===input.storyId?<p role="status" className="rounded-lg border p-3 text-xs">{notice.message}</p>:visible?<article aria-label={en?"Split shot plan":"拆镜方案 / Split shot plan"} className="space-y-2 rounded-lg border p-3 text-xs">
    <p>{en?"Shot":"第"} {visible.shotNo} {en?"":"镜"} · {visible.message}</p>
    {visible.images.length===3 && <div className="flex gap-2">{visible.images.map(image=><figure key={image.id}><img src={image.imageUrl} alt={`#${image.id}`} className="h-16 w-20 rounded object-contain"/><figcaption>#{image.id}</figcaption></figure>)}</div>}
    {visible.phase==="ready" && <p>#{visible.plan.imageIds[0]} → #{visible.plan.imageIds[1]}；#{visible.plan.imageIds[1]} → #{visible.plan.imageIds[2]} · {visible.plan.durationSec}s × 2 · 720p<br/>{en?"Estimated generation cost including director analysis":"后续生成参考费用（含导演读图）"}：{formatComputeQuote(visible.quote)}。{en?"Existing timeline timing stays unchanged until new takes are adopted.":"当前剪辑长度保持；新视频采用时再更新。"}</p>}
  </article>:null;
  return {handle,panel,dismiss};
}
