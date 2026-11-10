// Strip browser source maps from the Tauri export build.
//
// Runs after `next build` (see the `build` script). `productionBrowserSourceMaps`
// makes Next emit `.js.map` files next to the chunks in `out/_next/static`; this
// script deletes them so the full original sources never ship inside the app
// bundle, and drops the now-dangling `//# sourceMappingURL=` comment from every
// chunk.
//
// Set KEEP_SOURCEMAPS=1 to keep the maps in the bundle instead (see the
// `dev-ios` / `dev-android` / `dev-macos` scripts): local devtools then resolve
// minified frames to real sources.

import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const staticDir = path.join(appDir, 'out', '_next', 'static');

// Drop the `//# sourceMappingURL=` comment Turbopack appends to each chunk.
// Left behind after the maps are deleted, it makes every devtools session fetch
// a missing `.js.map` — the asset protocol answers with HTML, which the webview
// reports as a source map parse error.
export const stripSourceMappingComment = (code) =>
  code.replace(/\n\/\/# sourceMappingURL=[^\n]*/g, '');

// Recursively delete every `*.js.map` under `dir` and drop the now-dangling
// comment from every `*.js`. Turbopack names a map after a different hash than
// the chunk pointing at it, so the comment cannot be matched to a chunk by file
// name — every chunk under `dir` loses its map here, so every chunk is rewritten.
export const stripMaps = (dir) => {
  if (!existsSync(dir)) return 0;
  let removed = 0;
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) removed += stripMaps(full);
    else if (entry.endsWith('.js.map')) {
      rmSync(full);
      removed += 1;
    } else if (entry.endsWith('.js')) {
      const code = readFileSync(full, 'utf8');
      const stripped = stripSourceMappingComment(code);
      if (stripped !== code) writeFileSync(full, stripped);
    }
  }
  return removed;
};

const main = () => {
  if (!existsSync(staticDir)) {
    // Not an export build (e.g. `build-web`); nothing to do.
    return;
  }

  if (process.env['KEEP_SOURCEMAPS'] === '1') {
    console.log('KEEP_SOURCEMAPS=1, keeping the .js.map files in the app bundle.');
    return;
  }

  const removed = stripMaps(staticDir);
  console.log(`Stripped ${removed} .js.map file(s) from the app bundle.`);
};

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();
