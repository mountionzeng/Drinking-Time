import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {afterEach, expect, it, vi} from "vitest";
const hooks=vi.hoisted(()=>({effects:[] as Array<()=>void|(()=>void)>}));
vi.mock("react", async original=>({...await original<typeof import("react")>(),useEffect:(fn:()=>void|(()=>void))=>hooks.effects.push(fn)}));
import {WarehouseConnectionStatus,isWarehouseConnectionError} from "./WarehouseConnectionStatus";
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();hooks.effects=[];});
it("recovers failed reads periodically and stops when the warehouse is closed",()=>{
  vi.useFakeTimers();vi.stubGlobal("React",React);vi.stubGlobal("window",{setInterval,clearInterval});
  const retry=vi.fn();
  const html=renderToStaticMarkup(<WarehouseConnectionStatus error={{message:"Failed to fetch"}} retry={retry}/>);
  const dispose=hooks.effects[0]() as ()=>void;
  expect(html).toContain("正在重新连接");expect(html).not.toContain("Failed to fetch");
  vi.advanceTimersByTime(10000);expect(retry).toHaveBeenCalledOnce();
  dispose();vi.advanceTimersByTime(30000);expect(retry).toHaveBeenCalledOnce();
});
it("does not retry permission or server validation errors as a network failure",()=>{
  expect(isWarehouseConnectionError({message:"UNAUTHORIZED"})).toBe(false);
  expect(isWarehouseConnectionError({message:"素材不存在"})).toBe(false);
  expect(isWarehouseConnectionError({message:"Load failed"})).toBe(true);
});
