import {z} from 'zod';

const blockId=z.string().regex(/^block-[a-f0-9]{64}$/);
const photoId=z.string().regex(/^photo-[a-z0-9-]{1,120}$/),unique=<T>(values:T[])=>new Set(values).size===values.length;
export const cardSelectionSchema=z.object({revisionId:z.string().regex(/^revision-[a-zA-Z0-9-]{1,119}$/),
  chapterId:z.string().regex(/^chapter-[a-z0-9-]{1,60}$/),blockIds:z.array(blockId).min(1).max(12).refine(unique),photoIds:z.array(photoId).max(4).refine(unique)}).strict();
export const cardDescriptorSchema=z.object({id:z.string().regex(/^card-[a-f0-9]{64}$/),version:z.literal(1),storyId:z.string(),revisionId:z.string(),
  storyVersion:z.number().int().positive().max(2147483647),chapterId:z.string(),title:z.string().max(40),chapterTitle:z.string().max(40),byline:z.string().max(300),
  paragraphs:z.array(z.string().max(1200)).min(1).max(12).refine(values=>values.reduce((total,value)=>total+value.length,0)<=1200),
  photos:z.array(z.object({photoId,blockId}).strict()).max(4)}).strict();
const sourceBlockSchema=z.object({blockId,kind:z.enum(['text','photo']),preview:z.string().max(180).optional(),characterCount:z.number().optional(),photoId:photoId.optional(),publishable:z.boolean()}).strict();
export const cardSourceSchema=z.object({story:z.object({id:z.string(),title:z.string().max(40),version:z.number().int().positive().max(2147483647)}).strict(),revisionId:z.string(),
  chapters:z.array(z.object({id:z.string(),title:z.string().max(40),blocks:z.array(sourceBlockSchema).max(512)}).strict()).max(30)}).strict();
export const cardMaterialSchema=z.object({descriptor:cardDescriptorSchema,media:z.array(z.object({photoId,url:z.string().url().max(4096).refine(value=>{
  const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password;
}),requestedMaxAgeSeconds:z.literal(300)}).strict()).max(4)}).strict();
export type CardSelection=z.infer<typeof cardSelectionSchema>;
export type CardDescriptor=z.infer<typeof cardDescriptorSchema>;
export type CardSource=z.infer<typeof cardSourceSchema>;
export type CardMaterial=z.infer<typeof cardMaterialSchema>;
