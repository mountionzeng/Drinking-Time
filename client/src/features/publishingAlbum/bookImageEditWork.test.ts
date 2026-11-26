import { expect, it } from "vitest";
import { reopenBookImageWork, type BookImageWork } from "./bookImageEditWork";

const closed: BookImageWork = {phase:"dismissed",request:"裁掉左边，改成正方形。换成清晨色调"};
it("opens an old dismissed square at its quote, without executing either step", () => {
  expect(reopenBookImageWork({...closed,cropped:true})).toMatchObject({phase:"quote",request:closed.request,cropped:true});
  expect(reopenBookImageWork(closed).phase).toBe("crop");
});
it("reopens closed receipt states without offering a second purchase", () => {
  expect(reopenBookImageWork({...closed,pausedFrom:"sending"}).phase).toBe("sending");
  expect(reopenBookImageWork({...closed,message:"提交结果待核实"}).phase).toBe("unknown");
  expect(reopenBookImageWork({...closed,taskId:"t"})).toMatchObject({phase:"sending",taskId:"t"});
  expect(reopenBookImageWork({...closed,pausedFrom:"failed",message:"服务拒绝请求"}).phase).toBe("failed");
});
