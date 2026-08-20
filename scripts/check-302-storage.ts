/**
 * check-302-storage — 探测 302/Forge 存储能否上传并返回公网 URL。
 *
 * 为什么需要：MJ 锁人物长相只有 --oref 一条路，而 --oref 只认公网 http(s)
 * （MJ 服务端要自己去拉图）。故事版的帧都是本机 /api/images/...，能把它们变成
 * 公网 URL 的就是这条存储链路。2026-08-19 它返回 503「当前无可用模型」，
 * 于是整条人物一致性就断了——重渲每次换张脸。
 *
 * 只读探测：上传一个几十字节的文本，不产图、不扣图片费用。
 * 退出码 0 = 通了，1 = 还没好。
 */
import "dotenv/config";
import { storagePut } from "../server/storage";

try {
  const { url } = await storagePut(
    `probe/storage-${Date.now()}.txt`,
    Buffer.from("drinking-time storage probe"),
    "text/plain"
  );
  console.log(`OK 存储可用，公网 URL：${url}`);
  process.exit(0);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.log(`DOWN ${message.slice(0, 200)}`);
  process.exit(1);
}
