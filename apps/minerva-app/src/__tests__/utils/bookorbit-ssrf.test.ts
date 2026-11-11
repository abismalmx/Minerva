import { describe, expect, it, vi } from 'vitest';
import handler, { isValidBookOrbitEndpoint } from '@/pages/api/bookorbit';
import { isLanAddress } from '@/utils/network';

const { publicFetchMock } = vi.hoisted(() => ({ publicFetchMock: vi.fn() }));
vi.mock('@/utils/publicFetch', () => ({ publicFetch: publicFetchMock }));

/**
 * The BookOrbit proxy shares the kosync proxy's SSRF posture: private/internal
 * server addresses are rejected via isLanAddress (covered in kosync-ssrf.test.ts)
 * and the endpoint list is anchored so no other server path is reachable.
 */
describe('bookorbit proxy endpoint whitelist', () => {
  it('accepts exactly the plugin API endpoints', () => {
    for (const endpoint of [
      '/users/auth',
      '/plugin/version',
      '/plugin/match-check',
      '/plugin/annotations/exchange',
      '/plugin/annotations/exchange-ack',
      '/plugin/bookmarks/exchange',
      '/plugin/bookmarks/exchange-ack',
      '/plugin/page-stats',
      '/plugin/book-states',
    ]) {
      expect(isValidBookOrbitEndpoint(endpoint)).toBe(true);
    }
  });

  it('rejects traversal, registration, and unanchored variants', () => {
    for (const endpoint of [
      '/users/create',
      '/plugin/version/../../../admin',
      '/plugin/versionx',
      'plugin/version',
      '/plugin/package',
      '/plugin/catalog/root',
      '/syncs/progress',
      '',
    ]) {
      expect(isValidBookOrbitEndpoint(endpoint)).toBe(false);
    }
  });
});

describe('bookorbit proxy SSRF address checks', () => {
  it('still classifies private/internal addresses as LAN (rejected by the handler)', () => {
    expect(isLanAddress('http://169.254.169.254')).toBe(true);
    expect(isLanAddress('http://[::1]:3000')).toBe(true);
    expect(isLanAddress('http://10.0.0.5')).toBe(true);
    expect(isLanAddress('https://books.example.com')).toBe(false);
  });
});

type FakeRes = {
  statusCode: number;
  body: unknown;
  status: (code: number) => FakeRes;
  json: (data: unknown) => FakeRes;
  send: (data: unknown) => FakeRes;
  setHeader: () => void;
  getHeader: () => undefined;
  end: () => void;
};

const makeRes = (): FakeRes => {
  const res: FakeRes = {
    statusCode: 0,
    body: undefined,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(data: unknown) {
      res.body = data;
      return res;
    },
    send(data: unknown) {
      res.body = data;
      return res;
    },
    setHeader: () => undefined,
    getHeader: () => undefined,
    end: () => undefined,
  };
  return res;
};

const makeReq = (body: Record<string, unknown>) => ({
  method: 'POST',
  headers: {},
  body,
});

describe('bookorbit proxy handler', () => {
  it('rejects private server addresses with 400 before any fetch', async () => {
    publicFetchMock.mockReset();
    const res = makeRes();
    await handler(
      makeReq({
        serverUrl: 'http://169.254.169.254',
        endpoint: '/plugin/version',
        method: 'GET',
      }) as never,
      res as never,
    );
    expect(res.statusCode).toBe(400);
    expect(publicFetchMock).not.toHaveBeenCalled();
  });

  // publicFetch checks the address of every connection, so a public name that
  // resolves to an internal address (DNS rebinding) is refused too.
  it('forwards allowed requests through the address-checked fetch', async () => {
    publicFetchMock.mockReset();
    publicFetchMock.mockResolvedValue({ status: 200, text: async () => '{"ok":true}' });
    const res = makeRes();
    await handler(
      makeReq({
        serverUrl: 'https://books.example.com',
        endpoint: '/plugin/version',
        method: 'GET',
      }) as never,
      res as never,
    );
    expect(res.statusCode).toBe(200);
    expect(publicFetchMock).toHaveBeenCalledTimes(1);
    const [url] = publicFetchMock.mock.calls[0]! as unknown as [string];
    expect(url).toBe('https://books.example.com/api/v1/koreader/plugin/version');
  });

  it('fails instead of forwarding a redirecting upstream', async () => {
    publicFetchMock.mockReset();
    publicFetchMock.mockResolvedValue({
      status: 302,
      headers: new Headers({ location: 'http://10.0.0.5/admin' }),
      body: null,
      text: async () => 'moved',
    });
    const res = makeRes();
    await handler(
      makeReq({
        serverUrl: 'https://books.example.com',
        endpoint: '/plugin/version',
        method: 'GET',
      }) as never,
      res as never,
    );
    expect(res.statusCode).toBe(500);
    expect(publicFetchMock).toHaveBeenCalledTimes(1);
  });
});
