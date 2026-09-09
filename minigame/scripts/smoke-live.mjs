import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const handlers={},storage=new Map(),calls=[];
let labels=[],body='来自原账号的正文',revision=1,messages=[],turn;
const ctx={save(){},restore(){},rect(){},clip(){},scale(){},fillRect(x,y,w,h){if(x===0&&y===0&&h>=844)labels=[];},fillText(value,x,y){labels.push({value,x,y});},measureText(value){return{width:[...value].length*9};},beginPath(){},moveTo(){},lineTo(){},quadraticCurveTo(){},fill(){},stroke(){},drawImage(){}};
const document=()=>({storyId:41,storyRevision:1,versionId:'v1',platform:'xiaohongshu',body,bodyRevision:revision,draftRevision:1,versionRevision:1,containerRevision:1,publishingRevision:1,updatedAt:1});
const wx={
  createCanvas:()=>({getContext:()=>ctx}),createImage:()=>({}),getSystemInfoSync:()=>({windowWidth:390,windowHeight:844,pixelRatio:2}),
  getStorageSync:k=>storage.get(k),setStorageSync:(k,v)=>storage.set(k,v),removeStorageSync:k=>storage.delete(k),showKeyboard(){},showToast(){},
  showActionSheet:options=>options.success({tapIndex:0}),showModal:options=>options.success({confirm:true}),login:options=>options.success({code:'one-use-code'}),
  request(options){
    const path=new URL(options.url).pathname;calls.push({path,data:options.data});let data;
    if(path.endsWith('/login/email')){assert.equal(options.data.email,'old@example.com');assert.equal(options.data.password,'test-password');data={token:'test-game-token',expiresIn:3600};}
    else if(path.endsWith('/login/wechat'))data={token:'test-game-token',expiresIn:3600};
    else {
      assert.equal(options.header.Authorization,'Bearer test-game-token');
      if(path.endsWith('/stories'))data={stories:[{id:41,title:'我的旧故事'}]};
      else if(path.endsWith('/bind/wechat'))data={ok:true};
      else {const op=path.split('/').at(-1);let result;
        if(op==='account.read')result={id:7,name:'测试用户',email:'old@example.com',recoveryScope:'opaque-scope'};
        else if(op==='account.balance')result={postedMinor:30000000,reservedMinor:1000000,availableMinor:29000000,lifetimeSpentMinor:0};
        else if(op==='profile.read')result=null;
        else if(op==='letters.list')result=[];
        else if(op==='stories.list')result={stories:[{id:41,title:'我的旧故事'}]};
        else if(op==='body.read')result=document();
        else if(op==='body.save'){assert.equal(options.data.baseBodyRevision,revision);body=options.data.body;revision++;result={status:'saved',document:document()};}
        else if(op==='chat.list')result={messages};
        else if(op==='chat.generate'){turn=options.data;assert.ok(turn.requestHash);result={status:'completed',turn:{assistantContent:'接着你的旧故事聊',appendStatus:'pending'}};}
        else if(op==='chat.append'){assert.equal(options.data.requestHash,turn.requestHash);messages=[{id:1,role:'user',content:turn.userContent,clientMessageId:turn.userClientMessageId,createdAt:new Date().toISOString()},{id:2,role:'assistant',content:'接着你的旧故事聊',clientMessageId:turn.assistantClientMessageId,createdAt:new Date().toISOString()}];result={status:'appended'};}
        else throw new Error('unexpected endpoint '+op);
        data={result};
      }
    }
    options.success({statusCode:200,data});
  },
};
for(const event of ['KeyboardInput','KeyboardComplete','KeyboardHeightChange','TouchStart','TouchMove','TouchEnd','TouchCancel','Hide','Show','WindowResize'])wx['on'+event]=fn=>{handlers[event]=fn;};
vm.runInNewContext(readFileSync(new URL('../dist/game.js',import.meta.url),'utf8'),{wx,console,Date,Map,Set,setTimeout,clearTimeout,queueMicrotask,TextEncoder,TextDecoder,AbortController,URL,URLSearchParams});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function tap(label){const target=labels.findLast(x=>x.value===label);assert.ok(target,'missing action '+label);const t={clientX:target.x+3,clientY:target.y-8};handlers.TouchStart({touches:[t]});handlers.TouchEnd({changedTouches:[t]});}
tap('填写邮箱');handlers.KeyboardComplete({value:'old@example.com'});tap('填写密码');handlers.KeyboardInput({value:'test-password'});assert.ok(!labels.some(x=>x.value.includes('test-password')));handlers.KeyboardComplete({value:'test-password'});
tap('邮箱登录');await flush();assert.ok(labels.some(x=>x.value==='来自原账号的正文'));
tap('编辑');handlers.KeyboardComplete({value:'小游戏改写的正文'});tap('保存');await flush();assert.equal(body,'小游戏改写的正文');assert.ok(labels.some(x=>x.value==='已保存'));
tap('继续聊聊…');handlers.KeyboardComplete({value:'接着聊'});tap('发送');await flush();assert.ok(labels.some(x=>x.value==='接着你的旧故事聊'));
tap('故事');await flush();assert.ok(labels.some(x=>x.value==='新建一个故事'));tap('我的旧故事');await flush();
tap('我');await flush();assert.ok(labels.some(x=>x.value==='可用余额 ¥29.00'));tap('今天的来信 ›');await flush();assert.ok(labels.some(x=>x.value==='今天留给大家的一封信'));tap('返回');await flush();
for(let i=0;i<3;i++){handlers.TouchStart({touches:[{clientX:180,clientY:700}]});handlers.TouchEnd({changedTouches:[{clientX:180,clientY:250}]});}
if(process.argv.includes('--wechat')){tap('关联当前微信');await flush();}
tap('退出登录');await flush();assert.ok(!labels.some(x=>x.value==='小游戏改写的正文'));assert.ok(!labels.some(x=>x.value==='接着你的旧故事聊'));
assert.equal(calls.filter(x=>x.path.endsWith('/chat.generate')).length,1);
console.log('真实构建入口冒烟通过：原邮箱登录→原故事→正文编辑保存→聊天整轮落库→故事切换→账号退出；网络/Canvas为替身，非真机验收。');
