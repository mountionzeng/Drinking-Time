import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {ChatImageEditRecovery} from './ChatImageEditRecovery';
it('labels the exact original image and disables recovery while another action or draft is active',()=>{
  const request={failureId:'f',quoteId:'q',storyId:1217,stableShotId:'shot-3',shotNo:3,
    ref:{imageId:2126,imageUrl:'/2126.png',label:'#2126'},instruction:'原话',userContent:'原话'};
  let calls=0;
  const html=renderToStaticMarkup(<ChatImageEditRecovery request={request} disabled onQuote={()=>{calls++;}}/>);
  expect(html).toContain('disabled');expect(html).toContain('#2126');expect(html).toContain('只准备报价，不生成');expect(calls).toBe(0);
});
