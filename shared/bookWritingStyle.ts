import { z } from 'zod';
const finite=z.number().finite();
export const bookWritingStyleSchema=z.array(z.object({
  id:z.string().min(1).max(100),format:z.enum(['text','heading1','heading2','heading3']),
  parentId:z.string().max(100).nullable(),collapsed:z.boolean(),
  emphasis:z.enum(['normal','bright']).optional(),backdrop:z.boolean().optional(),
  book:z.object({page:z.number().int().min(0).max(999),fontSize:finite.min(12).max(120),rect:z.object({x:finite.min(0).max(900),y:finite.min(0).max(1200),width:finite.min(24).max(900),height:finite.min(24).max(1200)})}).optional(),
})).max(20000);
export type BookWritingStyle=z.infer<typeof bookWritingStyleSchema>;
// Property insertion order differs between editor objects and validated server JSON.
// Compare meaning, so a successful save cannot remain dirty or create a save loop.
export function sameWritingStyle(a:BookWritingStyle|undefined,b:BookWritingStyle|undefined):boolean {
  if(a===b) return true;
  if(!a || !b || a.length!==b.length) return false;
  return a.every((row,index)=>{
    const other=b[index];
    if(row.id!==other.id || row.format!==other.format || row.parentId!==other.parentId || row.collapsed!==other.collapsed ||
      (row.emphasis ?? 'normal')!==(other.emphasis ?? 'normal') || Boolean(row.backdrop)!==Boolean(other.backdrop)) return false;
    if(!row.book || !other.book) return row.book===other.book;
    return row.book.page===other.book.page && row.book.fontSize===other.book.fontSize &&
      row.book.rect.x===other.book.rect.x && row.book.rect.y===other.book.rect.y &&
      row.book.rect.width===other.book.rect.width && row.book.rect.height===other.book.rect.height;
  });
}
export function validWritingStyle(body:string,style:BookWritingStyle):boolean {
  if(style.length!==body.replace(/\r\n?/g,'\n').split('\n').length) return false;
  const seen=new Map<string,BookWritingStyle[number]>();
  let ancestors:string[]=[];
  for(const row of style){
    if(seen.has(row.id)) return false;
    if(row.parentId!==null){
      const parent=seen.get(row.parentId);
      if(!parent || parent.format==='text' || !ancestors.includes(row.parentId)) return false;
      ancestors=ancestors.slice(0,ancestors.indexOf(row.parentId)+1);
    }else ancestors=[];
    if(row.format!=='text') ancestors.push(row.id);
    seen.set(row.id,row);
  }
  return true;
}
