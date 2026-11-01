import {beforeEach,expect,it,vi} from 'vitest';
import type {TrpcContext} from '../_core/context';
const calls=vi.hoisted(()=>({receive:vi.fn(),token:vi.fn(),process:vi.fn(),list:vi.fn(),read:vi.fn(),revoke:vi.fn(),save:vi.fn()}));
vi.mock('../services/materialCapture',()=>({receiveCapture:calls.receive,createCaptureToken:calls.token,toCaptureReceipt:(value:unknown)=>value}));
vi.mock('../repositories/materialCaptures',()=>({readCapture:calls.read,listCaptures:calls.list,revokeCaptureTokens:calls.revoke}));
vi.mock('../services/materialCaptureProcessing',()=>({processCapture:calls.process,saveCaptureWithoutAI:calls.save}));
import {materialCaptureRouter} from './materialCapture';
const caller=materialCaptureRouter.createCaller({user:{id:22},req:{},res:{}} as TrpcContext);
const id='12345678-1234-4234-8234-123456789abc';
beforeEach(()=>vi.clearAllMocks());
it('rejects every action from a stale account before any read, write or AI call',async()=>{
 const scope={expectedUserId:21};
 const actions=[()=>caller.receive({...scope,id,text:'test',origin:'chat',files:[]}),()=>caller.get({...scope,id}),()=>caller.list(scope),()=>caller.process({...scope,id}),()=>caller.saveOriginal({...scope,id}),()=>caller.createShareToken(scope),()=>caller.revokeShareTokens(scope)];
 for(const action of actions)await expect(action()).rejects.toMatchObject({code:'CONFLICT'});
 for(const call of Object.values(calls))expect(call).not.toHaveBeenCalled();
});
it('always uses the authenticated principal and preserves the capture id',async()=>{
 calls.receive.mockResolvedValue({id});
 await caller.receive({expectedUserId:22,id,text:'test',origin:'chat',files:[]});
 await caller.process({expectedUserId:22,id});
 expect(calls.receive).toHaveBeenCalledWith(22,expect.objectContaining({id}));
 expect(calls.process).toHaveBeenCalledWith(22,id);
});
