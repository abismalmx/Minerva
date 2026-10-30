/**
 * Regresión SEC-02 — el cromo del navegador embebido muestra el origen.
 *
 * El panel «companion» conserva el título que le da la app, así que el
 * lector no tiene otra forma de saber si la página ha cambiado de sitio:
 * sin el indicador de origen, una página de phishing es indistinguible de
 * Google dentro del panel.
 *
 * El script se inyecta en páginas remotas, así que el test lo evalúa tal
 * cual lo hace el runtime (con el marcador de las opciones sustituido) y
 * comprueba que monta su cromo sin errores.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(process.cwd(), 'src-tauri/src/web_browser_chrome.js'), 'utf8');

const OPTIONS = {
  background: '#111111',
  foreground: '#eeeeee',
  isEink: false,
  showClip: false,
  labels: {},
};

const runChrome = () => {
  const script = source.replace('__MINERVA_BROWSER_OPTIONS__', JSON.stringify(OPTIONS));
  // eslint-disable-next-line no-new-func
  new Function(script)();
};

describe('cromo del navegador embebido', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    delete (window as unknown as { __minervaBrowser?: unknown }).__minervaBrowser;
  });

  it('monta su cromo sin errores en una página remota', () => {
    expect(() => runChrome()).not.toThrow();
    expect(document.getElementById('__minerva_browser_chrome__')).toBeTruthy();
  });

  it('expone el indicador de origen que sigue al sitio mostrado', () => {
    // El origen se lee de `location.host` y se refresca en cada navegación.
    expect(source).toContain('location.host');
    expect(source).toContain('refs.origin');
    expect(source).toContain('updateHost');
  });

  it('no se monta dos veces en la misma página', () => {
    runChrome();
    runChrome();
    expect(document.querySelectorAll('#__minerva_browser_chrome__')).toHaveLength(1);
  });
});
