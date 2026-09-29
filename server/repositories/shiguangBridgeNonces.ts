import {createHash} from "node:crypto";
import {lt} from "drizzle-orm";

import {shiguangBridgeNonces} from "../../drizzle/schema";
import {getDb} from "./runtime";

const CLEANUP_INTERVAL_MS=300_000;
let nextCleanupAt=0;

export async function claimShiguangBridgeNonce(timestamp:string,nonce:string,now=Date.now()):Promise<boolean>{
  const db=await getDb();if(!db)throw new Error("database_required");
  if(now>=nextCleanupAt){nextCleanupAt=now+CLEANUP_INTERVAL_MS;await db.delete(shiguangBridgeNonces).where(lt(shiguangBridgeNonces.expiresAt,new Date(now)));}
  const nonceHash=createHash("sha256").update(`${timestamp}:${nonce}`).digest("hex");
  const result=await db.insert(shiguangBridgeNonces).ignore().values({nonceHash,expiresAt:new Date(now+300_001)});
  return result[0].affectedRows===1;
}
