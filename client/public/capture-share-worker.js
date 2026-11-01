/* Receive OS shares only. Never cache or intercept application pages, scripts or APIs. */
self.addEventListener("install",event => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate",event => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch",event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname !== "/capture-share" || event.request.method !== "POST") return;
  event.respondWith((async () => {
    try {
      const data = await event.request.formData();
      const files = data.getAll("files").filter(value => value instanceof File && value.size);
      const text = [data.get("title"),data.get("text"),data.get("url")].filter(value => typeof value === "string" && value.trim()).join("\n");
      if(files.length>6 || files.some(file => file.size>8*1024*1024) || files.reduce((sum,file) => sum+file.size,0)>20*1024*1024 || text.length>20000) throw new Error("Too large");
      const id = crypto.randomUUID();
      const db = await new Promise((resolve,reject) => {
        const request = indexedDB.open("shiguang-material-capture",1);
        request.onupgradeneeded = () => { for (const store of ["drafts","incoming"]) if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store); };
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      try {
        await new Promise((resolve,reject) => {
          const tx = db.transaction("incoming","readwrite");
          tx.objectStore("incoming").put({id,text,files,origin:"android-share"},id);
          tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
        });
      } finally {db.close();}
      return Response.redirect(new URL(`/m?captureShare=${id}`,self.location.origin).href,303);
    } catch {
      return new Response("素材尚未保存。请返回来源 App，将素材分为每批6份以内、每份8MB以内后重试，或打开拾光聊天直接添加。",{status:400,headers:{"Content-Type":"text/plain; charset=utf-8","Cache-Control":"no-store"}});
    }
  })());
});
