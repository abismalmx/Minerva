/**
 * PoC-03 — Invariantes de la URL del hand-off a Gemini (I5/I6).
 *
 * El texto seleccionado en el libro es contenido NO confiable (un EPUB
 * manipulado lo controla). Este test comprueba que ese texto no puede:
 *   - cambiar el origen, el esquema, el host, el puerto o la ruta de la URL;
 *   - inyectar parámetros extra, fragmentos o credenciales;
 *   - inyectar saltos de línea (inyección de cabeceras);
 *   - colar la clave de API de Gemini.
 *
 * Es un test de REGRESIÓN: debe seguir en verde después de cualquier cambio
 * en la construcción de la URL.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  addPluginListener: vi.fn(),
}));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ listen: vi.fn() }),
}));

import {
  GEMINI_WEB_URL,
  buildGeminiQuery,
  buildGeminiWebUrl,
  openGeminiInAppBrowser,
} from '@/app/reader/utils/geminiIntent';

const ORIGIN = new URL(GEMINI_WEB_URL).origin;

const HOSTILE = [
  'javascript:alert(document.domain)',
  'data:text/html,<script>alert(1)</script>',
  'https://evil.example.com/steal?x=1',
  '//evil.example.com/steal',
  'https://user:pass@evil.example.com/',
  '#fragment',
  '?a=b&c=d',
  '" \r\nX-Injected: 1',
  '"\n\n',
  '100% legit',
  'ünïcødé — 中文 🎉',
  'a'.repeat(8000),
  '"; window.__TAURI__ && window.__TAURI__.core.invoke("x"); //',
];

describe('la URL del hand-off conserva origen, ruta y un único parámetro', () => {
  test.each(HOSTILE)('origen fijo con texto hostil: %j', (payload) => {
    const query = buildGeminiQuery(payload, 'explain');
    const url = new URL(buildGeminiWebUrl(query));

    expect(url.origin).toBe(ORIGIN);
    expect(url.protocol).toBe('https:');
    expect(url.pathname).toBe('/app');
    expect(url.username).toBe('');
    expect(url.password).toBe('');
    expect(url.port).toBe('');
    expect(url.hash).toBe('');
    expect([...url.searchParams.keys()]).toEqual(['q']);
    // El texto viaja íntegro y sólo dentro del parámetro q (el hand-off
    // recorta los espacios del Selection, como hace el resto de la app).
    expect(url.searchParams.get('q')).toContain(payload.trim());
    // Ni saltos de línea ni otras cabeceras inyectables.
    expect(url.href).not.toMatch(/[\r\n]/);
  });

  test('la clave de API no aparece en ninguna parte de la URL', () => {
    const url = buildGeminiWebUrl(buildGeminiQuery('passage', 'explain'));
    expect(url).not.toMatch(/AIza/);
    expect(url).not.toMatch(/key=/i);
    expect(url).not.toMatch(/token=/i);
  });

  test('el destino por defecto es exactamente gemini.google.com sobre https', () => {
    expect(GEMINI_WEB_URL).toBe('https://gemini.google.com/app');
    expect(new URL(GEMINI_WEB_URL).origin).toBe('https://gemini.google.com');
  });

  test('una selección vacía no genera URL', () => {
    expect(buildGeminiQuery('   ', 'explain')).toBe('');
  });
});

describe('el hand-off in-app entrega la misma URL al navegador embebido', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({});
  });

  test('el origen de la URL que se abre es siempre gemini.google.com', async () => {
    await openGeminiInAppBrowser('un pasaje "con comillas"', 'explain', { isTauri: true });

    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [command, payload] = invokeMock.mock.calls[0] as [
      string,
      { url: string; options: { companion?: { title?: string } } },
    ];
    expect(command).toBe('open_web_browser');
    const url = new URL(payload.url);
    expect(url.origin).toBe(ORIGIN);
    expect(url.pathname).toBe('/app');
    expect([...url.searchParams.keys()]).toEqual(['q']);
  });
});
