import {expect,it} from "vitest";
import {parseShotSplitChat,splitFrameParams} from "./shotSplitChat";
it("parses two-stage commands without treating generation as confirmation",()=>{
 expect(parseShotSplitChat("第3镜拆成两段，#2045、#2046、#2047，每段5秒")).toEqual({shotNo:3,imageIds:[2045,2046,2047],durationSec:5});
 expect(parseShotSplitChat("第3镜生成视频")).toBeNull();
 const params=JSON.parse(splitFrameParams('{"movementAmplitude":"small"}',1,2,4));
 expect(params).toMatchObject({movementAmplitude:"small",firstFrameImageId:1,lastFrameImageId:2,durationSec:4,resolution:"720p"});
});
