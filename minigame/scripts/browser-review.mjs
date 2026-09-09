// Generates a fixture-only visual harness. No server, API calls or business data.
import {readFileSync,writeFileSync} from 'node:fs';
const output=process.argv[2];if(!output?.endsWith('/client/public/dk-minigame-review.html'))throw new Error('explicit review artifact target required');
const dist=new URL('../dist/',import.meta.url);
const assets=Object.fromEntries(['metal','wood','water','fire','earth'].map(el=>[`character-${el}.png`,'data:image/png;base64,'+readFileSync(new URL(`character-${el}.png`,dist)).toString('base64')]));
const bundle=readFileSync(new URL('game.js',dist),'utf8');
const font=readFileSync(new URL('brand.ttf',dist)).toString('base64');
const setup=`
const canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d'),handlers={},store=new Map();
let labels=[];const fillText=ctx.fillText.bind(ctx),fillRect=ctx.fillRect.bind(ctx);
ctx.fillText=(value,x,y)=>{labels.push({value,x,y});fillText(value,x,y)};
ctx.fillRect=(x,y,w,h)=>{if(x===0&&y===0&&h>=844)labels=[];fillRect(x,y,w,h)};
let body='有些话，不用一下子说完。\\n\\n晚饭后散步的时候，风从树叶之间穿过。我停了一会儿，突然觉得今天也有值得留下来的片刻。\\n\\n想把这些小事慢慢写下来。';
const bodyDoc=()=>({storyId:41,storyRevision:1,versionId:'v1',platform:'xiaohongshu',body,bodyRevision:1,draftRevision:1,versionRevision:1,containerRevision:1,publishingRevision:1,updatedAt:1});
const assets=${JSON.stringify(assets)};
const wx={createCanvas:()=>canvas,createImage:()=>{const img=new Image();return {set src(value){img.src=assets[value]},set onload(fn){img.onload=()=>fn()},get image(){return img}}},getSystemInfoSync:()=>({windowWidth:390,windowHeight:844,pixelRatio:2,safeArea:{top:47,bottom:810}}),getMenuButtonBoundingClientRect:()=>({bottom:79}),getStorageSync:k=>store.get(k),setStorageSync:(k,v)=>store.set(k,v),removeStorageSync:k=>store.delete(k),loadFont:()=> 'GameBrand',
showToast:r=>{document.querySelector('#status').textContent=r.title},
showKeyboard:r=>{const input=document.querySelector('textarea');input.value=r.defaultValue;if(!['','fixture@example.com','fixture-password'].includes(r.defaultValue)){input.hidden=false;input.focus()}},
showActionSheet:r=>r.success({tapIndex:0}),showModal:r=>r.success({confirm:true}),
request:r=>{let data;const op=r.url.split('/').at(-1);
 if(r.url.includes('/login/'))data={token:'fixture',expiresIn:3600};else if(op==='stories')data={stories:[{id:41,title:'散步的时候'}]};
 else {let result;if(op==='account.read')result={id:7,name:'测试账号',email:'fixture@example.com',recoveryScope:'fixture'};else if(op==='stories.list')result={stories:[{id:41,title:'散步的时候'}]};else if(op==='body.read')result=bodyDoc();else if(op==='chat.list')result={messages:[{id:1,role:'user',content:'今天出门走了走，觉得轻松了一些。',clientMessageId:'u1',createdAt:new Date().toISOString()},{id:2,role:'assistant',content:'是在哪个瞬间，觉得心里松了一点？可以从那个小小的画面开始说。',clientMessageId:'a1',createdAt:new Date().toISOString()}]};else throw new Error('Unsupported fixture operation '+op);data={result};}queueMicrotask(()=>r.success({statusCode:200,data}));}
};
const drawImage=ctx.drawImage.bind(ctx);ctx.drawImage=(img,...args)=>drawImage(img.image||img,...args);
for(const name of ['KeyboardInput','KeyboardComplete','KeyboardHeightChange','TouchStart','TouchMove','TouchEnd','TouchCancel','Hide','Show','WindowResize'])wx['on'+name]=fn=>handlers[name]=fn;
for(const [name,event] of [['TouchStart','pointerdown'],['TouchMove','pointermove'],['TouchEnd','pointerup']])canvas.addEventListener(event,e=>{const r=canvas.getBoundingClientRect(),t={clientX:e.clientX-r.x,clientY:e.clientY-r.y};handlers[name]?.({touches:[t],changedTouches:[t]})});
document.querySelector('textarea').addEventListener('change',e=>{handlers.KeyboardComplete({value:e.target.value});e.target.hidden=true});
function tap(label){const l=labels.findLast(x=>x.value===label);if(!l)throw new Error('Missing fixture action '+label);const t={clientX:l.x+3,clientY:l.y-8};handlers.TouchStart({touches:[t]});handlers.TouchEnd({changedTouches:[t]})}
`;
writeFileSync(output,`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>小游戏画面对照（替身数据）</title><style>@font-face{font-family:GameBrand;src:url(data:font/ttf;base64,${font})}body{margin:0;background:#faf7f1}canvas{width:390px;height:844px;touch-action:none}textarea{position:fixed;bottom:0;left:0;width:360px;height:220px}#status{font:12px sans-serif}</style><canvas></canvas><textarea aria-label="小游戏键盘" hidden></textarea><div id="status">仅界面对照，全部为替身数据，不连接测试站。</div><script>${setup}\n${bundle.replaceAll('</script','<\\/script')}\nsetTimeout(()=>{tap('填写邮箱');handlers.KeyboardComplete({value:'fixture@example.com'});tap('填写密码');handlers.KeyboardComplete({value:'fixture-password'});tap('邮箱登录');setTimeout(()=>{if(location.search.includes('chat'))tap('拉开看全部 ⌃')},100)},100);</script>`);
console.log('Fixture-only review artifact generated:',output);
