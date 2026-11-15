import {afterEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({publicUrl:vi.fn()}));
vi.mock('./imageGen',()=>({toPublicImageUrl:m.publicUrl}));
vi.mock('../_core/env',()=>({ENV:{api302BaseUrl:'https://api.302ai.cn'}}));
import {legnextReferenceImage} from './legnextReferenceImage';
afterEach(()=>{vi.unstubAllGlobals();vi.resetAllMocks()});
it('uses the verified domestic file host with unchanged path and query and checks it before generation',async()=>{
 m.publicUrl.mockResolvedValue('https://file.302.ai/path/sample.png?signature=kept');
 const fetcher=vi.fn().mockResolvedValue(new Response('',{status:200,headers:{'content-type':'image/png'}}));vi.stubGlobal('fetch',fetcher);
 expect(await legnextReferenceImage('/api/images/example.png')).toBe('https://file.302ai.cn/path/sample.png?signature=kept');
 expect(String(fetcher.mock.calls[0][0])).toBe('https://file.302ai.cn/path/sample.png?signature=kept');
 expect(fetcher.mock.calls[0][1]).toMatchObject({method:'GET',redirect:'error'});
});
it.each([new Response('login',{status:200,headers:{'content-type':'text/html'}}),new Response('',{status:403})])('fails before submitting when the reference host is not serving an image',async response=>{
 m.publicUrl.mockResolvedValue('https://file.302.ai/sample.png');vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response));
 await expect(legnextReferenceImage('/api/images/example.png')).rejects.toThrow('cannot be read');
});
it('does not rewrite or fetch arbitrary and private signed references',async()=>{
 const url='https://www.example.test/api/chapter-media?key=private&e=123&token=signature';m.publicUrl.mockResolvedValue(url);const f=vi.fn();vi.stubGlobal('fetch',f);
 expect(await legnextReferenceImage(url)).toBe(url);expect(f).not.toHaveBeenCalled();
});
it('rejects non-https and credential-bearing reference URLs',async()=>{
 for(const url of ['http://127.0.0.1/private','https://user:secret@file.302.ai/test']){m.publicUrl.mockResolvedValue(url);await expect(legnextReferenceImage(url)).rejects.toThrow()}
});
