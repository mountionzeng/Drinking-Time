import { afterEach, expect, it, vi } from 'vitest';
import type { TrpcContext } from '../_core/context';
const prepare = vi.hoisted(()=>vi.fn());
vi.mock('../services/bookStoryboardPreparation',()=>({prepareBookStoryboard:prepare}));
vi.mock('../services/bookVideoCreation',()=>({listBookVideoRecords:vi.fn(),proposeBookVideo:vi.fn(),generateBookVideo:vi.fn(),editBookVideo:vi.fn(),adoptBookVideo:vi.fn()}));
vi.mock('../services/imageAssets',()=>({getStoryImageAssets:vi.fn()}));
vi.mock('../repositories/stories',()=>({getStoryById:vi.fn()}));
import { bookVideoRouter } from './bookVideo';
const caller=(userId:number|null)=>bookVideoRouter.createCaller({user:userId ? {id:userId} : null,req:{},res:{}} as TrpcContext);
afterEach(()=>{vi.unstubAllEnvs();vi.resetAllMocks();});
it('keeps the article-only flow working while the chapter feature is off, without reading or writing chapters',async()=>{
  vi.stubEnv('CHAPTER_PACKAGE_ENABLED','false');
  expect(await caller(7).prepareManuscript({storyId:4,request:'整理'})).toEqual({chapters:[],shotCount:0,changed:false});
  expect(prepare).not.toHaveBeenCalled();
});
it('retires destructive in-place preparation and requires a separately reviewed manuscript',async()=>{
  vi.stubEnv('CHAPTER_PACKAGE_ENABLED','true');
  await expect(caller(7).prepareManuscript({storyId:4,request:'整理'})).rejects.toMatchObject({code:'PRECONDITION_FAILED'});
  expect(prepare).not.toHaveBeenCalled();
});
it('requires authentication before preparation',async()=>{
  vi.stubEnv('CHAPTER_PACKAGE_ENABLED','true');
  await expect(caller(null).prepareManuscript({storyId:4,request:'整理'})).rejects.toMatchObject({code:'UNAUTHORIZED'});
  expect(prepare).not.toHaveBeenCalled();
});
