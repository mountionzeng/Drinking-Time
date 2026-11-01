import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {expect,it} from 'vitest';

// Contract fixture for SW event/transaction timing, not an Android installation simulation.
function worker(fail=false){
  const events=new Map<string,Function>(),stored=new Map<string,unknown>();
  const db={objectStoreNames:{contains:()=>true},close(){},transaction(){
    const tx:any={objectStore:()=>({put(value:unknown,key:string){stored.set(key,value);queueMicrotask(()=>fail?tx.onabort():tx.oncomplete());}})};
    return tx;
  }};
  runInNewContext(readFileSync(new URL('../../../public/capture-share-worker.js',import.meta.url),'utf8'),{
    self:{location:{origin:'https://fixture.test'},addEventListener:(name:string,callback:Function)=>events.set(name,callback)},
    indexedDB:{open(){const request:any={result:db};queueMicrotask(()=>request.onsuccess());return request;}},
    crypto:webcrypto,URL,Response,File,
  });
  return {stored,submit(request:Request){let response:Promise<Response>|undefined;events.get('fetch')!({request,respondWith(value:Promise<Response>){response=value;}});return response;}};
}
it('leaves all ordinary navigation, scripts and API requests untouched',()=>{
 const w=worker();
 for(const url of ['https://fixture.test/m','https://fixture.test/app.js','https://fixture.test/api/test','https://other.test/capture-share'])
   expect(w.submit(new Request(url,{method:'POST'}))).toBeUndefined();
 expect(w.submit(new Request('https://fixture.test/capture-share'))).toBeUndefined();
});
it('waits for durable storage, retains binary files and returns an absolute redirect',async()=>{
 const w=worker(),form=new FormData();form.set('title','素材标题');form.set('text','用户原话');form.set('url','https://example.test/only-a-link');form.append('files',new File([Uint8Array.from([0,3,255])],'source.png',{type:'image/png'}));
 const response=await w.submit(new Request('https://fixture.test/capture-share',{method:'POST',body:form}));
 expect(response!.status).toBe(303);expect(response!.headers.get('location')).toMatch(/^https:\/\/fixture.test\/m\?captureShare=/);
 const saved=[...w.stored.values()][0] as {files:File[];text:string;origin:string};
 expect(saved.text).toBe('素材标题\n用户原话\nhttps://example.test/only-a-link');expect(saved.origin).toBe('android-share');
 expect(new Uint8Array(await saved.files[0].arrayBuffer())).toEqual(Uint8Array.from([0,3,255]));
});
it('reports a failed save instead of showing a success destination',async()=>{
 const form=new FormData();form.set('text','不能丢失');
 const response=await worker(true).submit(new Request('https://fixture.test/capture-share',{method:'POST',body:form}));
 expect(response!.status).toBe(400);expect(await response!.text()).toContain('尚未保存');expect(response!.headers.has('location')).toBe(false);
});
it('advertises installable icons with real pixel dimensions and the same share receiver',async()=>{
 const manifest=JSON.parse(readFileSync(new URL('../../../public/manifest.webmanifest',import.meta.url),'utf8'));
 expect(manifest.share_target).toMatchObject({action:'/capture-share',method:'POST',enctype:'multipart/form-data'});
 const sharp=(await import('sharp')).default;
 for(const size of [192,512]){
  const icon=manifest.icons.find((item:{sizes:string})=>item.sizes===`${size}x${size}`);
  expect(icon).toBeDefined();
  const file=new URL('../../../public'+icon.src,import.meta.url);
  const meta=await sharp(readFileSync(file)).metadata();expect([meta.width,meta.height]).toEqual([size,size]);
 }
});
