import { expect, it } from 'vitest';
import { compositionShotNumbers } from './bookImageComposition';
import type { BookModuleImageTask } from './bookModuleImageTask';
const first:BookModuleImageTask={id:'v1',requestId:'r1',chapterId:9,moduleId:'group',sourceHash:'x',provider:'gpt-image',status:'succeeded',candidates:[{imageId:2018,imageUrl:'/old.png'}],composition:{sources:[{id:'text',text:'not a shot number'}],instructions:[],previousTaskId:null,estimatedCny:1,billingOperationId:null}};
const second:BookModuleImageTask={...first,id:'v2',requestId:'r2',candidates:[{imageId:2019,imageUrl:'/new.png'}],composition:{...first.composition!,previousTaskId:'v1'}};
const shots=[{stableShotId:'s1',shotNo:1,publishingVideo:{referenceImageIds:[2019]}}];
it('labels old versions through the same explicit revision chain',()=>{
 expect(compositionShotNumbers(first,[first,second],shots,[])).toEqual([1]);
 expect(compositionShotNumbers(second,[first,second],shots,[])).toEqual([1]);
});
it('does not borrow an unrelated chain or another chapter even if module IDs match',()=>{
 expect(compositionShotNumbers(first,[first,{...second,composition:{...second.composition!,previousTaskId:null}}],shots,[])).toEqual([]);
 expect(compositionShotNumbers(first,[first,{...second,chapterId:99}],shots,[])).toEqual([]);
});
it('resolves chapter-qualified source modules and multiple affected shots in numeric order',()=>{
 const sources=[{stableShotId:'s2',shotNo:2,publishingVideo:{sourceModuleIds:['9:text']}},{stableShotId:'s1',shotNo:1,publishingVideo:{sourceModuleIds:['9:text']}},{shotNo:3,publishingVideo:{sourceModuleIds:['99:text']}}];
 expect(compositionShotNumbers(first,[first],sources,[])).toEqual([1,2]);
});
it('prefers the stable image identity over a stale shot number',()=>{
 const current=[{stableShotId:'s1',shotNo:1},{stableShotId:'s2',shotNo:2}];
 expect(compositionShotNumbers(first,[first],current,[{id:2018,shotIdentity:'s2',shotNo:'SH01'}])).toEqual([2]);
});
it('does not infer a target from instruction prose or source reference images',()=>{
 const task={...first,composition:{...first.composition!,instructions:['修改第3镜'],sources:[{id:'ref',text:'![图片](/reference.png)'}]}};
 expect(compositionShotNumbers(task,[task],shots,[{id:99,shotIdentity:'s1',shotNo:'SH01'}])).toEqual([]);
});
it('handles circular legacy chains and invalid shot numbers without inventing labels',()=>{
 const task={...first,composition:{...first.composition!,previousTaskId:'v2'}};
 expect(compositionShotNumbers(task,[task,second],[null,{shotNo:0},...shots],[])).toEqual([1]);
});
