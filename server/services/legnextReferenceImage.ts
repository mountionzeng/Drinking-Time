import { ENV } from '../_core/env';
import { toPublicImageUrl } from './imageGen';

/** The domestic API still returns file.302.ai. Use its verified same-path
 * file origin and check it before buying a generation task. Other providers
 * and signed private originals keep their exact URL, including the signature. */
export async function legnextReferenceImage(source: string): Promise<string> {
  const raw = await toPublicImageUrl(source);
  if (!raw) throw new Error('Reference unavailable');
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid reference');
  let domestic = false;
  try { domestic = new URL(ENV.api302BaseUrl).hostname === 'api.302ai.cn'; } catch { /* Leave custom gateways unchanged. */ }
  if (domestic && url.hostname === 'file.302.ai' && !url.port) {
    url.hostname = 'file.302ai.cn';
    const response = await fetch(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15_000) });
    // Do not download a second full copy. The content response must be a real
    // image, never a login page or an error document returned with HTTP 200.
    await response.body?.cancel();
    if (!response.ok || !/^image\/(?:png|jpeg|webp)(?:;|$)/i.test(response.headers.get('content-type') ?? ''))
      throw new Error('Reference cannot be read before submission');
    return url.href;
  }
  return raw;
}
