import {findActiveShiguangStoryAccessBinding,listActiveShiguangStoryAccessBindings,withShiguangStoryAccessStore} from "../repositories/shiguangStoryAccess";

export type ShiguangStoryAccessGrant = {
  grantId: string;
  familyId: string;
  storyId: string;
  revisionId: string;
  version: number;
  title: string;
};

export type BoundShiguangStory = {
  id: number;
  userId: number;
  sourceFamilyId: string;
  sourceStoryId: string;
  grantId: string;
  sourceRevisionId: string;
  sourceVersion: number;
  title: string;
  status: "active" | "revoked";
};
export type ShiguangStoryAccessStore={
  findByGrant:(grantId:string)=>Promise<BoundShiguangStory|undefined>;
  upsert:(userId:number,grant:ShiguangStoryAccessGrant)=>Promise<void>;
  findByStory:(userId:number,familyId:string,storyId:string)=>Promise<BoundShiguangStory|undefined>;
};

const exact = (value: Record<string, unknown>, fields: string[]) =>
  Object.keys(value).every(key => fields.includes(key));

export function parseShiguangStoryAccessGrant(value: unknown): ShiguangStoryAccessGrant | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const grant = value as Record<string, unknown>;
  if (!exact(grant, ["grantId", "familyId", "storyId", "revisionId", "version", "title"]) ||
    typeof grant.grantId !== "string" || !/^desktop-grant-[a-f0-9]{64}$/.test(grant.grantId) ||
    typeof grant.familyId !== "string" || !/^family_[0-9A-Za-z_-]{1,120}$/.test(grant.familyId) ||
    typeof grant.storyId !== "string" || !/^story-[a-z0-9-]{1,100}$/.test(grant.storyId) ||
    typeof grant.revisionId !== "string" || !/^revision-[a-zA-Z0-9-]{1,120}$/.test(grant.revisionId) ||
    !Number.isSafeInteger(grant.version) || (grant.version as number) < 1 ||
    typeof grant.title !== "string" || !grant.title.trim() || grant.title.length > 120) return null;
  return { ...grant, title: grant.title.trim() } as ShiguangStoryAccessGrant;
}

export async function bindShiguangStoryAccessWithStore(userId:number,grant:ShiguangStoryAccessGrant,store:ShiguangStoryAccessStore):Promise<BoundShiguangStory>{
  if (!Number.isSafeInteger(userId) || userId < 1) throw new Error("invalid_user");
  const sameGrant=await store.findByGrant(grant.grantId);
  if(sameGrant&&(sameGrant.userId!==userId||sameGrant.sourceFamilyId!==grant.familyId||sameGrant.sourceStoryId!==grant.storyId))throw new Error("grant_conflict");
  await store.upsert(userId,grant);
  const binding=await store.findByStory(userId,grant.familyId,grant.storyId);
  if(!binding||binding.grantId!==grant.grantId)throw new Error("binding_failed");
  return binding;
}

export async function bindShiguangStoryAccess(userId: number, grant: ShiguangStoryAccessGrant): Promise<BoundShiguangStory> {
  if (!Number.isSafeInteger(userId) || userId < 1) throw new Error("invalid_user");
  return withShiguangStoryAccessStore(store=>bindShiguangStoryAccessWithStore(userId,grant,store));
}

export async function listShiguangStoryAccess(userId:number):Promise<BoundShiguangStory[]> {
  if(!Number.isSafeInteger(userId)||userId<1)throw new Error("invalid_user");
  return listActiveShiguangStoryAccessBindings(userId);
}

export async function getShiguangStoryAccess(userId:number,accessId:number):Promise<BoundShiguangStory|undefined> {
  if(!Number.isSafeInteger(userId)||userId<1||!Number.isSafeInteger(accessId)||accessId<1)throw new Error("invalid_access");
  return findActiveShiguangStoryAccessBinding(userId,accessId);
}
