/* 杯子变小人：拆成三层
     char-body-<el>.png    杯子（静止）
     char-face-<el>.png    五官（WXSS 淡入）
     char-limbs-<el>.png   手脚逐帧雪碧图（WXSS steps 播放）
   只有「一笔笔画出来」必须逐帧，缩放/淡入/晃动交给 WXSS。
   时间轴与 index.html 的 CSS 完全一致：
     limb l1..l4 delay .44/.52/.60/.66，duration .34；手脚 opacity .74→.94 */
const fs=require('fs'), path=require('path');
const sharp=require('/Users/yuandai/Documents/New project/drinking-time-local/node_modules/sharp');
const ROOT='/Users/yuandai/Documents/New project/drinking-time-local/docs/prototypes/liaohuier-miniapp';
const OUT=path.join(ROOT,'assets');
const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
// 按锚点切纯函数区，别写死行号（原型一改行号就漂）
const _a=html.indexOf('const THEMES = {');
const _b=html.indexOf('/* ---------------------------------------------------------------------------\n   故事与会话');
const art=html.slice(_a,_b);
const box={};
new Function('e', art+`Object.assign(e,{THEMES,ELEMENT_ORDER,DRINK_ART,neutralFace,RIGS,POSE_NEUTRAL,LIMB_SW,HAND_R,limb});`)(box);
const {THEMES,ELEMENT_ORDER,DRINK_ART,neutralFace,RIGS,POSE_NEUTRAL,LIMB_SW,limb}=box;

const VB='-6 -8 102 118', W=208*2, H=242*2;      // @2x，动画帧不用 3x
const wrap=(el,inner)=>`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="${VB}" fill="none" stroke="${THEMES[el].ink}" color="${THEMES[el].ink}" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

const DELAYS=[0.44,0.52,0.60,0.66], DUR=0.34, DASH=34;
const clamp=v=>Math.max(0,Math.min(1,v));

function limbsAt(el,t){
  const rig=RIGS[el];
  const raw=[limb(rig,POSE_NEUTRAL.armL,-1,'arm',1),limb(rig,POSE_NEUTRAL.armR,1,'arm',2),
             limb(rig,POSE_NEUTRAL.legL,-1,'leg',3),limb(rig,POSE_NEUTRAL.legR,1,'leg',4)];
  const tipOpacity=clamp((t-0.74)/0.20);
  const out=raw.map((g,i)=>{
    const p=clamp((t-DELAYS[i])/DUR);
    return g
      .replace('class="ch-limb l'+(i+1)+'"', `stroke-dasharray="${DASH}" stroke-dashoffset="${(DASH*(1-p)).toFixed(2)}"`)
      .replace('class="ch-hand"',`opacity="${tipOpacity.toFixed(2)}"`)
      .replace('class="ch-foot"',`opacity="${tipOpacity.toFixed(2)}"`);
  }).join('');
  return `<g stroke-width="${LIMB_SW}">${out}</g>`;
}

const T0=0.42, T1=1.00, FRAMES=14;
(async()=>{
  let total=0;
  for(const el of ELEMENT_ORDER){
    // 杯子层 / 五官层
    for(const [suffix,inner] of [['body',DRINK_ART[el]],['face',neutralFace(el)]]){
      const f=path.join(OUT,`char-${suffix}-${el}.png`);
      await sharp(Buffer.from(wrap(el,inner))).png({compressionLevel:9,palette:true}).toFile(f);
      total+=fs.statSync(f).size;
    }
    // 手脚逐帧，竖排雪碧图
    const tiles=[];
    for(let i=0;i<FRAMES;i++){
      const t=T0+(T1-T0)*(i/(FRAMES-1));
      tiles.push(await sharp(Buffer.from(wrap(el,limbsAt(el,t)))).png().toBuffer());
    }
    // 补一格和末帧相同的尾帧：WXSS 的 steps(N) 会停在「to」那一格上，
    // 没有这一格的话动画结束瞬间会闪成空白。
    tiles.push(tiles[tiles.length-1]);
    const TILES=tiles.length;
    const sheet=path.join(OUT,`char-limbs-${el}.png`);
    await sharp({create:{width:W,height:H*TILES,channels:4,background:{r:0,g:0,b:0,alpha:0}}})
      .composite(tiles.map((b,i)=>({input:b,top:H*i,left:0})))
      .png({compressionLevel:9,palette:true}).toFile(sheet);
    total+=fs.statSync(sheet).size;
    console.log(`char-limbs-${el}.png  ${W}x${H*TILES}  ${(fs.statSync(sheet).size/1024).toFixed(1)} KB  (${FRAMES} 帧 + 1 尾帧)`);
  }
  console.log('---\n动画层合计 '+(total/1024).toFixed(1)+' KB');
  const all=fs.readdirSync(OUT).filter(f=>f.endsWith('.png'));
  console.log('assets/ 共 '+all.length+' 张，'+(all.reduce((a,f)=>a+fs.statSync(path.join(OUT,f)).size,0)/1024).toFixed(1)+' KB');
})();
