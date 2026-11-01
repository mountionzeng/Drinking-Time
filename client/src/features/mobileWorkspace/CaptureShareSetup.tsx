import React, { useState } from "react";
import { trpc } from "@/lib/trpc";

export function CaptureShareSetup({userId}:{userId:number}) {
  const create = trpc.materialCapture.createShareToken.useMutation({retry:false});
  const revoke = trpc.materialCapture.revokeShareTokens.useMutation({retry:false});
  const [binding,setBinding] = useState(""), [message,setMessage] = useState("");
  const canBind = typeof location !== "undefined" && location.protocol === "https:" && !["localhost","127.0.0.1","[::1]"].includes(location.hostname);
  return <div className="my-2 space-y-3 rounded-xl bg-muted p-3 leading-6">
    {!canBind && <p role="status">这是本机预览。手机系统分享需要上线 HTTPS 版本后，在手机打开拾光进行安装或绑定；本机地址不能用于手机。</p>}
    <p><strong>安卓</strong>：用 Chrome 打开拾光，菜单中选择“安装应用”。安装后，在相册、浏览器或录音 App 点“分享 → 拾光”。收到后会回到聊天，确认发送才整理。部分浏览器不支持系统分享接收，可直接在聊天选文件。</p>
    <p><strong>iPhone</strong>：添加“发送到拾光”快捷指令，并填入下方绑定信息。之后在相册、备忘录或录音 App 点“分享 → 发送到拾光”。绑定有效期90天，只能添加素材。</p>
    <div className="flex flex-wrap gap-3"><a href="/shortcuts/send-to-shiguang.shortcut" className="text-primary">添加快捷指令</a>
      <button type="button" className="text-primary" disabled={!canBind || create.isPending} onClick={() => void create.mutateAsync({expectedUserId:userId}).then(value => {setBinding(JSON.stringify({url:`${location.origin}/api/material-captures/receive`,token:value.token}));setMessage("请将绑定信息粘贴到快捷指令的初始设置中，不要发送给其他人。");}).catch(() => setMessage("绑定失败，请稍后重试"))}>生成绑定信息</button>
      <button type="button" className="text-muted-foreground" disabled={revoke.isPending} onClick={() => void revoke.mutateAsync({expectedUserId:userId}).then(() => {setBinding("");setMessage("旧绑定已撤销，可重新绑定。");}).catch(() => setMessage("撤销未完成，请稍后重试"))}>撤销旧绑定</button>
    </div>
    {binding && <><textarea readOnly aria-label="快捷指令绑定信息" className="w-full rounded bg-background p-2 text-xs" rows={3} value={binding}/><button type="button" className="text-primary" onClick={() => void navigator.clipboard.writeText(binding).then(() => setMessage("绑定信息已复制")).catch(() => setMessage("请长按上面的绑定信息复制"))}>复制绑定信息</button></>}
    {message && <p role="status">{message}</p>}
  </div>;
}
