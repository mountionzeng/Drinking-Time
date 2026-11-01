import {describe,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import mysql from 'mysql2/promise';
import {withMysqlTestDatabase,spawnMysqlTestWorker} from './mysqlTestHarness';
const run=async(databaseUrl:string,input:unknown)=>{const {stdout}=await spawnMysqlTestWorker({databaseUrl,script:path.resolve('server/integration/materialCaptureMysqlWorker.ts'),args:[Buffer.from(JSON.stringify(input)).toString('base64url')]}).completion;const line=stdout.split('\n').find(line=>line.startsWith('CAPTURE_'));if(!line)throw new Error('No result');return line.startsWith('CAPTURE_ERROR:')?{error:line.slice(14)}:JSON.parse(line.slice(15));};
(process.env.TEST_MYSQL_DATABASE_URL?describe:describe.skip)('material capture real MySQL transaction',()=>{
  it('rolls back partial story creation and commits exactly once across independent processes',async()=>{
    await withMysqlTestDatabase(async db=>{
      const id=randomUUID(),input={id,userId:61};
      const received=await Promise.all([run(db.databaseUrl,{...input,action:'receive'}),run(db.databaseUrl,{...input,action:'receive'})]);expect(received.every(row=>row.status==='received')).toBe(true);
      await run(db.databaseUrl,{...input,action:'ready'});
      expect(await run(db.databaseUrl,{...input,action:'commit',fail:true})).toMatchObject({error:'intentional rollback'});
      const connection=await mysql.createConnection(db.databaseUrl);
      try{
        const [empty]=await connection.query<any[]>('SELECT id FROM stories');expect(empty).toHaveLength(0);
        const results=await Promise.all([run(db.databaseUrl,{...input,action:'commit'}),run(db.databaseUrl,{...input,action:'commit'})]);
        expect(results[0].status).toBe('saved');expect(results[0].storyId).toBe(results[1].storyId);
        const [stories]=await connection.query<any[]>('SELECT id FROM stories');expect(stories).toHaveLength(1);
        expect(await run(db.databaseUrl,{...input,userId:62,action:'read'})).toHaveProperty('error');
      }finally{await connection.end();}
    });
  });
});
