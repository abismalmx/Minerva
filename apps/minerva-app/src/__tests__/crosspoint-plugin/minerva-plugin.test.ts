import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// The CrossPoint SD plugin in apps/minerva-crosspoint-plugin: plugin.js runs in
// the reader's web settings page, device.json is interpreted by the firmware.
const PLUGIN_DIR = resolve(__dirname, '../../../../minerva-crosspoint-plugin/minerva');
const read = (file: string) => readFileSync(resolve(PLUGIN_DIR, file), 'utf8');
const deviceJson = JSON.parse(read('device.json'));

interface PluginApi {
  name: string;
  dir?: string;
  relay: ReturnType<typeof vi.fn>;
  writeFile: ReturnType<typeof vi.fn>;
  fetchToSd: ReturnType<typeof vi.fn>;
  pluginFile: (file: string) => string;
}

// The firmware fills device.json templates by plain substitution, no escaping.
const fill = (template: string, vars: Record<string, string>) =>
  Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), template);

const decodeBase64Json = (b64: string) =>
  JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))));

const API = 'https://web.minerva.invalid/api/crosspoint';
const TOKEN_FILE = deviceJson.token.file;
const ACCOUNT_FILE = '/.crosspoint/minerva-account.json';
const EMAIL = 'reader@example.com';
const CODE = {
  device_code: 'dc',
  user_code: 'BCDF-GHJK',
  verification_uri: 'https://web.minerva.invalid/link',
  verification_uri_complete: 'https://web.minerva.invalid/link?code=BCDF-GHJK',
  expires_in: 600,
  interval: 0.001,
};
const KEY = { access_token: 'device-key', token_type: 'bearer', id: 'new-key-id', username: EMAIL };

// Minerva releases, as the release job publishes them: latest.json names the
// version and each release carries the plugin zip, which holds the minerva/
// folder that goes on the SD card.
const RELEASES = 'https://download.minerva.invalid/releases';
const ZIP_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
const RELEASE_ZIP: Record<string, string | null> = {
  'minerva/': null,
  'minerva/manifest.json': '{"title":"Minerva","version":"0.12.11"}',
  'minerva/plugin.js': 'CrossPoint.registerPlugin(() => {});',
  'minerva/device.json': '{"title":"Minerva"}',
  'minerva/README.md': '# Minerva plugin for CrossPoint',
};
// The JSZip the device web server ships, as far as the update uses it.
const fakeJsZip = {
  loadAsync: vi.fn(async (_data: ArrayBuffer) => ({
    files: Object.fromEntries(
      Object.entries(RELEASE_ZIP).map(([name, content]) => [
        name,
        { name, dir: content === null, async: async () => btoa(content ?? '') },
      ]),
    ),
  })),
};

let container: HTMLElement;
let api: PluginApi;
// The reader's web API: GET /api/settings reports these, POST /api/settings is recorded.
let deviceSettings: Record<string, unknown>;
let settingsPosts: Record<string, unknown>[];
let settingsPostStatus: number;
// Relayed requests, file writes and settings posts, in order.
let log: string[];
// The version in the installed plugin's manifest.json.
let installedVersion: string;

const mount = async (account: unknown = null) => {
  const sink = log;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/plugin?name=minerva&file=manifest.json') {
        return new Response(JSON.stringify({ title: 'Minerva', version: installedVersion }));
      }
      if (url.startsWith('/download') && url.endsWith(encodeURIComponent('/update.zip'))) {
        return new Response(ZIP_BYTES);
      }
      if (url === '/delete' && init?.method === 'POST') {
        sink.push(`delete ${new URLSearchParams(String(init.body)).get('path')}`);
        return new Response('Deleted');
      }
      if (url.startsWith('/download')) {
        return account ? new Response(JSON.stringify(account)) : new Response('', { status: 404 });
      }
      if (url === '/api/settings' && init?.method === 'POST') {
        sink.push('settings');
        settingsPosts.push(JSON.parse(String(init.body)));
        return new Response('Applied', { status: settingsPostStatus });
      }
      if (url === '/api/settings') {
        const items = Object.entries(deviceSettings).map(([key, value]) => ({ key, value }));
        return new Response(JSON.stringify(items));
      }
      return new Response('', { status: 404 });
    }),
  );
  let render: (c: HTMLElement, a: PluginApi) => Promise<void> = async () => {};
  vi.stubGlobal('CrossPoint', {
    registerPlugin: (fn: typeof render) => {
      render = fn;
    },
  });
  new Function(read('plugin.js'))();
  await render(container, api);
};

const field = (name: string) => container.querySelector(`[name="${name}"]`) as HTMLInputElement;
const shown = (el: Element | null) => (el as HTMLElement | null)?.style.display !== 'none';
const statusText = () => container.querySelector('[data-status]')?.textContent ?? '';
const relayCalls = (method: string, path = '') =>
  api.relay.mock.calls.filter(([m, url]) => m === method && String(url).startsWith(API + path));
// The last content written to each file.
const files = () =>
  Object.fromEntries(
    api.writeFile.mock.calls.map(([path, b64]) => [
      path as string,
      decodeBase64Json(b64 as string),
    ]),
  );

const json = (status: number, body: unknown) => ({
  status,
  body: JSON.stringify(body),
  headers: [],
});

const PENDING = json(400, { error: 'authorization_pending' });

// Answers relayed requests the way Minerva does. By default the code is
// approved on the second poll and revocations succeed.
const minerva = ({
  token = (poll: number) => (poll ? json(200, KEY) : PENDING),
  revokeStatus = 200,
}: {
  token?: (poll: number) => unknown;
  revokeStatus?: number;
} = {}) => {
  // Logs into this test's array even if a request outlives the test.
  const sink = log;
  let polls = 0;
  api.relay.mockImplementation(async (method: string, url: string) => {
    sink.push(`${method} ${url.replace(API, '')}`);
    if (url === `${API}/device/code`) return json(200, CODE);
    if (url === `${API}/device/token`) return token(polls++);
    if (method === 'DELETE') return json(revokeStatus, { revoked: revokeStatus === 200 });
    return json(404, {});
  });
};

// Clicking Sign in disables it until the whole sign-in has finished.
const signIn = async (done = `Signed in as ${EMAIL}.`) => {
  field('signin').click();
  expect(field('signin').disabled).toBe(true);
  await vi.waitFor(() => expect(field('signin').disabled).toBe(false));
  expect(statusText()).toBe(done);
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  const sink: string[] = (log = []);
  api = {
    name: 'minerva',
    relay: vi.fn(),
    writeFile: vi.fn(async (path: string) => {
      sink.push(`write ${path}`);
      return {};
    }),
    fetchToSd: vi.fn(async (url: string, dest: string) => {
      sink.push(`fetch ${url} -> ${dest}`);
      return { status: 200, bytes: ZIP_BYTES.length, complete: true };
    }),
    pluginFile: (file: string) => `/plugin?name=minerva&file=${file}`,
  };
  installedVersion = '0.12.10';
  vi.stubGlobal('JSZip', fakeJsZip);
  deviceSettings = {};
  settingsPosts = [];
  settingsPostStatus = 200;
});

afterEach(() => {
  container.remove();
  vi.unstubAllGlobals();
});

describe('Minerva CrossPoint plugin', () => {
  it('signs in with a code approved on the Minerva web app and stores only the reader’s key', async () => {
    let approved = false;
    minerva({ token: () => (approved ? json(200, KEY) : PENDING) });
    await mount();
    expect(statusText()).toBe('Not signed in.');
    field('signin').click();

    await vi.waitFor(() => expect(statusText()).toBe('Waiting for approval…'));
    const link = container.querySelector('[data-link]') as HTMLAnchorElement;
    expect(link.href).toBe(CODE.verification_uri_complete);
    expect(link.textContent).toBe(CODE.verification_uri);
    expect(container.querySelector('[data-user-code]')?.textContent).toBe('BCDF-GHJK');

    approved = true;
    await vi.waitFor(() => expect(statusText()).toBe(`Signed in as ${EMAIL}.`));
    expect((container.querySelector('[data-code]') as HTMLElement).hidden).toBe(true);
    expect(api.relay).toHaveBeenCalledWith(
      'POST',
      `${API}/device/token`,
      { 'Content-Type': 'application/json' },
      JSON.stringify({ device_code: 'dc' }),
    );
    // Nothing account-level reaches the card: only the key and who it belongs to.
    expect(files()).toEqual({
      [TOKEN_FILE]: { access_token: 'device-key' },
      [ACCOUNT_FILE]: { username: EMAIL, keyId: 'new-key-id', revoke: [] },
    });
  });

  it('does not touch the reader’s KOReader Sync when signing in', async () => {
    minerva();
    deviceSettings = { koServerUrl: 'https://sync.koreader.rocks', koUsername: 'me' };
    await mount();
    await signIn();
    expect(settingsPosts).toEqual([]);
    expect(files()[TOKEN_FILE]).toEqual({ access_token: 'device-key' });
  });

  it('turns off a progress sync an earlier version pointed at Minerva', async () => {
    minerva();
    deviceSettings = { koServerUrl: API, koUsername: EMAIL };
    await mount({ username: EMAIL, keyId: 'old-key-id' });
    await signIn();
    expect(settingsPosts).toEqual([{ koServerUrl: '', koUsername: '', koPassword: '' }]);
  });

  it('revokes the key it replaces only once the new one is in place', async () => {
    minerva();
    await mount({ username: 'old@example.com', keyId: 'old-key-id' });
    await signIn();
    expect(relayCalls('DELETE')).toEqual([['DELETE', `${API}/keys/old-key-id`, {}, '']]);
    expect(log.indexOf('DELETE /keys/old-key-id')).toBeGreaterThan(log.indexOf('settings'));
  });

  it('keeps keys it could not revoke and retries them at sign-out', async () => {
    minerva({ revokeStatus: 500 });
    await mount({ username: EMAIL, keyId: 'old-key-id' });
    await signIn();
    expect(files()[ACCOUNT_FILE]).toEqual({
      username: EMAIL,
      keyId: 'new-key-id',
      revoke: ['old-key-id'],
    });

    minerva();
    field('signout').click();
    await vi.waitFor(() => expect(statusText()).toBe('Signed out.'));
    expect(relayCalls('DELETE').slice(1)).toEqual([
      ['DELETE', `${API}/keys/old-key-id`, {}, ''],
      ['DELETE', `${API}/keys/new-key-id`, {}, ''],
    ]);
    expect(files()[ACCOUNT_FILE]).toEqual({});
  });

  it('records a new key before handing it out, so a failed setup leaves it revocable', async () => {
    minerva();
    // A reader an earlier version pointed at Minerva: signing in must clear that.
    deviceSettings = { koServerUrl: API, koUsername: EMAIL };
    settingsPostStatus = 500;
    await mount({ username: EMAIL, keyId: 'old-key-id' });
    await signIn('Sign-in failed: could not update KOReader Sync settings (HTTP 500)');
    expect(log.indexOf(`write ${ACCOUNT_FILE}`)).toBeLessThan(log.indexOf(`write ${TOKEN_FILE}`));
    expect(files()[ACCOUNT_FILE]).toEqual({ revoke: ['old-key-id', 'new-key-id'] });
    // Neither key is revoked yet: the reader may still be using either.
    expect(relayCalls('DELETE')).toEqual([]);
  });

  it('stores nothing when the code expires before it is approved', async () => {
    minerva({ token: () => json(400, { error: 'expired_token' }) });
    await mount();
    await signIn('Sign-in failed: the code expired');
    expect(api.writeFile).not.toHaveBeenCalled();
    expect(settingsPosts).toEqual([]);
    expect(field('signin').disabled).toBe(false);
  });

  it('reports an unreachable Minerva', async () => {
    api.relay.mockResolvedValue({ status: 502, body: 'relay failed', headers: [] });
    await mount();
    await signIn('Sign-in failed: Minerva is unreachable (HTTP 502)');
    expect(api.writeFile).not.toHaveBeenCalled();
  });

  it('ignores a second click while a sign-in is running', async () => {
    minerva({ token: () => PENDING });
    await mount();
    field('signin').click();
    field('signin').click();
    await vi.waitFor(() => expect(statusText()).toBe('Waiting for approval…'));
    expect(field('signin').disabled).toBe(true);
    expect(relayCalls('POST', '/device/code')).toHaveLength(1);
    field('signout').click(); // stop polling
  });

  it('stops waiting for approval when the user signs out', async () => {
    minerva({ token: () => PENDING });
    await mount();
    field('signin').click();
    await vi.waitFor(() => expect(relayCalls('POST', '/device/token').length).toBeGreaterThan(0));

    field('signout').click();
    await vi.waitFor(() => expect(statusText()).toBe('Signed out.'));
    await vi.waitFor(() => expect(field('signin').disabled).toBe(false));
    const polls = relayCalls('POST', '/device/token').length;
    await new Promise((r) => setTimeout(r, 20));
    expect(relayCalls('POST', '/device/token')).toHaveLength(polls);
    expect(files()[TOKEN_FILE]).toEqual({});
  });

  it('revokes a key approved after the user signed out', async () => {
    let approve: (v: unknown) => void = () => {};
    // The approval lands while the poll is in flight.
    minerva({ token: () => new Promise((r) => (approve = r)) });
    await mount();
    field('signin').click();
    await vi.waitFor(() => expect(relayCalls('POST', '/device/token')).toHaveLength(1));
    field('signout').click();
    approve(json(200, KEY));

    await vi.waitFor(() =>
      expect(relayCalls('DELETE')).toEqual([['DELETE', `${API}/keys/new-key-id`, {}, '']]),
    );
    expect(statusText()).toBe('Signed out.');
    expect(files()[TOKEN_FILE]).toEqual({});
  });

  it('signs out by revoking the key first, then clearing the card and Minerva’s sync settings', async () => {
    minerva();
    deviceSettings = { koServerUrl: API };
    await mount({ username: EMAIL, keyId: 'key-id' });
    expect(statusText()).toBe(`Signed in as ${EMAIL}.`);

    field('signout').click();
    await vi.waitFor(() => expect(statusText()).toBe('Signed out.'));
    expect(log).toEqual([
      'DELETE /keys/key-id',
      `write ${ACCOUNT_FILE}`,
      `write ${TOKEN_FILE}`,
      'settings',
    ]);
    expect(settingsPosts).toEqual([{ koServerUrl: '', koUsername: '', koPassword: '' }]);
    expect(files()).toEqual({ [ACCOUNT_FILE]: {}, [TOKEN_FILE]: {} });
  });

  it('leaves a KOReader Sync server the user set up later alone at sign-out', async () => {
    minerva();
    deviceSettings = { koServerUrl: 'https://sync.koreader.rocks' };
    await mount({ username: EMAIL, keyId: 'key-id' });
    field('signout').click();
    await vi.waitFor(() => expect(statusText()).toBe('Signed out.'));
    expect(settingsPosts).toEqual([]);
  });

  // The buttons follow the card's state: Sign in while signed out; Sign out
  // while signed in.
  describe('buttons', () => {
    it('offers Sign in while signed out', async () => {
      minerva();
      await mount();
      expect(shown(field('signin'))).toBe(true);
      expect(shown(field('signout'))).toBe(false);
    });

    it('offers only Sign out while signed in', async () => {
      minerva();
      await mount({ username: EMAIL, keyId: 'key-id' });
      expect(shown(field('signin'))).toBe(false);
      expect(shown(field('signout'))).toBe(true);
    });

    it('switches as the user signs in and out', async () => {
      minerva();
      await mount();
      await signIn();
      expect(shown(field('signin'))).toBe(false);
      expect(shown(field('signout'))).toBe(true);

      field('signout').click();
      await vi.waitFor(() => expect(statusText()).toBe('Signed out.'));
      expect(shown(field('signin'))).toBe(true);
      expect(shown(field('signout'))).toBe(false);
    });

    // The account file is cleared first, so the card is signed out (a reload
    // shows Sign in) even when clearing KOReader Sync afterwards fails.
    it('shows Sign in once the account is cleared, even if later cleanup fails', async () => {
      minerva();
      deviceSettings = { koServerUrl: API };
      settingsPostStatus = 500;
      await mount({ username: EMAIL, keyId: 'key-id' });
      field('signout').click();
      await vi.waitFor(() => expect(statusText()).toMatch(/^Error: /));
      expect(files()[ACCOUNT_FILE]).toEqual({});
      expect(shown(field('signin'))).toBe(true);
      expect(shown(field('signout'))).toBe(false);
    });
  });

  describe('updates', () => {
    const latest = (version: string) =>
      api.relay.mockImplementation(async (method: string, url: string) => {
        log.push(`${method} ${url}`);
        return url === `${RELEASES}/latest.json` ? json(200, { version }) : json(404, {});
      });
    const updateText = () => container.querySelector('[data-update]')?.textContent ?? '';
    const checkForUpdate = async (result: string) => {
      field('check').click();
      await vi.waitFor(() => expect(updateText()).toBe(result));
      expect(field('check').disabled).toBe(false);
    };

    it('shows the installed version and installs a newer Minerva release', async () => {
      latest('0.12.11');
      api.dir = '/plugins/minerva';
      await mount();
      expect(container.querySelector('[data-version]')?.textContent).toBe('0.12.10');
      expect(shown(field('update'))).toBe(false);

      await checkForUpdate('A new version is available: v0.12.11 (current: v0.12.10).');
      expect(shown(field('update'))).toBe(true);

      log.length = 0;
      field('update').click();
      await vi.waitFor(() =>
        expect(updateText()).toBe('Updated to v0.12.11. Reload this page to use it.'),
      );
      expect(log).toEqual([
        `fetch ${RELEASES}/v0.12.11/Minerva-0.12.11.crosspoint-plugin.zip -> /plugins/minerva/update.zip`,
        'write /plugins/minerva/plugin.js',
        'write /plugins/minerva/device.json',
        'write /plugins/minerva/README.md',
        // Last, so an update cut short still reports the old version.
        'write /plugins/minerva/manifest.json',
        'delete /plugins/minerva/update.zip',
      ]);
      expect(fakeJsZip.loadAsync).toHaveBeenCalledWith(ZIP_BYTES.buffer);
      const written = Object.fromEntries(
        api.writeFile.mock.calls.map(([path, b64]) => [path, atob(b64 as string)]),
      );
      expect(written['/plugins/minerva/plugin.js']).toBe(RELEASE_ZIP['minerva/plugin.js']);
      expect(container.querySelector('[data-version]')?.textContent).toBe('0.12.11');
      expect(shown(field('update'))).toBe(false);
    });

    // The release job stamps the real version; the committed one is a
    // placeholder older than any release, so a copy from the repo updates too.
    it('offers a copy from the repo the latest release', async () => {
      latest('0.12.11');
      installedVersion = JSON.parse(read('manifest.json')).version;
      await mount();
      await checkForUpdate(`A new version is available: v0.12.11 (current: v${installedVersion}).`);
      expect(shown(field('update'))).toBe(true);
    });

    it('compares versions by number', async () => {
      latest('0.12.9');
      await mount();
      await checkForUpdate('You are up to date (v0.12.10).');
      expect(shown(field('update'))).toBe(false);
    });

    it('says so when Minerva can’t be reached', async () => {
      api.relay.mockResolvedValue(json(404, {}));
      await mount();
      await checkForUpdate('Failed to check for update. Please try again later.');
      expect(shown(field('update'))).toBe(false);
    });

    // Firmware older than api.dir loads a plugin from /.crosspoint/plugins
    // before the other roots, so an update written there is the one it runs.
    it('keeps the installed plugin when the download fails', async () => {
      latest('0.12.11');
      api.fetchToSd.mockResolvedValue({ error: 'http status', status: 404, bytes: 0 });
      await mount();
      await checkForUpdate('A new version is available: v0.12.11 (current: v0.12.10).');
      field('update').click();
      await vi.waitFor(() => expect(updateText()).toBe('Failed to install update: HTTP 404'));
      expect(api.fetchToSd).toHaveBeenCalledWith(
        `${RELEASES}/v0.12.11/Minerva-0.12.11.crosspoint-plugin.zip`,
        '/.crosspoint/plugins/minerva/update.zip',
        {},
      );
      expect(api.writeFile).not.toHaveBeenCalled();
      expect(shown(field('update'))).toBe(true);
    });
  });

  it('leaves sign-in to the web page, the only one that can set up progress sync', () => {
    // The firmware refuses plugin writes to KOReader Sync settings, so a
    // sign-in on the reader's own screen left progress sync silently off.
    // Without an auth block, Plugins → Minerva tells the user to sign in on
    // the web Settings page instead.
    expect(deviceJson).not.toHaveProperty('auth');
    // The reader reads the key where the web page writes it.
    expect(deviceJson.token).toEqual({ file: TOKEN_FILE, path: 'access_token' });
  });

  it('pages the catalog in steps of the page size the firmware displays', () => {
    // The firmware shows `page_size` rows and drops the lookahead row, so the
    // server must step pages by `page_size`, not by {limit} (page_size + 1).
    const vars = { page: '2', query: 'moby' };
    for (const template of [deviceJson.browse.url, deviceJson.browse.search.url]) {
      const url = new URL(fill(template, vars));
      expect(`${url.origin}${url.pathname}`).toBe(`${API}/books`);
      expect(url.searchParams.get('page')).toBe('2');
      expect(Number(url.searchParams.get('per_page'))).toBe(deviceJson.browse.page_size);
    }
    expect(deviceJson.browse.headers).toEqual({ Authorization: 'Bearer {token}' });
    expect(deviceJson.download.url_path).toBe('downloadUrl');
  });

  it('keeps the key where the device web server will not serve it', () => {
    // GET /download refuses any path whose file name starts with a dot.
    expect(TOKEN_FILE.split('/').pop()).toMatch(/^\./);
  });

  it('reports each reading session to Minerva', () => {
    const handler = deviceJson.events['reader.session'];
    expect(handler.connect).toBe(true);
    expect(handler.request.url).toBe(`${API}/sessions`);
    expect(fill(handler.request.headers.Authorization, { token: 'device-key' })).toBe(
      'Bearer device-key',
    );
    const body = fill(handler.request.body, {
      'event.document': '0123456789abcdef0123456789abcdef',
      'event.start_time': '1790000000',
      'event.duration_seconds': '600',
      'event.start_progress_bp': '5100',
      'event.end_progress_bp': '5230',
    });
    expect(JSON.parse(body)).toEqual({
      document: '0123456789abcdef0123456789abcdef',
      start_time: 1790000000,
      duration: 600,
      start_bp: 5100,
      end_bp: 5230,
    });
  });
});
