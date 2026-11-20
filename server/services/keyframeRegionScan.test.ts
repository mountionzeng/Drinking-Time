import { expect,it } from "vitest";
import { findTextRegion,findVisualRegion } from "./keyframeRegionScan";
const left={left:.4,right:.47,top:.1,bottom:.15},right={...left,left:.48,right:.56};
it("locates words at their own positions and reports multiple matches",()=>{
 const words=[{text:"V18",region:left},{text:"Library",region:right}];
 expect(findTextRegion(words,"V18 · Library")).toEqual([{...left,right:.56}]);
 expect(findTextRegion([...words,...words],"Library")).toHaveLength(2);
 expect(findTextRegion(words,"Images")).toEqual([]);
});
it("finds a moved graphic using original pixels and declines an uninformative patch",async()=>{
 const width=48,height=40; const pixels=Buffer.alloc(width*height,185),dst=Buffer.alloc(width*height,185);
 for(let y=0;y<16;y++)for(let x=0;x<16;x++){const v=(x*37+y*79+x*y*13)%256;pixels[(y+4)*width+x+4]=v;dst[(y+20)*width+x+25]=v;}
 const plane={pixels,width,height};const target={pixels:dst,width,height};
 const hit=await findVisualRegion(plane,{left:4/width,right:20/width,top:4/height,bottom:20/height},target);
 expect(hit?.left).toBeCloseTo(25/width);expect(hit?.top).toBeCloseTo(20/height);
 expect(await findVisualRegion(plane,{left:.5,right:.8,top:0,bottom:.25},target)).toBeUndefined();
});
