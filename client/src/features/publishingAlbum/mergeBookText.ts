import {readBookImage} from '@shared/bookImageBlock';
import {readBookAudio} from '@shared/bookAudioBlock';
import {type WritingBlock,blockAncestors} from './chapterBlockTree';
/** Merge in manuscript order, keeping the first block identity and lifting orphan children. */
export function mergeBookText(blocks:WritingBlock[],ids:string[]):WritingBlock[] {
 const chosen=new Set(ids),items=blocks.filter(b=>chosen.has(b.id));
 if(items.length<2||items.some(b=>readBookImage(b.text)||readBookAudio(b.text)))return blocks;
 const first=items[0],parent=blockAncestors(blocks,first.id).find(id=>!chosen.has(id))??null;
 return blocks.filter(b=>!chosen.has(b.id)||b.id===first.id).map(b=>{
  if(b.id===first.id)return {...b,text:items.map(item=>item.text).join('\n'),format:'text' as const,videoRole:items.every(item=>item.videoRole==='dialogue')?'dialogue' as const:undefined,collapsed:false,parentId:parent,columnGroup:undefined,columnRatio:undefined};
  if(b.parentId&&chosen.has(b.parentId))return {...b,parentId:blockAncestors(blocks,b.id).find(id=>!chosen.has(id))??null};
  return b;
 });
}
