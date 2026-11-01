import express from 'express';
import {once} from 'node:events';
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
const processing=vi.hoisted(()=>vi.fn());
vi.mock('../services/materialCaptureProcessing',()=>({processCapture:processing}));
vi.mock('./mediaRouteAuth',()=>({resolveMediaRouteUserId:vi.fn(async req=>Number(req.headers['x-test-owner']) || null)}));
import {materialCaptureRoutes} from './materialCaptureRoutes';
import {createCaptureToken,receiveCapture} from '../services/materialCapture';
import {revokeCaptureTokens,listCaptures} from '../repositories/materialCaptures';
import {resetMemoryStateForTesting} from '../db';
import sharp from 'sharp';
import {randomUUID} from 'node:crypto';
import type {Server} from 'node:http';
let server:Server,base:string;
beforeEach(async()=>{resetMemoryStateForTesting();processing.mockReset();processing.mockResolvedValue(undefined);const app=express();app.use('/api/material-captures',materialCaptureRoutes());server=app.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api/material-captures`;});
afterEach(async()=>{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));});
describe('create-only external receiver',()=>{
  it('rejects cookies/query tokens; bearer retries retain one batch; revoked tokens stop writing',async()=>{
    const {token}=await createCaptureToken(81),body=JSON.stringify({encodedItems:Buffer.from('虚构：纸船在港口。').toString('base64')});
    expect((await fetch(`${base}/receive?token=${token}`,{method:'POST',headers:{cookie:'session=anything','Content-Type':'application/json'},body})).status).toBe(401);
    const send=()=>fetch(`${base}/receive`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body});
    const first=await send();expect(first.status).toBe(202);const receipt=await first.json();
    expect((await (await send()).json()).id).toBe(receipt.id);expect(await listCaptures(81)).toHaveLength(1);
    expect((await fetch(base,{headers:{Authorization:`Bearer ${token}`}})).status).toBe(404);
    await revokeCaptureTokens(81);expect((await send()).status).toBe(401);
  });
  it('serves original bytes only to the owner, never via a create token',async()=>{
    const bytes=await sharp({create:{width:2,height:2,channels:3,background:'blue'}}).png().toBuffer();
    const id=randomUUID(),fileId=randomUUID();await receiveCapture(81,{id,origin:'chat',text:'',files:[{id:fileId,name:'原图.png',mime:'image/png',base64:bytes.toString('base64')}]});
    const url=`${base}/${id}/files/${fileId}`;
    expect((await fetch(url)).status).toBe(401);expect((await fetch(url,{headers:{'x-test-owner':'82'}})).status).toBe(404);
    const response=await fetch(url,{headers:{'x-test-owner':'81'}});expect(response.status).toBe(200);expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);expect(response.headers.get('cache-control')).toContain('no-store');
    const range=await fetch(url,{headers:{'x-test-owner':'81',range:'bytes=0-15'}});expect(range.status).toBe(206);expect(Buffer.from(await range.arrayBuffer())).toEqual(bytes.subarray(0,16));expect(range.headers.get('content-range')).toBe(`bytes 0-15/${bytes.length}`);
    expect((await fetch(url,{headers:{'x-test-owner':'82',range:'bytes=0-15'}})).status).toBe(404);
    expect((await fetch(url,{headers:{'x-test-owner':'81',range:'bytes=999999-'}})).status).toBe(416);
  });
});
