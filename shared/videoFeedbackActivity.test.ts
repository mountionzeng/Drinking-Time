import { expect, it } from "vitest";
import { feedbackActivityId, readFeedbackActivity, storedFeedbackActivity, waitingFeedbackActivity } from "./videoFeedbackActivity";

it("keeps saved feedback waiting until its own worker reports a step", () => {
  const id = feedbackActivityId("feedback-2");
  expect(readFeedbackActivity(waitingFeedbackActivity)?.phase).toBe("等待制作");
  const messages = [
    {id: feedbackActivityId("feedback-1"), who:"s", text:"制作完成\n先前成片"},
    {id, who:"u", text:"制作完成\n跳过渲染"},
    {id, who:"s", text:"制作中\n正在准备树冠图层\n正在渲染林间飞行"},
  ];
  expect(storedFeedbackActivity({messages}, id)).toEqual({phase:"制作中",steps:["正在准备树冠图层","正在渲染林间飞行"],latest:"正在渲染林间飞行"});
  expect(storedFeedbackActivity({},id)).toBeNull();
  expect(storedFeedbackActivity({messages},"feedback-2")).toBeNull();
  expect(readFeedbackActivity("制作中\n")).toBeNull();
});

it("retains terminal history across reload including a failed render", () => {
  expect(readFeedbackActivity("制作失败\n正在渲染林间飞行\n渲染中断")?.latest).toBe("渲染中断");
  expect(readFeedbackActivity("制作完成\n已生成候选 #7")?.phase).toBe("制作完成");
});
