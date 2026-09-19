/** Persistence boundary for authoritative 拾光 story access bindings. */
import {and,eq} from "drizzle-orm";

import {shiguangStoryAccessBindings} from "../../drizzle/schema";
import type {BoundShiguangStory,ShiguangStoryAccessStore} from "../services/shiguangStoryAccess";
import {getDb} from "./runtime";

export async function withShiguangStoryAccessStore<T>(run:(store:ShiguangStoryAccessStore)=>Promise<T>):Promise<T>{
  const db=await getDb();
  if(!db)throw new Error("database_required");
  return db.transaction(async tx=>run({
    findByGrant:async grantId=>(await tx.select().from(shiguangStoryAccessBindings).where(eq(shiguangStoryAccessBindings.grantId,grantId)).for("update"))[0],
    upsert:async(userId,input)=>{await tx.insert(shiguangStoryAccessBindings).values({userId,sourceFamilyId:input.familyId,sourceStoryId:input.storyId,
      grantId:input.grantId,sourceRevisionId:input.revisionId,sourceVersion:input.version,title:input.title,status:"active"})
      .onDuplicateKeyUpdate({set:{grantId:input.grantId,sourceRevisionId:input.revisionId,sourceVersion:input.version,title:input.title,status:"active"}});},
    findByStory:async(userId,familyId,storyId)=>(await tx.select().from(shiguangStoryAccessBindings).where(and(
      eq(shiguangStoryAccessBindings.userId,userId),eq(shiguangStoryAccessBindings.sourceFamilyId,familyId),eq(shiguangStoryAccessBindings.sourceStoryId,storyId),
    )).for("update"))[0],
  }));
}

export async function listActiveShiguangStoryAccessBindings(userId:number):Promise<BoundShiguangStory[]>{
  const db=await getDb();
  if(!db)throw new Error("database_required");
  return db.select().from(shiguangStoryAccessBindings).where(and(eq(shiguangStoryAccessBindings.userId,userId),eq(shiguangStoryAccessBindings.status,"active")));
}

export async function findActiveShiguangStoryAccessBinding(userId:number,accessId:number):Promise<BoundShiguangStory|undefined>{
  const db=await getDb();
  if(!db)throw new Error("database_required");
  return (await db.select().from(shiguangStoryAccessBindings).where(and(eq(shiguangStoryAccessBindings.id,accessId),
    eq(shiguangStoryAccessBindings.userId,userId),eq(shiguangStoryAccessBindings.status,"active"))).limit(1))[0];
}

export async function revokeShiguangStoryAccessBinding(userId:number,accessId:number):Promise<void>{
  const db=await getDb();if(!db)throw new Error("database_required");
  await db.update(shiguangStoryAccessBindings).set({status:"revoked"}).where(and(eq(shiguangStoryAccessBindings.id,accessId),
    eq(shiguangStoryAccessBindings.userId,userId),eq(shiguangStoryAccessBindings.status,"active")));
}
