import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { estimateLocalImagePatchCost, LOCAL_IMAGE_PATCH_PROFILE } from '../../shared/imageRenderCost';
import { cloudArtDirection, cloudShapeQuoteSchema, forestPaletteStatus, frameRegionReviewSchema, type CloudArtDirection, type CloudShapeQuote, type FrameRegionReview, type FrameRegionTask } from '../../shared/frameRegionReview';
import { getStoryById, updateStoryBodyIfRevision } from '../repositories/stories';
import { jsonRecord, persistedStoryBodyRevision } from '../repositories/storyValues';
import { createGeneratedImage, getStoryGeneratedImages } from '../repositories/images';
import { getStoryMaterialState } from './storyMaterials';
import { readStoryImageBytes } from './chatColorTransfer';
import { editImage, storeImageBytes } from './imageGen';
import { recoverStoryboardImageTask, runStoryboardImageTask } from './storyboardImageTask';

const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const decode = { limitInputPixels: 16_777_216 };
const fingerprint = (quote: Omit<CloudShapeQuote, 'fingerprint'>) => {
  const parts: unknown[] = [
  quote.requestId,quote.sourceImageId,quote.sourceImageUrl,quote.sourceSha,quote.maskUrl,quote.maskSha,quote.overlayUrl,
  quote.prompt,quote.estimatedCny,quote.expiresAt,quote.width,quote.height,quote.growthPixels,LOCAL_IMAGE_PATCH_PROFILE,'cloud-shape-v1',
  ];
  // Keep older paid receipts recoverable; new quotes bind structured art intent.
  if (quote.artDirection) parts.push(quote.artDirection);
  return sha(JSON.stringify(parts));
};

/** Reserve a small growth margin, then subtract protected objects. The preview is
 * the exact final edit permission; generating never expands it again. */
export async function buildCloudEditMask(region: Uint8Array, protection: Uint8Array, growth?: number) {
  const [cloud, protect] = await Promise.all([region, protection].map(bytes => sharp(bytes, decode).removeAlpha().greyscale().raw().toBuffer({resolveWithObject:true})));
  const {width,height}=cloud.info, size=width*height;
  if(width!==protect.info.width || height!==protect.info.height) throw new Error('云范围与保护范围尺寸不一致 / Mask dimensions differ');
  const growthPixels=Math.min(48,Math.max(1,growth ?? Math.round(Math.min(width,height)*.025)));
  const distance=new Int32Array(size).fill(-1), queue=new Int32Array(size);
  let tail=0;
  for(let i=0;i<size;i++) if(cloud.data[i]>127) {distance[i]=0;queue[tail++]=i;}
  if(!tail) throw new Error('尚未定位云层 / Clouds have not been located');
  for(let head=0;head<tail;head++) {
    const i=queue[head]; if(distance[i]>=growthPixels) continue;
    const x=i%width;
    for(const j of [x>0?i-1:-1,x<width-1?i+1:-1,i-width,i+width]) {
      if(j<0||j>=size||distance[j]>=0) continue;
      distance[j]=distance[i]+1;queue[tail++]=j;
    }
  }
  const pixels=Buffer.alloc(size*4,255); let selected=0;
  for(let i=0;i<size;i++) if(distance[i]>=0&&distance[i]<=growthPixels&&protect.data[i]===0) {pixels[i*4+3]=0;selected++;}
  if(!selected||selected>=size*.85) throw new Error('云局部范围不明确，请先调整范围 / Refine the local cloud region');
  const mask=await sharp(pixels,{raw:{width,height,channels:4}}).png().toBuffer();
  return {mask,width,height,growthPixels};
}
export function cloudShapePrompt(instruction: string, direction = cloudArtDirection(instruction)) {
  return [
    'Modify ONLY clouds inside the transparent mask. Only when requested, make them moderately larger or thicker with rounded, layered volume, using only the available growth margin. Keep their centers, depth order and perspective. Apply only the changes stated by the user.',
    direction.highlights === 'white' ? 'Cloud highlights must be near-white, softly warm or neutral, with visible grain and rounded volume; no flat clipped white patches.' : 'Keep existing highlight colors unless whiteness is requested; then lighten highlights only.',
    direction.shadows === 'colorful' ? 'Use rich multicolored shadows and midtones from the scene palette, with subtle hue variation and soft transitions into white highlights. No neon or gray shadows.' : 'Preserve colored midtones and shadows; any higher saturation stays out of white highlights.',
    direction.quantity === 'slightly_more'
      ? 'Increase cloud quantity modestly: a few secondary cloud forms only within the permitted mask. Keep open gaps, depth and existing main cloud centers; do not just enlarge or duplicate every cloud.'
      : direction.quantity === 'fewer'
      ? 'Reduce cloud count and crowding: remove surplus small cloud clusters within the mask, leaving wider open gaps with scene-matched background. Keep the remaining main clouds layered and thick; do not fill gaps with new objects or shrink every cloud.'
      : 'Preserve the current number and placement of cloud groups.',
    direction.textureRepetition === 'reduce'
      ? 'Reduce texture repetition: vary silhouette, lobe size, spacing, density and fine-grain clustering across cloud groups. No cloned stamps, tiled texture or identical repeated balls. Preserve the same delicate pointillist medium; do not replace repetition with random noise.'
      : 'Preserve the existing texture character.',
    'Retain pointillist grain and soft edges. Do not globally recolor, increase contrast, sharpen, zoom or resize. Preserve forests, city, paths and all content outside the mask. Keep the same airplane count and silhouettes; no extra wings, paper shapes, duplicates or reflections. No unrelated objects or text. These resolved color, quantity and texture rules override older conflicting descriptions.',
    `User cloud request: ${instruction.slice(-300)}`,
  ].join('\n');
}
export async function compareCloudCandidate(source: Uint8Array, output: Uint8Array, mask: Uint8Array) {
  const [a,b,m]=await Promise.all([source,output,mask].map(bytes=>sharp(bytes,decode).ensureAlpha().raw().toBuffer({resolveWithObject:true})));
  if(a.info.width!==b.info.width||a.info.height!==b.info.height||a.info.width!==m.info.width||a.info.height!==m.info.height) throw new Error('候选尺寸发生变化 / Candidate dimensions changed');
  let changedPixels=0;
  for(let i=0;i<a.data.length;i+=4) {
    if(!a.data.subarray(i,i+4).equals(b.data.subarray(i,i+4))) {
      if(m.data[i+3]!==0) throw new Error('云范围外有像素变化，未交付 / Pixels outside the cloud region changed');
      changedPixels++;
    }
  }
  if(!changedPixels) throw new Error('没有有效的云层修改 / No cloud change was produced');
  return {changedPixels,outsideChangedPixels:0 as const};
}

type Image = Awaited<ReturnType<typeof getStoryGeneratedImages>>[number];
function inheritedForest(review: FrameRegionReview, history: FrameRegionReview[], image: Image) {
  const sameShot = history.filter(row => row.storyId === review.storyId && row.editorUserId === review.editorUserId &&
    row.stableShotId === review.stableShotId && row.phase !== 'cancelled');
  return sameShot
    .flatMap(row => row.tasks).find(task => task.target === 'forest' && task.approvedRevision != null &&
      task.candidate?.imageId === image.id && task.imageId === image.parentImageId) ??
    sameShot.flatMap(row => [...(row.forestTreatmentHistory ?? []), ...(row.fixedForestPalette ? [row.fixedForestPalette] : [])])
      .find(reference => reference.imageId === image.id);
}
async function forestObjectBytes(task: Pick<FrameRegionTask, 'maskUrl' | 'maskSha' | 'objectMaskUrl' | 'objectMaskSha'>, image: Image, read = readStoryImageBytes) {
  const bytes = await read({...image, imageUrl:task.objectMaskUrl ?? task.maskUrl});
  if (sha(bytes) !== (task.objectMaskSha ?? task.maskSha)) throw new Error('森林保护范围已变化 / Forest protection changed');
  return bytes;
}
export async function prepareCloudShapeQuote(input: {review:FrameRegionReview;task:FrameRegionTask;images:Image[];instruction:string;history?:FrameRegionReview[]}, deps={read:readStoryImageBytes,store:storeImageBytes}) {
  const {review,task,images}=input;
  const original=images.find(i=>i.id===task.imageId)!;
  if(!original) throw new Error('云层原图不可用 / Cloud source unavailable');
  const source=await deps.read(original);
  if(sha(source)!==task.sourceSha) throw new Error('云层原图已变化 / Cloud source changed');
  const [region,protectedBytes]=await Promise.all([deps.read({...original,imageUrl:task.maskUrl}),deps.read({...original,imageUrl:task.protectedUrl})]);
  if(sha(region)!==task.maskSha) throw new Error('云范围已变化 / Cloud region changed');
  // Inherited green is an explicit user decision. Keep that result as the base,
  // but never silently choose an unrelated newer warehouse image.
  const forest=review.tasks.find(t=>t.target==='forest'&&t.imageId===task.imageId&&t.approvedRevision!=null&&t.candidate);
  const base=forest?.candidate?images.find(i=>i.id===forest.candidate!.imageId&&i.parentImageId===original.id):original;
  if(!base) throw new Error('已确认森林候选不可用 / Confirmed forest candidate unavailable');
  const baseBytes=base.id===original.id?source:await deps.read(base);
  let protection=protectedBytes;
  const preservedForest = forest ?? inheritedForest(review, input.history ?? [], base);
  if(preservedForest) {
    const objectBytes=await forestObjectBytes(preservedForest,base,deps.read);
    const [p,f]=await Promise.all([protection,objectBytes].map(bytes=>sharp(bytes).greyscale().raw().toBuffer({resolveWithObject:true})));
    if(p.info.width!==f.info.width||p.info.height!==f.info.height) throw new Error('保护范围尺寸不一致');
    for(let i=0;i<p.data.length;i++) p.data[i]=Math.max(p.data[i],f.data[i]);
    protection=await sharp(p.data,{raw:{width:p.info.width,height:p.info.height,channels:1}}).png().toBuffer();
  }
  const {mask,width,height,growthPixels}=await buildCloudEditMask(region,protection);
  const [baseRaw,maskRaw]=await Promise.all([baseBytes,mask].map(bytes=>sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true})));
  if(baseRaw.info.width!==width||baseRaw.info.height!==height) throw new Error('底图尺寸不一致');
  const overlay=Buffer.from(baseRaw.data);
  for(let i=0;i<overlay.length;i+=4) if(maskRaw.data[i+3]===0) for(let c=0;c<3;c++) overlay[i+c]=Math.round(overlay[i+c]*.55+[232,60,144][c]*.45);
  const requestId=randomUUID();
  const [storedMask,storedOverlay]=await Promise.all([
    deps.store(mask,'image/png',{storageKey:`generated/frame-regions/${review.editorUserId}-${requestId}-cloud-edit.png`}),
    deps.store(await sharp(overlay,{raw:{width,height,channels:4}}).png().toBuffer(),'image/png',{storageKey:`generated/frame-regions/${review.editorUserId}-${requestId}-cloud-preview.png`}),
  ]);
  if(storedMask.status!=='ok'||!storedMask.imageUrl||storedOverlay.status!=='ok'||!storedOverlay.imageUrl) throw new Error('云范围保存失败');
  const artDirection: CloudArtDirection=task.cloudArtDirection ?? cloudArtDirection(input.instruction);
  const unsigned={requestId,sourceImageId:base.id,sourceImageUrl:base.imageUrl,sourceSha:sha(baseBytes),maskUrl:storedMask.imageUrl,maskSha:sha(mask),overlayUrl:storedOverlay.imageUrl,
    prompt:cloudShapePrompt(input.instruction,artDirection),artDirection,estimatedCny:estimateLocalImagePatchCost().estimatedCny,expiresAt:Date.now()+30*60_000,width,height,growthPixels};
  return cloudShapeQuoteSchema.parse({...unsigned,fingerprint:fingerprint(unsigned)});
}

/** Older accepted quotes may predate ancestry protection. Tighten delivery
 * locally using the paid result, without changing the receipt or purchasing. */
async function preserveInheritedForest(source: Uint8Array, output: Uint8Array, objects: Uint8Array) {
  const [a,b,f] = await Promise.all([
    sharp(source,decode).ensureAlpha().raw().toBuffer({resolveWithObject:true}),
    sharp(output,decode).ensureAlpha().raw().toBuffer({resolveWithObject:true}),
    sharp(objects,decode).greyscale().raw().toBuffer({resolveWithObject:true}),
  ]);
  const {width,height}=a.info;
  if(width!==b.info.width||height!==b.info.height||width!==f.info.width||height!==f.info.height) throw new Error('森林保护尺寸不一致');
  if(!f.data.some((v,i)=>v>0&&!a.data.subarray(i*4,i*4+4).equals(b.data.subarray(i*4,i*4+4)))) return null;
  const hard=Buffer.from(f.data.map(v=>v>0?255:0));
  const soft=await sharp(hard,{raw:{width,height,channels:1}}).blur(2).greyscale().raw().toBuffer();
  const result=Buffer.from(b.data);
  for(let i=0;i<hard.length;i++) {
    const weight=Math.max(hard[i],soft[i])/255;
    for(let c=0;c<3;c++) result[i*4+c]=Math.round(a.data[i*4+c]*weight+b.data[i*4+c]*(1-weight));
    result[i*4+3]=a.data[i*4+3];
  }
  return sharp(result,{raw:{width,height,channels:4}}).png().toBuffer();
}

export type CloudShapeInput={storyId:number;userId:number;reviewId:string;expectedRevision:number;stableShotId:string;requestId:string;recoverOnly?:boolean;confirmation:{accepted:true;fingerprint:string;estimatedCny:number}};
export async function generateCloudShape(input:CloudShapeInput) {
  const story=await getStoryById(input.storyId,input.userId);
  if(!story) throw new Error('故事不存在');
  const body=jsonRecord(story.body);
  const reviews=(Array.isArray(body.frameRegionReviews)?body.frameRegionReviews:[]).map(r=>frameRegionReviewSchema.parse(r));
  const review=reviews.find(r=>r.id===input.reviewId&&r.editorUserId===input.userId&&r.stableShotId===input.stableShotId);
  const task=review?.tasks.find(t=>t.target==='cloud'&&t.shapeQuote?.requestId===input.requestId);
  const q=task?.shapeQuote;
  const completedRetry = task?.candidate && task.approvedRevision === input.expectedRevision;
  if(!review||!q||(!completedRetry && review.revision!==input.expectedRevision)||review.phase==='cancelled') throw new Error('云范围已变化，请查看最新范围 / Cloud review changed');
  if((await getStoryMaterialState(input.storyId,input.userId))?.timeline.version!==review.timelineVersion) throw new Error('剪辑版本已变化，请重新选择图片');
  const {fingerprint:quotedHash,...unsigned}=q;
  if(!input.confirmation.accepted||quotedHash!==fingerprint(unsigned)||input.confirmation.fingerprint!==quotedHash||input.confirmation.estimatedCny!==q.estimatedCny||q.estimatedCny!==estimateLocalImagePatchCost().estimatedCny) throw new Error('云层报价已变化，请重新确认');
  const images=await getStoryGeneratedImages(input.storyId,input.userId),base=images.find(i=>i.id===q.sourceImageId&&i.shotIdentity===review.stableShotId);
  if(!base) throw new Error('云底图不可用');
  const [source,mask]=await Promise.all([readStoryImageBytes(base),readStoryImageBytes({...base,imageUrl:q.maskUrl})]);
  if(sha(source)!==q.sourceSha||sha(mask)!==q.maskSha) throw new Error('原图或云范围已变化，未提交生成');
  const existing=Array.isArray(body.storyboardImageTasks)&&body.storyboardImageTasks.some(t=>t.requestId===q.requestId&&t.shotIdentity===review.stableShotId);
  if (!existing && forestPaletteStatus(base.id, reviews.filter(row => row.storyId === input.storyId && row.editorUserId === input.userId && row.stableShotId === review.stableShotId), images) === 'rejected')
    throw new Error('这张底图的森林配色已被否定，请先选好森林颜色再生成云层 / Forest colors were rejected; select a suitable base before generating clouds');
  if(input.recoverOnly&&!existing) throw new Error('尚未提交云层生成；查看结果不会购买新任务 / No cloud task to recover');
  if(!existing&&Date.now()>q.expiresAt) throw new Error('云层报价已过期，请重新说明修改');
  const scope={storyId:input.storyId,userId:input.userId,shotIdentity:review.stableShotId,requestId:q.requestId,requireNewIntent:true};
  let result=existing?await recoverStoryboardImageTask(input.storyId,input.userId,q.requestId):await runStoryboardImageTask(scope,async render=>{
    const meta={provider:'gpt-image' as const,prompt:q.prompt,instruction:task!.instruction,shotNo:`SH${String(review.shotNo).padStart(2,'0')}`,generationType:'inpaint' as const,
      parentImageId:base.id,conversationRevision:true,referenceOnly:true,sourceDimensions:{width:q.width,height:q.height},
      maskedEdit:{sourceImageUrl:base.imageUrl,maskImageUrl:q.maskUrl,featherPixels:6}};
    const generated=await render(accepted=>editImage(base.imageUrl,q.prompt,{provider:'gpt-image',editMaskImageUrl:q.maskUrl,localImagePatch:true,localImagePatchFeatherPixels:6,gptSubmitOnly:true,onProviderTaskAccepted:accepted}),meta);
    if(generated.status!=='ok'||!generated.imageUrl) return {status:'error',error:generated.message??'云层结果尚未就绪',providerTaskId:generated.providerTaskId,submissionUncertain:generated.submissionUncertain,recoveryPending:generated.errorCode==='timeout_pending'};
    await compareCloudCandidate(source,await readStoryImageBytes({...base,imageUrl:generated.imageUrl}),mask);
    const image=await createGeneratedImage({storyId:input.storyId,userId:input.userId,projectId:story.projectId,shotIdentity:review.stableShotId,shotNo:meta.shotNo,parentImageId:base.id,
      imageKey:generated.imageKey,imageUrl:generated.imageUrl,prompt:q.prompt,generationType:'inpaint',isCurrent:false});
    return {status:'ok',imageId:image.id,imageUrl:image.imageUrl,candidates:[{imageId:image.id,imageUrl:image.imageUrl}]};
  });
  if(result.status!=='ok') return result;
  const preservedForest=inheritedForest(review,reviews,base);
  if(preservedForest) {
    const forestMask=await forestObjectBytes(preservedForest,base);
    const corrected=await preserveInheritedForest(source,await readStoryImageBytes({...base,imageUrl:result.imageUrl}),forestMask);
    if(corrected) {
      await compareCloudCandidate(source,corrected,mask);
      const imageKey=`generated/frame-regions/${input.userId}-${q.requestId}-${sha(forestMask).slice(0,12)}-forest-protected.png`;
      let image=images.find(image=>image.imageKey===imageKey&&image.parentImageId===base.id&&image.shotIdentity===review.stableShotId);
      if(!image) {
        const stored=await storeImageBytes(corrected,'image/png',{storageKey:imageKey});
        if(stored.status!=='ok'||!stored.imageUrl) throw new Error('候选保护结果保存失败');
        image=await createGeneratedImage({storyId:input.storyId,userId:input.userId,projectId:story.projectId,shotIdentity:review.stableShotId,
          shotNo:`SH${String(review.shotNo).padStart(2,'0')}`,parentImageId:base.id,imageKey,imageUrl:stored.imageUrl,
          prompt:`${q.prompt}\nLocal forest preservation; reuses paid candidate #${result.imageId}; no new model call.`,generationType:'inpaint',isCurrent:false});
      }
      result={...result,imageId:image.id,imageUrl:image.imageUrl,candidates:[{imageId:image.id,imageUrl:image.imageUrl}]};
    }
  }
  const metrics=await compareCloudCandidate(source,await readStoryImageBytes({...base,imageUrl:result.imageUrl}),mask);
  if(task?.candidate?.imageId===result.imageId) return {...result,frameReview:review};
  // If the user edited the scope while generation ran, retain the candidate in
  // Warehouse, but do not overwrite their newer review.
  for(let retry=0;retry<3;retry++) {
    const fresh=jsonRecord((await getStoryById(input.storyId,input.userId))?.body), rows=structuredClone(Array.isArray(fresh.frameRegionReviews)?fresh.frameRegionReviews:[]);
    const row=rows.find(r=>r.id===review.id);
    if(!row||row.phase==='cancelled') return {...result,frameReview:undefined};
    const cloud=row.tasks.find((t:FrameRegionTask)=>t.target==='cloud'&&t.shapeQuote?.requestId===q.requestId);
    if(!cloud) return {...result,frameReview:undefined};
    if(cloud.candidate?.imageId===result.imageId) return {...result,frameReview:frameRegionReviewSchema.parse(row)};
    if(row.revision!==review.revision) return {...result,frameReview:undefined};
    cloud.candidate={imageId:result.imageId,imageUrl:result.imageUrl,sourceImageId:base.id,...metrics};
    cloud.approvedRevision=review.revision;
    row.revision++;row.phase='image_review';row.updatedAt=Date.now();
    const revision=persistedStoryBodyRevision(fresh);
    if(await updateStoryBodyIfRevision({id:input.storyId,userId:input.userId,expectedRevision:revision,body:{...fresh,_revision:revision+1,frameRegionReviews:rows}})) return {...result,frameReview:frameRegionReviewSchema.parse(row)};
  }
  return {...result,frameReview:undefined};
}
