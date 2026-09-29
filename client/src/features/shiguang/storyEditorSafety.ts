import type {StoryDocument,StoryEditorDraft} from "./storyDocument";

type StoryWriteReceipt={storyId:string;revisionId:string;version:number};
type StorageLike=Pick<Storage,"getItem"|"setItem"|"removeItem">;
type StoryDraftRecovery={base:StoryDocument;draft:StoryEditorDraft};
const key=(accessId:number)=>`shiguang-story-draft:${accessId}`;

const record=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==="object"&&!Array.isArray(value);

export function isWriteReconciled(receipt:StoryWriteReceipt,document:StoryDocument|undefined):document is StoryDocument{
  return Boolean(document&&document.storyId===receipt.storyId&&document.revisionId===receipt.revisionId&&document.version===receipt.version);
}

export function writeStoryDraftRecovery(storage:StorageLike,accessId:number,base:StoryDocument,draft:StoryEditorDraft):void{
  storage.setItem(key(accessId),JSON.stringify({accessId,base,draft}));
}

export function readStoryDraftRecovery(storage:StorageLike,accessId:number):StoryDraftRecovery|null{
  let value:unknown;try{const raw=storage.getItem(key(accessId));if(!raw)return null;value=JSON.parse(raw);}catch{return null;}
  if(!record(value)||value.accessId!==accessId||!record(value.base)||!record(value.draft)||!Array.isArray(value.base.chapters)||!Array.isArray(value.draft.chapters)||
    typeof value.base.storyId!=="string"||typeof value.base.revisionId!=="string"||!Number.isSafeInteger(value.base.version))return null;
  return {base:value.base as unknown as StoryDocument,draft:value.draft as unknown as StoryEditorDraft};
}

export function clearStoryDraftRecovery(storage:StorageLike,accessId:number):void{storage.removeItem(key(accessId));}
