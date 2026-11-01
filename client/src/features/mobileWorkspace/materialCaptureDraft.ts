import { CAPTURE_MAX_FILE_BYTES, CAPTURE_MAX_FILES, CAPTURE_MAX_TOTAL_BYTES, type CaptureInput } from "@shared/materialCapture";

export type LocalCaptureDraft = { id: string; text: string; files: File[]; origin: CaptureInput["origin"]; incomingId?: string; submitted?: boolean };
export function openCaptureDrafts(): Promise<IDBDatabase> {
  return new Promise((resolve,reject) => {
    const request = indexedDB.open("shiguang-material-capture",1);
    request.onupgradeneeded = () => {
      for (const store of ["drafts","incoming"]) if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function captureDraftStore<T>(store: "drafts" | "incoming", key: IDBValidKey, action: "read" | "write" | "delete", value?: T): Promise<T | undefined> {
  const db = await openCaptureDrafts();
  try {
    return await new Promise((resolve,reject) => {
      const tx = db.transaction(store, action === "read" ? "readonly" : "readwrite"), table = tx.objectStore(store);
      const request = action === "read" ? table.get(key) : action === "delete" ? table.delete(key) : table.put(value,key);
      tx.oncomplete = () => resolve(action === "read" ? request.result as T | undefined : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("无法保留未发送素材"));
    });
  } finally { db.close(); }
}
/** Claim an OS share once, so signing into a different account cannot reveal it. */
export async function claimIncomingCapture(id:string,userId:number):Promise<LocalCaptureDraft | undefined> {
  const db=await openCaptureDrafts();
  try {
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction("incoming","readwrite"),table=tx.objectStore("incoming"),request=table.get(id);
      let result:LocalCaptureDraft | undefined, failure:Error | undefined;
      request.onsuccess=()=>{
        const incoming=request.result as (LocalCaptureDraft & {claimedUserId?:number}) | undefined;
        if(!incoming)return;
        if(incoming.claimedUserId && incoming.claimedUserId!==userId){failure=new Error("这批分享素材已保留在之前登录的账号，请切回原账号查看。");tx.abort();return;}
        table.put({...incoming,claimedUserId:userId},id);result=incoming;
      };
      tx.oncomplete=()=>resolve(result);
      tx.onerror=tx.onabort=()=>reject(failure || tx.error || new Error("无法保留分享素材"));
    });
  } finally {db.close();}
}
export function captureFileMime(file: File): CaptureInput["files"][number]["mime"] {
  const aliases: Record<string,string> = { "audio/x-m4a":"audio/mp4", "audio/x-wav":"audio/wav", "audio/mp3":"audio/mpeg" };
  const extensions: Record<string,string> = { jpg:"image/jpeg",jpeg:"image/jpeg",png:"image/png",webp:"image/webp",mp3:"audio/mpeg",m4a:"audio/mp4",wav:"audio/wav",webm:"audio/webm",ogg:"audio/ogg" };
  const type = file.type.split(";")[0].toLowerCase();
  const mime = aliases[type] || type || extensions[file.name.split(".").pop()?.toLowerCase() || ""];
  if (!Object.values(extensions).includes(mime)) throw new Error(`暂不支持 ${file.name}，请使用 JPG/PNG/WebP 图片或 MP3/M4A/WAV/WebM/Ogg 录音`);
  return mime as CaptureInput["files"][number]["mime"];
}
export function validateCaptureFiles(files: File[]) {
  if (files.length > CAPTURE_MAX_FILES) throw new Error("每次最多6份素材");
  if (files.reduce((sum,file) => sum+file.size,0) > CAPTURE_MAX_TOTAL_BYTES) throw new Error("每次素材合计最多20MB");
  for (const file of files) { captureFileMime(file); if (!file.size || file.size > CAPTURE_MAX_FILE_BYTES) throw new Error(`${file.name} 需在8MB以内且不为空`); }
}
export async function captureFilePayload(file: File, id: string) {
  const base64 = await new Promise<string>((resolve,reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error(`无法读取${file.name}`));
    reader.readAsDataURL(file);
  });
  return { id, name:file.name, mime:captureFileMime(file), base64 };
}
