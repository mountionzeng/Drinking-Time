import {expect,it} from "vitest";
import {bookCropIntent,bookCropRect,bookImageEditSteps} from "./bookImageCropIntent";
import {historicalBookImageFeedback} from "@shared/bookImageFeedback";

it("keeps every requested visual change after the free crop",()=>{
  const people="城墙下面站的人右边太高了，需要左右一样高";
  const light="我希望时间是“清晨”，所以颜色改一下";
  const steps=bookImageEditSteps("这张图改成正方形，左边部分直接裁掉。"+people+"。"+light);
  expect(steps.crop).toMatchObject({edge:"左",ratio:1});
  expect(steps.changes).toEqual([people,light]);
});
it("keeps clauses it cannot safely execute and handles connected instructions",()=>{
  expect(bookImageEditSteps("裁掉左边25%，然后把天空调蓝").changes).toEqual(["然后把天空调蓝"]);
  expect(bookImageEditSteps("裁掉左边25%再把天空调蓝").changes).toEqual(["再把天空调蓝"]);
  expect(bookImageEditSteps("裁掉左边路人的帽子")).toEqual({changes:["裁掉左边路人的帽子"]});
  expect(bookImageEditSteps("把人物调亮。移走椅子").changes).toEqual(["把人物调亮","移走椅子"]);
  expect(bookImageEditSteps("不要裁掉左边，把天空调蓝").crop).toBeUndefined();
});

it.each([
  ["这张图改成正方形，左边部分直接裁掉",640],
  ["这张图改成正方形，右边部分直接裁掉",0],
  ["改成正方形，只保留右边",640],
  ["不要重画，裁掉左边，留右边，1:1",640],
])("maps %s to exact original pixels", (text,x)=>{
  expect(bookCropRect(1456,816,bookCropIntent(text as string)!)).toEqual({x,y:0,width:816,height:816});
});
it("clarifies direction, amount and impossible orientations instead of guessing",()=>{
  for (const text of ["正方形","左边裁掉","裁掉左边，保留左边，正方形","裁掉上边，正方形"])
    expect(bookCropRect(1456,816,bookCropIntent(text)!)).toBeUndefined();
  expect(bookCropRect(100,60,bookCropIntent("裁掉左边25%")!)).toEqual({x:25,y:0,width:75,height:60});
  expect(bookCropRect(100,60,bookCropIntent("裁剪，只保留右边25%")!)).toEqual({x:75,y:0,width:25,height:60});
  expect(bookCropIntent("重绘人物，改成正方形")).toBeUndefined();
});
it("restores the original request only when both known record fields agree",()=>{
  const words="这张图改成正方形，右边部分直接裁掉";
  const header="Compose one new image from the supplied reference images.\n图1 is the base: its aspect ratio and overall composition carry over unless the user asks otherwise.\nTake from each reference only what the user names below; do not borrow anything else from them.\n\n";
  const saved=header+words+"\nCharacter continuity across all generated shots:\n【用户持续要求】"+words+"。这些要求必须完整落实。";
  expect(historicalBookImageFeedback(saved)).toBe(words);
  expect(historicalBookImageFeedback(saved.replace(words,"生成器改写"))).toBeUndefined();
  expect(historicalBookImageFeedback(words)).toBeUndefined();
});
