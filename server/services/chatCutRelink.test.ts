import type { StoryTimelineItem } from "../../shared/storyMaterial";
import { beforeEach, expect, it, vi } from "vitest";
import { completeChatCutRelink, readChatCutEnvelopes } from "./chatCutRelink";
import { buildChatCutStoryPayload, parseChatCutXml } from "./chatCutXml";
import { getStoryById } from "../repositories/stories";
import { getVideoTakeById } from "../repositories/videos";
import { getStoryTimeline, updateStoryAndTimelineAtomic } from "../repositories/timelines";
vi.mock("../repositories/stories", () => ({ getStoryById: vi.fn() }));
vi.mock("../repositories/timelines", () => ({ getStoryTimeline: vi.fn(), updateStoryAndTimelineAtomic: vi.fn() }));
vi.mock("../repositories/videos", () => ({ getVideoTakeById: vi.fn() }));
vi.mock("../repositories/audioAssets", () => ({ getStoryAudioAssetRow: vi.fn(async ({ assetId }) => ({ id: assetId, status: "ready", durationFrames: 30 })) }));
vi.mock("../persistence/storyVisualPersistence", () => ({ loadAuthorizedStoryImage: vi.fn(async ({ imageId }) => ({ id: imageId, imageUrl: "/api/images/text.png" })) }));
vi.mock("./visualClipEditing", () => ({ withVisualEditServiceLock: vi.fn((_s, _u, fn) => fn()) }));
const clip = (id: string, name: string, filter="") => `<clipitem id="${id}"><name>${name}</name><start>0</start><end>30</end><in>0</in><out>30</out><file id="f-${id}"><name>${name}</name><pathurl>file://./${name}</pathurl></file>${filter}</clipitem>`;
const fade = `<filter><effect><parameter><parameterid>opacity</parameterid><value>100</value><keyframe><when>0</when><value>0</value></keyframe><keyframe><when>6</when><value>100</value></keyframe><keyframe><when>24</when><value>100</value></keyframe><keyframe><when>30</when><value>0</value></keyframe></parameter></effect></filter>`;
const xml = `<xmeml><project><children><sequence><name>test</name><duration>30</duration><rate><timebase>30</timebase></rate><media><video><format><samplecharacteristics><width>1080</width><height>1920</height></samplecharacteristics></format><track>${clip("v","v.mp4")}</track><track>${clip("i","i.png",fade)}</track></video><audio>${[1,2,3,4,5].map(n=>`<track>${clip(`a${n}`,`a${n}.mp3`)}</track>`).join("")}</audio></media></sequence></children></project></xmeml>`;
const input = { storyId: 1, userId: 48, expectedStoryRevision: 1, expectedTimelineVersion: 1, xml,
  assets: [{ name:"v.mp4",kind:"video" as const,id:1 }, { name:"i.png",kind:"image" as const,id:2 },
    ...[1,2,3,4,5].map(n=>({name:`a${n}.mp3`,kind:"audio" as const,id:n+2}))] };
beforeEach(() => {
  vi.clearAllMocks();
  const plan=parseChatCutXml(xml), payload=buildChatCutStoryPayload(plan);
  vi.mocked(getStoryById).mockResolvedValue({ id:1, body:{ _revision:1, chatCutImport:{...plan,relinkStatus:"required"} } } as any);
  vi.mocked(getStoryTimeline).mockResolvedValue({ version:1 } as any);
  vi.mocked(getVideoTakeById).mockResolvedValue({ id:1, storyId:1, stableShotId:payload.shots[0].stableShotId,status:"available",videoUrl:"/api/videos/v.mp4",durationSec:1 } as any);
  vi.mocked(updateStoryAndTimelineAtomic).mockResolvedValue({ timeline:{version:2} } as any);
});
it("restores both visual layers and all five separately labelled audio lanes atomically",async()=>{
  expect(await completeChatCutRelink(input)).toMatchObject({videos:1,images:1,audioClips:5,timelineVersion:2});
  const saved=vi.mocked(updateStoryAndTimelineAtomic).mock.calls[0][0];
  expect((saved.nextTimeline.items as StoryTimelineItem[])[0].imageClips?.[0]).toMatchObject({visualLayer:1,composition:{opacity:1,fadeInFrames:6,fadeOutFrames:6}});
  expect((saved.nextTimeline.extensions!.audioTracks as any).tracks.filter((t:any)=>t.clips.length).map((t:any)=>t.sourceTrack.index).sort()).toEqual([1,2,3,4,5]);
});
it("refuses an asset from another story without any timeline write",async()=>{
  vi.mocked(getVideoTakeById).mockResolvedValue({id:1,storyId:2,status:"available"} as any);
  await expect(completeChatCutRelink(input)).rejects.toThrow("不属于");
  expect(updateStoryAndTimelineAtomic).not.toHaveBeenCalled();
});
it("refuses a concurrent edit",async()=>{
  vi.mocked(getStoryTimeline).mockResolvedValue({version:2} as any);
  await expect(completeChatCutRelink(input)).rejects.toThrow("已改变");
  expect(updateStoryAndTimelineAtomic).not.toHaveBeenCalled();
});
it("rejects an unsupported opacity dip rather than discarding it",()=>{
  expect(()=>readChatCutEnvelopes(xml.replace('<when>24</when><value>100</value>','<when>24</when><value>50</value>'))).toThrow("曲线");
});
