import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
  The guard's whole job is to refuse addresses that are not on the public
  internet, so the tests drive it with a stubbed resolver and a stubbed fetch:
  no test should depend on what DNS happens to answer today, and none should
  reach the network at all.
*/
const lookup = vi.hoisted(() => vi.fn());
vi.mock('node:dns/promises', () => ({ lookup }));

const { assertFetchableUrl, assertPublicHost, safeFetch } = await import('./net.js');

/** Answer every resolution with one address. */
function resolvesTo(address: string, family = 4) {
  lookup.mockResolvedValue([{ address, family }]);
}

function redirectTo(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } });
}

const fetchMock = vi.fn();

beforeEach(() => {
  lookup.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  resolvesTo('93.184.216.34');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('assertFetchableUrl', () => {
  it('accepts ordinary http and https URLs', () => {
    expect(assertFetchableUrl('https://example.com/sofa').hostname).toBe('example.com');
    expect(assertFetchableUrl('http://example.com').protocol).toBe('http:');
  });

  it('rejects non-http schemes, including the ones that read local files', () => {
    for (const url of ['file:///etc/passwd', 'ftp://example.com', 'data:text/html,hi']) {
      expect(() => assertFetchableUrl(url)).toThrow(/http and https/);
    }
  });

  it('rejects literal private and loopback hosts', () => {
    for (const host of ['localhost', '127.0.0.1', '10.1.2.3', '192.168.0.5', '169.254.169.254']) {
      expect(() => assertFetchableUrl(`http://${host}/`)).toThrow(/local or private/);
    }
  });

  it('rejects anything that is not a URL at all', () => {
    expect(() => assertFetchableUrl('not a url')).toThrow(/valid URL/);
  });
});

describe('assertPublicHost', () => {
  it('refuses a public name that resolves to a private address', async () => {
    // The attack the hostname check cannot see: the name is fine, the A record
    // is not.
    resolvesTo('169.254.169.254');
    await expect(assertPublicHost(new URL('https://metadata.example.com'))).rejects.toThrow(
      /local or private/,
    );
  });

  it('refuses IPv6 loopback, unique-local, and IPv4-mapped private addresses', async () => {
    for (const address of ['::1', 'fd00::1', '::ffff:10.0.0.1']) {
      resolvesTo(address, 6);
      await expect(assertPublicHost(new URL('https://example.com'))).rejects.toThrow(
        /local or private/,
      );
    }
  });

  it('refuses a host where only one of several addresses is private', async () => {
    lookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);
    await expect(assertPublicHost(new URL('https://example.com'))).rejects.toThrow(
      /local or private/,
    );
  });

  it('allows a public address', async () => {
    resolvesTo('93.184.216.34');
    await expect(assertPublicHost(new URL('https://example.com'))).resolves.toBeUndefined();
  });

  it('refuses a host that will not resolve', async () => {
    lookup.mockRejectedValue(new Error('ENOTFOUND'));
    await expect(assertPublicHost(new URL('https://nope.example'))).rejects.toThrow(/resolve/);
  });
});

describe('safeFetch', () => {
  it('follows a redirect between public hosts and reports where it landed', async () => {
    fetchMock
      .mockResolvedValueOnce(redirectTo('https://www.example.com/final'))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const { response, finalUrl } = await safeFetch('https://example.com/start');

    expect(response.status).toBe(200);
    expect(finalUrl).toBe('https://www.example.com/final');
  });

  it('refuses a public URL that redirects to a private one', async () => {
    fetchMock.mockResolvedValueOnce(redirectTo('http://169.254.169.254/latest/meta-data/'));

    await expect(safeFetch('https://example.com/start')).rejects.toThrow(/local or private/);
    // The second hop must never be attempted.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refuses a redirect to a public name that resolves privately', async () => {
    fetchMock.mockResolvedValueOnce(redirectTo('https://metadata.example.com/'));
    lookup
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
      .mockResolvedValueOnce([{ address: '169.254.169.254', family: 4 }]);

    await expect(safeFetch('https://example.com/start')).rejects.toThrow(/local or private/);
  });

  it('resolves a relative Location against the current hop', async () => {
    fetchMock
      .mockResolvedValueOnce(redirectTo('/moved'))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const { finalUrl } = await safeFetch('https://example.com/start');
    expect(finalUrl).toBe('https://example.com/moved');
  });

  it('gives up on a redirect loop instead of following it forever', async () => {
    fetchMock.mockResolvedValue(redirectTo('https://example.com/loop'));
    await expect(safeFetch('https://example.com/loop')).rejects.toThrow(/too many redirects/);
  });

  it('never asks fetch to follow redirects itself', async () => {
    fetchMock.mockResolvedValueOnce(new Response('ok', { status: 200 }));
    await safeFetch('https://example.com/');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' });
  });
});
