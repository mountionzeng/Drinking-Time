import {insertCapture,mutateCapture,commitCaptureStory,readCapture} from '../repositories/materialCaptures';
const input=JSON.parse(Buffer.from(process.argv[2],'base64url').toString('utf8'));
try {
  if(input.action==='receive')await insertCapture({id:input.id,userId:input.userId,inputHash:'a'.repeat(64),status:'received',manifest:{origin:'chat',text:'虚构原文',files:[]},progress:{evidence:[]},storyId:null,createdAt:new Date(),updatedAt:new Date()});
  if(input.action==='ready')await mutateCapture(input.userId,input.id,row=>{row.status='ready';row.progress.draft={title:'纸船（测试）',body:'虚构正文'};});
  if(input.action==='commit')await commitCaptureStory(input.userId,input.id,()=>{if(input.fail)throw new Error('intentional rollback');return {materialCapture:{id:input.id}};});
  const row=await readCapture(input.userId,input.id);process.stdout.write('CAPTURE_RESULT:'+JSON.stringify(row)+'\n',()=>process.exit(0));
}catch(error){process.stdout.write('CAPTURE_ERROR:'+String((error as Error).message)+'\n',()=>process.exit(0));}
