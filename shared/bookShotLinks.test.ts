import {expect,it} from "vitest";
import {bookShotLinks,linkedScenePrompt} from "./bookShotLinks";
const shot=(id:string,picture:string,video="",images:string[]=[],scene?:string)=>({id,title:id,picture,video,images,scene});
it("links the same path across a cutaway before any image exists and uses current source text",()=>{
 const garden=shot("garden","午后的公园步道，近处是树荫。");
 const end=shot("end","同一条步道。远处的人走小了。");
 const shots=[garden,shot("sky","天上的云"),end];
 const link=bookShotLinks(shots,9).get("end");
 expect(link).toMatchObject({sourceId:"garden",sourceNumber:10,sourcePicture:garden.picture});
 expect(linkedScenePrompt(end.picture,link)).toContain(end.picture);
 expect(bookShotLinks([{...garden,picture:"清晨的公园步道。"},end]).get("end")?.sourcePicture).toBe("清晨的公园步道。");
 expect(bookShotLinks([garden,shot("end","另一条街道。")]).size).toBe(0);
});
it("respects explicit visual requests, scene boundaries and reused image identity",()=>{
 const a=shot("a","院墙","",["/api/images/p.png"],"one"), b=shot("b","屋顶","",[],"two");
 expect(bookShotLinks([a,b,shot("c","沿用第 1 镜的场景。")]).get("c")?.sourceId).toBe("a");
 expect(bookShotLinks([a,shot("n","不要沿用上一镜的机位。")]).size).toBe(0);
 expect(bookShotLinks([a,shot("n","花园","上一镜的钢琴声渐弱。")]).size).toBe(0);
 const grouped=bookShotLinks([a,shot("n","花园","",[],"one")]).get("n");
 expect(grouped?.reason).toBe("同一分场"); expect(linkedScenePrompt("花园",grouped)).toBe("花园");
 expect(bookShotLinks([a,shot("n","同一处院墙。","",[],"two")]).size).toBe(0);
 expect(bookShotLinks([a,b,shot("r","照片中最右边的人","",a.images)]).get("r")).toMatchObject({sourceId:"a",reason:"同一画面素材"});
 expect(bookShotLinks([a,b,shot("x","参考第 8 镜的场景。")]).has("x")).toBe(false);
});
it("uses the final direction and does not attach a scene for a sound or style reference",()=>{
  const hall=shot("hall","宽敞的候车厅。"), dock=shot("dock","雾里的码头。");
  const source=(text:string)=>bookShotLinks([hall,dock,shot("next",text)]).get("next")?.sourceId;
  expect(source("回到刚才的候车厅。")).toBe("hall");
  expect(source("沿用第1镜的场景。改为参考第2镜的场景。")).toBe("dock");
  expect(source("同一处候车厅。不要沿用先前场景。")).toBeUndefined();
  expect(source("同一处候车厅。换到另一个地点。")).toBeUndefined();
  expect(source("参考第1镜的音乐。")).toBeUndefined();
  expect(source("仅参考第2镜的画风。")).toBeUndefined();
});
