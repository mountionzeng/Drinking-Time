import { expect, it, vi } from 'vitest';
import { readWarehouseChatSelection, READ_WAREHOUSE_CHAT_SELECTION, type WarehouseChatSelectionRequest } from './warehouseChatSelection';
it('reads the open selection in order, rejects other stories and retains no stale copy',()=>{
 const target=new EventTarget();vi.stubGlobal('window',target);
 const listener=(event:Event)=>{const detail=(event as CustomEvent<WarehouseChatSelectionRequest>).detail;if(detail.storyId===7)detail.selection={stableShotId:'s3',imageIds:[2118,2117]};};
 target.addEventListener(READ_WAREHOUSE_CHAT_SELECTION,listener);
 expect(readWarehouseChatSelection(7)).toEqual({stableShotId:'s3',imageIds:[2118,2117]});expect(readWarehouseChatSelection(8)).toBeNull();
 target.removeEventListener(READ_WAREHOUSE_CHAT_SELECTION,listener);expect(readWarehouseChatSelection(7)).toBeNull();vi.unstubAllGlobals();
});
