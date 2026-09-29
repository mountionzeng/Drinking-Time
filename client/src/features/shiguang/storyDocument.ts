export type StoryBlock={text?:string;photoId?:string;blockId:string;sourceIds:string[]};
export type StoryDocument={familyId:string;storyId:string;revisionId:string;version:number;title:string;updatedAt:string;provenanceVersion:1;
  chapters:Array<{id:string;title:string;content:StoryBlock[]}>};
export type DraftBlock=StoryBlock&{localId?:string;isOwnAddition?:boolean};
export type StoryEditorDraft={chapters:Array<{id:string;title:string;content:DraftBlock[]}>};
export type StoryWriteEdit={action:"edit";blockId:string;text:string}|{action:"appendOwn";chapterId:string;text:string};

const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value)) as T;

export function createEditorDraft(document:StoryDocument):StoryEditorDraft{
  return {chapters:clone(document.chapters)};
}

export function updateDraftBlock(draft:StoryEditorDraft,blockId:string,text:string):StoryEditorDraft{
  return {chapters:draft.chapters.map(chapter=>({...chapter,content:chapter.content.map(block=>
    (block.blockId===blockId||block.localId===blockId)?{...block,text}:block)}))};
}

export function appendOwnDraftBlock(draft:StoryEditorDraft,chapterId:string,localId:string):StoryEditorDraft{
  return {chapters:draft.chapters.map(chapter=>chapter.id===chapterId?{...chapter,content:[...chapter.content,
    {text:"",blockId:"",sourceIds:[],localId,isOwnAddition:true}]}:chapter)};
}

export function removeOwnDraftBlock(draft:StoryEditorDraft,localId:string):StoryEditorDraft{
  return {chapters:draft.chapters.map(chapter=>({...chapter,content:chapter.content.filter(block=>block.localId!==localId)}))};
}

export function buildWriteEdits(document:StoryDocument,draft:StoryEditorDraft):StoryWriteEdit[]{
  const original=new Map(document.chapters.flatMap(chapter=>chapter.content.filter(block=>typeof block.text==="string").map(block=>[block.blockId,block.text!] as const)));
  const edits:StoryWriteEdit[]=[];
  for(const chapter of draft.chapters)for(const block of chapter.content){
    if(block.isOwnAddition){if(typeof block.text==="string"&&block.text.trim())edits.push({action:"appendOwn",chapterId:chapter.id,text:block.text});continue;}
    if(typeof block.text==="string"&&original.has(block.blockId)&&original.get(block.blockId)!==block.text)edits.push({action:"edit",blockId:block.blockId,text:block.text});
  }
  return edits;
}

export function rebaseEditorDraft(base:StoryDocument,next:StoryDocument,current:StoryEditorDraft):StoryEditorDraft|null{
  const baseText=new Map(base.chapters.flatMap(chapter=>chapter.content.filter(block=>typeof block.text==="string").map(block=>[block.blockId,block.text!] as const)));
  const nextText=new Map(next.chapters.flatMap(chapter=>chapter.content.filter(block=>typeof block.text==="string").map(block=>[block.blockId,block.text!] as const)));
  const localText=new Map(current.chapters.flatMap(chapter=>chapter.content.filter(block=>!block.isOwnAddition&&typeof block.text==="string"&&baseText.get(block.blockId)!==block.text)
    .map(block=>[block.blockId,block.text!] as const)));
  const additions=new Map(current.chapters.map(chapter=>[chapter.id,chapter.content.filter(block=>block.isOwnAddition)] as const));
  for(const [blockId,text] of localText){const before=baseText.get(blockId),latest=nextText.get(blockId);if(latest===undefined||(latest!==before&&latest!==text))return null;}
  const nextChapterIds=new Set(next.chapters.map(chapter=>chapter.id));
  if([...additions].some(([chapterId,blocks])=>blocks.some(block=>typeof block.text==="string"&&block.text.trim())&&!nextChapterIds.has(chapterId)))return null;
  return {chapters:next.chapters.map(chapter=>({id:chapter.id,title:chapter.title,content:[...chapter.content.map(block=>
    typeof block.text==="string"&&localText.has(block.blockId)?{...block,text:localText.get(block.blockId)!}:clone(block)),...(additions.get(chapter.id)||[])]}))};
}

export function draftHasChanges(document:StoryDocument,draft:StoryEditorDraft):boolean{return buildWriteEdits(document,draft).length>0;}
