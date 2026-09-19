import React,{useEffect,useRef,useState} from 'react';
import {Image as ImageIcon,Download} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {trpc} from '@/lib/trpc';
import {cardSourceSchema,cardMaterialSchema,cardDescriptorSchema,type CardSource,type CardSelection,type CardDescriptor} from '../../../../shared/storyShareCard';
import {renderStoryCard} from './storyCardCanvas';

export function toggleStoryCardSelection(source:CardSource,chapterId:string,selected:string[],blockId:string):{selected:string[];error?:string}{
  if(selected.includes(blockId))return {selected:selected.filter(item=>item!==blockId)};
  if(selected.length>=12)return {selected,error:'一张故事卡最多选择 12 段内容'};
  const blocks=source.chapters.find(chapter=>chapter.id===chapterId)?.blocks||[],block=blocks.find(item=>item.blockId===blockId);
  const selectedPhotos=blocks.filter(item=>item.kind==='photo'&&selected.includes(item.blockId)).length;
  if(block?.kind==='photo'&&selectedPhotos>=4)return {selected,error:'一张故事卡最多选择 4 张照片'};
  return block?.publishable?{selected:[...selected,blockId]}:{selected};
}

export function StoryCardSelection({source,chapterId,selected,busy,onChapter,onToggle}:{source:CardSource;chapterId:string;selected:string[];busy:boolean;onChapter:(id:string)=>void;onToggle:(id:string)=>void}){
  const chapter=source.chapters.find(item=>item.id===chapterId),selectedPhotos=chapter?.blocks.filter(block=>block.kind==='photo'&&selected.includes(block.blockId)).length||0;
  return <fieldset disabled={busy} className="space-y-4">
    <label className="block text-sm font-medium">选择章节<select value={chapterId} onChange={event=>onChapter(event.target.value)} className="mt-2 block w-full rounded-md border border-input bg-background p-2 focus-visible:ring-2 focus-visible:ring-ring">
      {source.chapters.map(chapter=><option key={chapter.id} value={chapter.id}>{chapter.title||'未命名章节'}</option>)}
    </select></label>
    <p className="text-xs leading-5 text-muted-foreground">最多 12 段内容、4 张照片。只导出你勾选的内容，不附带私人阅读链接。</p>
    <div className="max-h-64 space-y-2 overflow-y-auto">{chapter?.blocks.map((block,index)=><label key={block.blockId} className={`flex gap-3 rounded-md border p-3 text-sm leading-6 transition-colors ${block.publishable?'border-border hover:bg-muted/40':'border-dashed border-border text-muted-foreground'}`}>
      <input type="checkbox" checked={selected.includes(block.blockId)} disabled={!block.publishable||(block.kind==='photo'&&!selected.includes(block.blockId)&&selectedPhotos>=4)} onChange={()=>onToggle(block.blockId)} className="mt-1.5 accent-primary"/>
      <span>{block.kind==='photo'?`照片 ${index+1}`:block.preview||'空段落'}{!block.publishable&&<span className="block text-xs">没有公开发布许可，不能选入卡片</span>}</span>
    </label>)}</div>
  </fieldset>;
}

export default function StoryShareCard({accessId,disabled}:{accessId:number;disabled:boolean}){
  const api=trpc.shiguangStoryAccess.card.useMutation();
  const [open,setOpen]=useState(false),[source,setSource]=useState<CardSource>(),[chapterId,setChapterId]=useState(''),[selected,setSelected]=useState<string[]>([]);
  const [preview,setPreview]=useState<{url:string;descriptor:CardDescriptor;selection:CardSelection}>(),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const epoch=useRef(0),blobUrl=useRef<string|undefined>(undefined);
  const clearPreview=()=>{if(blobUrl.current)URL.revokeObjectURL(blobUrl.current);blobUrl.current=undefined;setPreview(undefined);};
  useEffect(()=>()=>{epoch.current++;if(blobUrl.current)URL.revokeObjectURL(blobUrl.current);},[]);
  const close=()=>{epoch.current++;setOpen(false);setBusy(false);setSource(undefined);setSelected([]);setError('');clearPreview();};
  const show=async()=>{
    const token=++epoch.current;setOpen(true);setBusy(true);setError('');
    try{const value=cardSourceSchema.parse(await api.mutateAsync({accessId,operation:'source'}));if(token!==epoch.current)return;setSource(value);setChapterId(value.chapters[0]?.id||'');}
    catch{if(token===epoch.current)setError('暂时无法读取可发布内容，请关闭后重试。');}
    finally{if(token===epoch.current)setBusy(false);}
  };
  const generate=async()=>{
    if(!source||!selected.length)return;
    const blocks=source.chapters.find(chapter=>chapter.id===chapterId)?.blocks.filter(block=>selected.includes(block.blockId))||[];
    const selection:CardSelection={revisionId:source.revisionId,chapterId,blockIds:blocks.map(block=>block.blockId),photoIds:blocks.flatMap(block=>block.photoId?[block.photoId]:[])};
    const token=++epoch.current;setBusy(true);setError('');clearPreview();
    try{
      const result=await api.mutateAsync({accessId,operation:'preview',...selection});
      if(token!==epoch.current)return;
      if(!('descriptor' in result))throw new Error('卡片返回异常');
      const descriptor=cardDescriptorSchema.parse(result.descriptor);
      const material=cardMaterialSchema.parse(await api.mutateAsync({accessId,operation:'export',...selection,descriptorId:descriptor.id}));
      if(token!==epoch.current)return;
      const blob=await renderStoryCard(material);if(token!==epoch.current)return;
      const url=URL.createObjectURL(blob);blobUrl.current=url;setPreview({url,descriptor,selection});
    }catch(caught){if(token===epoch.current)setError(caught instanceof Error?caught.message:'生成失败，请重新选择后重试');}
    finally{if(token===epoch.current)setBusy(false);}
  };
  const download=async()=>{
    if(!preview)return;const token=++epoch.current;setBusy(true);setError('');
    try{
      const material=cardMaterialSchema.parse(await api.mutateAsync({accessId,operation:'export',...preview.selection,descriptorId:preview.descriptor.id}));
      if(token!==epoch.current)return;
      if(material.descriptor.id!==preview.descriptor.id)throw new Error('内容已更新，请重新预览');
      const anchor=document.createElement('a');anchor.href=preview.url;anchor.download='拾光-故事摘录.png';anchor.click();
    }catch(caught){if(token===epoch.current){clearPreview();setError(caught instanceof Error?caught.message:'下载前核验失败，请重新预览');}}
    finally{if(token===epoch.current)setBusy(false);}
  };
  return <><Button variant="outline" size="sm" disabled={disabled} onClick={()=>void show()} title={disabled?'请先保存修改':'生成可分享的图片'}><ImageIcon/>故事卡片</Button>
    <Dialog open={open} onOpenChange={value=>{if(!value)close();}}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>把这段记忆做成卡片</DialogTitle><DialogDescription>保存图片后，可以自行分享至朋友圈或其他社交平台。已被保存的图片无法远程收回。</DialogDescription></DialogHeader>
      {source&&<StoryCardSelection source={source} chapterId={chapterId} selected={selected} busy={busy} onChapter={id=>{clearPreview();setChapterId(id);setSelected([]);setError('');}}
        onToggle={id=>{clearPreview();const next=toggleStoryCardSelection(source,chapterId,selected,id);setSelected(next.selected);setError(next.error||'');}}/>}
      {error&&<p role="alert" className="text-sm leading-6 text-destructive">{error}</p>}
      {busy&&<p role="status" className="text-sm text-muted-foreground">正在核对权限和生成图片…</p>}
      {preview&&<img src={preview.url} alt="本次选中内容的故事卡片预览" className="mx-auto max-h-[50dvh] max-w-full object-contain"/>}
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={close}>关闭</Button>{preview?<Button disabled={busy} onClick={()=>void download()}><Download/>下载图片</Button>:<Button disabled={busy||!selected.length} onClick={()=>void generate()}>生成预览</Button>}</div>
    </DialogContent></Dialog></>;
}
