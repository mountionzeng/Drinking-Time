import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import ChatImageRemixTray from './ChatImageRemixTray';
import type { ChatImageRemixController } from '../useChatImageRemix';
it('shows submitted references, elapsed wait and unknown settlement without retaining a purchase button',()=>{
  vi.stubGlobal('React',React);
  const html=renderToStaticMarkup(<ChatImageRemixTray remix={{refs:[],status:'generating',startedAt:Date.now()-65000,draft:{refs:[{imageId:2117}],estimatedCny:2.86}} as unknown as ChatImageRemixController}/>);
  expect(html).toContain('#2117');expect(html).toContain('等待图片服务返回');expect(html).toContain('1分5秒');
  expect(html).toContain('实扣尚无结算回执');expect(html).not.toContain('确认并生成');expect(html).not.toContain('尚未开始');
  vi.unstubAllGlobals();
});

it('shows a query-only recovery action after bounded watching, without authorizing another generation',()=>{
  vi.stubGlobal('React',React);
  const html=renderToStaticMarkup(<ChatImageRemixTray remix={{refs:[],status:'pending',recoveryQuoteId:'q',error:'原任务尚未取回',draft:null,result:null} as unknown as ChatImageRemixController}/>);
  expect(html).toContain('继续取回原任务');expect(html).not.toContain('确认并生成');expect(html).not.toContain('text-destructive');
  vi.unstubAllGlobals();
});
