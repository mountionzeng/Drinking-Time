import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import sharp from 'sharp';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import EmotiveWuxingIcon from '../../client/src/features/nayin/views/EmotiveWuxingIcon';
const output=path.resolve(import.meta.dirname,'../dist');
await mkdir(output,{recursive:true});
for(const element of ['metal','wood','water','fire','earth'] as const){
  const markup=renderToStaticMarkup(<EmotiveWuxingIcon element={element} size={192} animated={false}/>);
  const svg=markup.match(/<svg[\s\S]*?<\/svg>/)?.[0];
  if(!svg)throw new Error('missing original icon '+element);
  await sharp(Buffer.from(svg)).resize(192,192).png().toFile(path.join(output,`character-${element}.png`));
}
console.log('五行图标由手机版原组件渲染完成；未重新设计。');
