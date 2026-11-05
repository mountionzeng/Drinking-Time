import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editImage, generateImage, resetCircuitBreaker } from './imageGen';
import { ENV } from '../_core/env';
const original={...ENV};
const source='data:image/png;base64,b3JpZ2luYWwtcGl4ZWxz';
const options={provider:'gpt-image' as const,gptImageModel:'gpt-image-2.5-sunburst' as const,gptSubmitOnly:true,aspectRatio:'3:2'};
beforeEach(()=>{resetCircuitBreaker();ENV.api302Key='test';ENV.api302BaseUrl='https://api.302.ai';ENV.image302GptQuality='low';});
afterEach(()=>Object.assign(ENV,original));
it('submits all selected references once, pins Sunburst/high/landscape, and saves receipt without polling',async()=>{
  const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>({task_id:'receipt'})});const accepted=vi.fn();
  const refs=[1,2,3,4].map(n=>`data:image/png;base64,${Buffer.from(`image${n}`).toString('base64')}`);
  const result=await editImage(source,'原图优先',{...options,preferStructuralEdit:true,referenceContextImageUrls:refs,fetcher,onProviderTaskAccepted:accepted});
  expect(fetcher).toHaveBeenCalledOnce();expect(accepted).toHaveBeenCalledWith('receipt');expect(result.providerTaskId).toBe('receipt');
  const [url,request]=fetcher.mock.calls[0];expect(url).toContain('/v1/images/edits?async=true');
  const form=request.body as FormData;expect(form.get('model')).toBe(options.gptImageModel);expect(form.get('quality')).toBe('high');expect(form.get('size')).toBe('1536x1024');expect(form.getAll('image[]')).toHaveLength(5);expect(form.get('input_fidelity')).toBeNull();
});
it('text-only composition also returns the persisted receipt without buying again',async()=>{
  const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>({task_id:'text'})});const accepted=vi.fn();
  await generateImage('画茶壶',{...options,fetcher,onProviderTaskAccepted:accepted});
  expect(fetcher).toHaveBeenCalledOnce();expect(accepted).toHaveBeenCalledWith('text');
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({model:options.gptImageModel,quality:'high',size:'1536x1024',n:1});
});
it('keeps transport and upstream 5xx outcomes uncertain',async()=>{
  const failed=vi.fn().mockRejectedValue(new Error('lost'));
  expect((await generateImage('图',{...options,fetcher:failed})).submissionUncertain).toBe(true);
  resetCircuitBreaker();const upstream=vi.fn().mockResolvedValue({ok:false,status:503,json:async()=>({})});
  expect((await editImage(source,'图',{...options,preferStructuralEdit:true,fetcher:upstream})).submissionUncertain).toBe(true);
});
it('never falls back to another supplier when 302 is unavailable',async()=>{
  ENV.api302Key='';const fetcher=vi.fn();
  expect((await generateImage('图',{...options,fetcher})).status).toBe('error');
  expect((await editImage(source,'图',{...options,fetcher})).status).toBe('error');expect(fetcher).not.toHaveBeenCalled();
});
