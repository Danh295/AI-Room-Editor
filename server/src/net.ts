/**
 * Outbound HTTP helpers.
 *
 * Every URL this server fetches originates from either model output or user
 * paste, so none of it is trusted. The guard lives here rather than in each
 * route so there's one definition to keep correct.
 */

const FETCH_TIMEOUT_MS = 15_000;

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

export async function fetchWithTimeout(
  url: URL | string,
  init: RequestInit = {},
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      redirect: 'follow',
      ...init,
      signal: controller.signal,
      headers: { 'user-agent': UA, ...init.headers },
    });
  } finally {
    clearTimeout(timer);
  }
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
    assertFetchableUrl(url);
    const response = await fetchWithTimeout(url, { method: 'GET' }, 8000);
    return response.url || url;
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
  const url = assertFetchableUrl(rawUrl);
  const response = await fetchWithTimeout(url, {
    headers: { accept: 'text/html,application/xhtml+xml' },
  });
  if (!response.ok) return {};

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
