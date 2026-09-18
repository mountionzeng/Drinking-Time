import {cardMaterialSchema, type CardMaterial} from '../../../../shared/storyShareCard';

export function wrapCardText(text:string, measure:(value:string)=>number, width:number):string[]{
  const lines:string[]=[];
  for(const paragraph of text.split('\n')){
    let line='';
    for(const character of Array.from(paragraph)){
      if(line&&measure(line+character)>width){lines.push(line);line='';}
      line+=character;
    }
    lines.push(line);
  }
  return lines;
}

function loadPhoto(url:string):Promise<HTMLImageElement>{
  return new Promise((resolve,reject)=>{
    const image=new Image(),timer=setTimeout(()=>{image.src='';reject(new Error('照片读取超时，请重新预览'));},15000);
    image.crossOrigin='anonymous';image.referrerPolicy='no-referrer';
    image.onload=()=>{clearTimeout(timer);resolve(image);};
    image.onerror=()=>{clearTimeout(timer);reject(new Error('照片暂时无法用于导出，请重试或取消这张照片'));};
    image.src=url;
  });
}

export async function renderStoryCard(raw:CardMaterial):Promise<Blob>{
  const {descriptor,media}=cardMaterialSchema.parse(raw);
  if(media.length!==descriptor.photos.length||new Set(media.map(item=>item.photoId)).size!==media.length)throw new Error('照片不完整，请重新预览');
  const images=await Promise.all(descriptor.photos.map(photo=>{
    const item=media.find(item=>item.photoId===photo.photoId);
    if(!item)throw new Error('照片不完整，请重新预览');
    return loadPhoto(item.url);
  }));
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
  if(!ctx)throw new Error('当前浏览器不支持图片导出');
  const width=900,padding=72,contentWidth=width-padding*2;
  ctx.font='42px serif';
  const title=wrapCardText(descriptor.title,value=>ctx.measureText(value).width,contentWidth);
  ctx.font='26px sans-serif';
  const chapter=wrapCardText(descriptor.chapterTitle,value=>ctx.measureText(value).width,contentWidth);
  ctx.font='30px serif';
  const paragraphs=descriptor.paragraphs.map(text=>wrapCardText(text,value=>ctx.measureText(value).width,contentWidth));
  ctx.font='22px sans-serif';
  const byline=wrapCardText(descriptor.byline,value=>ctx.measureText(value).width,contentWidth);
  const sizes=images.map(image=>{const scale=Math.min(contentWidth/image.naturalWidth,560/image.naturalHeight);return {width:image.naturalWidth*scale,height:image.naturalHeight*scale};});
  const height=padding*2+70+title.length*58+chapter.length*40+36+paragraphs.reduce((sum,lines)=>sum+lines.length*50+28,0)+sizes.reduce((sum,size)=>sum+size.height+32,0)+byline.length*34+30;
  if(!Number.isFinite(height)||height>8000)throw new Error('卡片过长，请减少段落或换行后重试');
  canvas.width=width;canvas.height=Math.ceil(height);
  ctx.fillStyle='#faf7ef';ctx.fillRect(0,0,width,height);
  let y=padding;ctx.textBaseline='top';ctx.fillStyle='#657b64';ctx.font='22px sans-serif';ctx.fillText('拾光 / 故事摘录',padding,y);y+=70;
  const draw=(lines:string[],font:string,color:string,lineHeight:number)=>{ctx.font=font;ctx.fillStyle=color;for(const line of lines){ctx.fillText(line,padding,y);y+=lineHeight;}};
  draw(title,'42px serif','#29352e',58);draw(chapter,'26px sans-serif','#657b64',40);y+=36;
  for(const lines of paragraphs){draw(lines,'30px serif','#29352e',50);y+=28;}
  images.forEach((image,index)=>{const size=sizes[index];ctx.drawImage(image,(width-size.width)/2,y,size.width,size.height);y+=size.height+32;});
  y+=30;draw(byline,'22px sans-serif','#657b64',34);
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('图片生成失败，请重新预览')),'image/png'));
}
