import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
export function MobileStoryTags({storyId}:{storyId:number}) {
  const query = trpc.storyAgent.storyTags.useQuery({storyId});
  const mutation = trpc.storyAgent.setStoryTags.useMutation();
  const utils = trpc.useUtils();
  const [editing,setEditing]=useState(false),[value,setValue]=useState(""),[error,setError]=useState("");
  const tags=query.data?.tags || [];
  const [baseTags,setBaseTags]=useState<string[]>([]);
  async function save() {
    const next=[...new Set(value.split(/[,，、\n]/).map(t=>t.trim().replace(/^#/,"")).filter(Boolean))];
    if(next.length>12 || next.some(t=>t.length>24)) {setError("最多12个标签，每个不超过24字");return;}
    try {
      const result=await mutation.mutateAsync({storyId,tags:next,expectedTags:baseTags});
      utils.storyAgent.storyTags.setData({storyId},result);
      void utils.storyAgent.storyList.invalidate();
      setEditing(false);setError("");
    } catch(e) {setError(e instanceof Error?e.message:"标签未保存，请重试");void query.refetch();}
  }
  return <div className="shrink-0 px-5 pb-2 text-sm" aria-label="故事标签">
    {editing ? <form onSubmit={e=>{e.preventDefault();void save();}} className="space-y-2">
      <input aria-label="编辑故事标签" placeholder="例如：家人，旅行，工作（用逗号分隔）" value={value} disabled={mutation.isPending} onChange={e=>setValue(e.target.value)} className="min-h-11 w-full rounded-lg border border-border bg-background px-3" />
      <div className="flex gap-4"><button type="submit" disabled={mutation.isPending} className="min-h-11 text-primary">{mutation.isPending?"保存中…":"保存标签"}</button><button type="button" disabled={mutation.isPending} onClick={()=>setEditing(false)}>取消</button></div>
      <p className="text-xs text-muted-foreground">删除输入框中的标签即可移除，不影响正文和素材。</p>
    </form> : <button type="button" disabled={!query.data} onClick={()=>{setBaseTags([...tags]);setValue(tags.join("，"));setEditing(true);setError("");}} className="min-h-9 text-left text-primary">{tags.length?tags.map(t=>`#${t}`).join("　"):"＋ 添加标签"}</button>}
    {(error || query.isError) && <p role="alert" className="text-destructive">{error || "标签暂时无法读取"}</p>}
  </div>;
}
