/**
 * Outbound HTTP helpers.
 *
 * Every URL this server fetches originates from either model output or user
 * paste, so none of it is trusted. The guard lives here rather than in each
 * route so there's one definition to keep correct.
 */

import { lookup } from 'node:dns/promises';

const FETCH_TIMEOUT_MS = 15_000;

/** Redirect chains longer than this are a loop or a trap, not a product page. */
const MAX_REDIRECTS = 5;

const UA = 'Mozilla/5.0 (compatible; AIRoomEditor/0.1; +local)';

/**
 * Reject anything that isn't a public http(s) address.
 *
 * Without this the server will happily fetch its own admin endpoints or a cloud
 * metadata address when a model hands it a URL to look at.
 */
export function assertFetchableUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('not a valid URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('only http and https URLs are supported');
  }

  const host = url.hostname.toLowerCase();
  const blocked =
    host === 'localhost' ||
    host === '::1' ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);

  if (blocked) throw new Error('refusing to fetch a local or private address');
  return url;
}

/**
 * Is this resolved address one we refuse to talk to?
 *
 * The hostname check above can only see the name. A name is not an address:
 * `evil.example.com` is free to have an A record pointing at 169.254.169.254,
 * and that is the actual shape of a cloud-metadata attack. So every hop is
 * resolved and every address it resolves to is checked.
 */
function isPrivateAddress(ip: string, family: number): boolean {
  if (family === 4) {
    const parts = ip.split('.').map(Number);
    const [a = 0, b = 0] = parts;
    return (
      a === 0 || // 0.0.0.0/8 "this network"
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) || // link-local, incl. cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 198 && (b === 18 || b === 19)) || // benchmarking
      a >= 224 // multicast and reserved
    );
  }

  const address = ip.toLowerCase();
  // IPv4-mapped addresses (::ffff:10.0.0.1) are IPv4 wearing a hat.
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped?.[1]) return isPrivateAddress(mapped[1], 4);

  return (
    address === '::' ||
    address === '::1' ||
    /^f[cd][0-9a-f]{2}:/.test(address) || // unique local fc00::/7
    /^fe[89ab][0-9a-f]:/.test(address) // link-local fe80::/10
  );
}

/** Resolve a host and refuse it if any address it answers with is private. */
export async function assertPublicHost(url: URL): Promise<void> {
  let addresses: { address: string; family: number }[];
  try {
    addresses = await lookup(url.hostname, { all: true });
  } catch {
    throw new Error('could not resolve that host');
  }

  for (const { address, family } of addresses) {
    if (isPrivateAddress(address, family)) {
      throw new Error('refusing to fetch a local or private address');
    }
  }
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

async function fetchOnce(url: URL, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      // Redirects are followed by hand below so each hop can be re-checked.
      redirect: 'manual',
      signal: controller.signal,
      headers: { 'user-agent': UA, ...init.headers },
    });
  } finally {
    clearTimeout(timer);
  }
}

export interface SafeFetchResult {
  response: Response;
  /** Where the chain actually ended, after following redirects. */
  finalUrl: string;
}

/**
 * Fetch with the guard applied to every hop.
 *
 * `redirect: 'follow'` would check the first URL and then let the remote host
 * choose the rest, which defeats the point of checking at all. Following the
 * chain by hand means a public URL that 302s to a private one is refused at the
 * hop where it turns private.
 *
 * A TOCTOU window remains: we resolve the name, then `fetch` resolves it again,
 * and a hostile DNS server is free to answer differently the second time.
 * Closing that needs connecting to a pinned address, which is more machinery
 * than a localhost-bound single-user app warrants.
 */
export async function safeFetch(
  target: URL | string,
  init: RequestInit = {},
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<SafeFetchResult> {
  let url = assertFetchableUrl(target.toString());

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertPublicHost(url);
    const response = await fetchOnce(url, init, timeoutMs);

    if (!isRedirect(response.status)) {
      return { response, finalUrl: url.toString() };
    }

    const location = response.headers.get('location');
    // A redirect with nowhere to go is just an odd response; hand it back
    // rather than inventing an error.
    if (!location) return { response, finalUrl: url.toString() };

    // Free the socket before moving on; nothing reads a redirect's body.
    await response.body?.cancel().catch(() => undefined);
    url = assertFetchableUrl(new URL(location, url).toString());
  }

  throw new Error('too many redirects');
}

/** Back-compatible wrapper for callers that only want the response. */
export async function fetchWithTimeout(
  url: URL | string,
  init: RequestInit = {},
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<Response> {
  return (await safeFetch(url, init, timeoutMs)).response;
}

/**
 * Follow a URL and report where it actually lands.
 *
 * Gemini returns citations as `vertexaisearch.cloud.google.com/...redirect/`
 * tokens rather than real addresses. Those work today but are opaque to a human
 * and there's no reason to expect the tokens to outlive the session, so
 * resolved URLs are what gets stored on the item. Failure is not an error --
 * the redirect is kept as-is.
 */
export async function resolveRedirect(url: string): Promise<string> {
  try {
    const { response, finalUrl } = await safeFetch(url, { method: 'GET' }, 8000);
    await response.body?.cancel().catch(() => undefined);
    return finalUrl || url;
  } catch {
    return url;
  }
}

export async function resolveAll(urls: string[], limit = 6): Promise<string[]> {
  const unique = [...new Set(urls)].slice(0, limit);
  return Promise.all(unique.map(resolveRedirect));
}

export interface PageMeta {
  title?: string;
  imageUrl?: string;
  siteName?: string;
}

/** Grab a few `<meta>` values without pulling in a DOM parser. */
function metaContent(html: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeEntities(match[1].trim());
  }
  return undefined;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/**
 * Read Open Graph tags off a product page.
 *
 * The dimensions still come from the model -- this exists only to get a
 * trustworthy product photo and title. Asking a language model for an image URL
 * reliably produces plausible-looking links that 404, whereas og:image is
 * whatever the retailer actually put on the page.
 */
export async function fetchPageMeta(rawUrl: string): Promise<PageMeta> {
  const { response, finalUrl } = await safeFetch(rawUrl, {
    headers: { accept: 'text/html,application/xhtml+xml' },
  });
  if (!response.ok) return {};

  // Relative image paths are relative to where the chain *ended*, not to what
  // the user pasted -- retailers routinely redirect to a canonical host.
  const url = new URL(finalUrl);

  // Product pages are large and everything useful is in <head>; stop early.
  const html = (await response.text()).slice(0, 200_000);

  const imageRaw = metaContent(html, [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
  ]);

  let imageUrl: string | undefined;
  if (imageRaw) {
    try {
      // Retailers sometimes use protocol-relative or root-relative image paths.
      imageUrl = new URL(imageRaw, url).toString();
    } catch {
      imageUrl = undefined;
    }
  }

  return {
    title: metaContent(html, [
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
      /<title[^>]*>([^<]+)<\/title>/i,
    ]),
    siteName: metaContent(html, [
      /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i,
    ]),
    imageUrl,
  };
}
