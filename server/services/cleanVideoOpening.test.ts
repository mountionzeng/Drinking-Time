import { describe,expect,it } from "vitest";
import { restoreOpeningPixels } from "./cleanVideoOpening";

// A captured pointer silhouette with a tip, notch and diagonal stem.
const mask=["#","##","###","#####","######","#######","########","#########","##########","###########","############","##############","###############","################","#################","##################","###################","############","############","#####  ######","####   ######","###     ######","##      ######","         ######","         ######","          ######","          ####","           #"];
const width=150,height=90;
function draw(bytes:Buffer,x:number,y:number) {
  for(const [row,line] of mask.entries()) for(let col=0;col<line.length;col++)
    if(line[col]==="#") bytes.fill(25,((y+row)*width+x+col)*3,((y+row)*width+x+col)*3+3);
}
describe("native opening pointer removal",()=>{
  it("uses two agreeing frames after the pointer moves and keeps the stationary send symbol pixel exact",()=>{
    const background=Buffer.alloc(width*height*3,190);draw(background,8,6);
    const first=Buffer.from(background),a=Buffer.from(background),b=Buffer.from(background);
    draw(first,38,48);draw(a,72,18);draw(b,110,11);
    const restored=restoreOpeningPixels(first,a,b,width,height);
    expect(restored.output).toEqual(background); expect(restored.changed).toBeGreaterThan(0);
    expect(()=>restoreOpeningPixels(first,first,b,width,height)).toThrow();
    expect(()=>restoreOpeningPixels(first,a,first,width,height)).toThrow();
  });
  it("refuses movement of an ordinary rectangular object",()=>{
    const first=Buffer.alloc(width*height*3,220),next=Buffer.from(first);
    for(let y=12;y<40;y++) first.fill(10,(y*width+34)*3,(y*width+53)*3);
    expect(()=>restoreOpeningPixels(first,next,next,width,height)).toThrow();
  });
});
