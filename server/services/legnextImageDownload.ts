import https from "node:https";
import dns from "node:dns";

/** ECS getaddrinfo can return AAAA only despite a valid A record. Keep TLS/SNI
 * on the original allowlisted host, but resolve IPv4 explicitly for this CDN. */
export function downloadLegnextImage(url: URL): Promise<Uint8Array> {
  if (url.protocol !== "https:" || url.hostname !== "images.sexapi.ai" || url.port || url.username || url.password) {
    return Promise.reject(new Error("Unexpected image host"));
  }
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      family: 4,
      lookup: (host, _options, callback) => dns.resolve4(host, (error, addresses) => {
        if (error || !addresses?.length) callback(error ?? new Error("No IPv4 address"), "", 4);
        else callback(null, addresses[0], 4);
      }),
    }, response => {
      if (response.statusCode !== 200) { response.resume(); reject(new Error("Image download failed")); return; }
      const chunks: Buffer[] = [];
      let length = 0;
      response.on("data", (chunk: Buffer) => {
        length += chunk.length;
        if (length > 25 * 1024 * 1024) { request.destroy(new Error("Image too large")); return; }
        chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("end", () => resolve(Buffer.concat(chunks)));
    });
    const timer = setTimeout(() => request.destroy(new Error("Image download timed out")), 30_000);
    request.on("error", reject);
    request.on("close", () => clearTimeout(timer));
  });
}
