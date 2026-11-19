import { expect, it, vi } from "vitest";
const {getStoryById,updateStoryBodyIfRevision}=vi.hoisted(()=>({getStoryById:vi.fn(),updateStoryBodyIfRevision:vi.fn()}));
vi.mock("../repositories/stories",()=>({getStoryById,updateStoryBodyIfRevision}));
import {reportVideoFeedbackActivity} from "./videoFeedbackActivity";
const feedbackId="150bc5fd-d86e-40e6-9845-b4235e41da44";
const id="video-feedback-activity:"+feedbackId;
const input={storyId:4,feedbackId,expectedSteps:1,phase:"制作中" as const,step:"正在准备树冠图层"};
const messages=[{id:feedbackId,who:"u",text:"原话"},{id,who:"s",text:"等待制作\n已记录"}];
it("writes only the matching receipt using an owner-scoped revision check",async()=>{
  getStoryById.mockResolvedValue({body:{messages,_revision:7,draft:"已有草稿"}});
  updateStoryBodyIfRevision.mockResolvedValue(true);
  expect((await reportVideoFeedbackActivity(6,input)).latest).toBe(input.step);
  expect(getStoryById).toHaveBeenCalledWith(4,6);
  expect(updateStoryBodyIfRevision).toHaveBeenCalledWith({id:4,userId:6,expectedRevision:7,body:{
    _revision:8,draft:"已有草稿",messages:[messages[0],{...messages[1],text:"制作中\n已记录\n正在准备树冠图层"}],
  }});
  updateStoryBodyIfRevision.mockResolvedValue(false);
  await expect(reportVideoFeedbackActivity(6,input)).rejects.toMatchObject({code:"CONFLICT"});
});
it("replays the same event once and refuses to reopen completed work",async()=>{
  updateStoryBodyIfRevision.mockClear();
  getStoryById.mockResolvedValue({body:{messages:[messages[0],{id,who:"s",text:"制作完成\n已记录\n已入仓"}]}});
  await expect(reportVideoFeedbackActivity(6,{...input,phase:"制作完成",step:"已入仓"})).resolves.toMatchObject({latest:"已入仓"});
  await expect(reportVideoFeedbackActivity(6,{...input,expectedSteps:2})).rejects.toMatchObject({code:"CONFLICT"});
  getStoryById.mockResolvedValue(null);
  await expect(reportVideoFeedbackActivity(6,input)).rejects.toMatchObject({code:"NOT_FOUND"});
  expect(updateStoryBodyIfRevision).not.toHaveBeenCalled();
});
