import { expect, it, vi } from 'vitest';
import { confirmBookVideo } from './confirmBookVideo';
import type { BookVideoRecord } from '@shared/bookVideoCreation';
const proposed = {id:'one',status:'proposed',brief:{question:''}} as BookVideoRecord;
const ready = {...proposed,revision:2,status:'ready',preview:{shots:[]}} as unknown as BookVideoRecord;
function actions() {return {prepare:vi.fn().mockResolvedValue(undefined),generate:vi.fn().mockResolvedValue(ready),adopt:vi.fn().mockResolvedValue({}),openTimeline:vi.fn().mockResolvedValue(undefined),review:vi.fn().mockResolvedValue(undefined)};}
it('direction confirmation generates a preview and stops for script review',async()=>{
  const a=actions();await confirmBookVideo(proposed,a);
  expect(a.prepare.mock.invocationCallOrder[0]).toBeLessThan(a.generate.mock.invocationCallOrder[0]);
  expect(a.review).toHaveBeenCalledWith(ready);expect(a.adopt).not.toHaveBeenCalled();expect(a.openTimeline).not.toHaveBeenCalled();
  await confirmBookVideo(ready,a,ready.revision);
  expect(a.adopt.mock.invocationCallOrder[0]).toBeLessThan(a.openTimeline.mock.invocationCallOrder[0]);
});
it('a retry after adoption failure reuses the prepared preview',async()=>{
  const a=actions();a.adopt.mockRejectedValueOnce(new Error('offline'));
  await expect(confirmBookVideo(ready,a,ready.revision)).rejects.toThrow('offline');
  expect(a.openTimeline).not.toHaveBeenCalled();
  await confirmBookVideo(ready,a,ready.revision);expect(a.generate).not.toHaveBeenCalled();expect(a.openTimeline).toHaveBeenCalledTimes(1);
});
it('a stale or absent review cannot adopt an existing preview',async()=>{
 const a=actions();await confirmBookVideo(ready,a);await confirmBookVideo(ready,a,1);
 expect(a.review).toHaveBeenCalledTimes(2);expect(a.adopt).not.toHaveBeenCalled();
});
it('a confirmed version opens without regenerating or adopting again',async()=>{
  const a=actions();await confirmBookVideo({...ready,status:'adopted'},a);
  expect(a.openTimeline).toHaveBeenCalledOnce();expect(a.generate).not.toHaveBeenCalled();expect(a.adopt).not.toHaveBeenCalled();
});
it('missing conditions, failed save and pending preparation never open an empty timeline',async()=>{
  const a=actions();await expect(confirmBookVideo({...proposed,brief:undefined},a)).rejects.toThrow('制作条件');
  expect(a.prepare).not.toHaveBeenCalled();
  a.prepare.mockRejectedValueOnce(new Error('save conflict'));
  await expect(confirmBookVideo(proposed,a)).rejects.toThrow('save conflict');expect(a.generate).not.toHaveBeenCalled();
  a.generate.mockResolvedValueOnce(proposed);
  await expect(confirmBookVideo(proposed,a)).rejects.toThrow('正在整理分镜');expect(a.adopt).not.toHaveBeenCalled();expect(a.openTimeline).not.toHaveBeenCalled();
});
