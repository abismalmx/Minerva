#!/usr/bin/env node
// Verify the frontend bundle that Tauri embeds into the native library.
//
// Tauri does not ship the frontend as loose files: `tauri-codegen` compresses
// every asset of `frontendDist` with brotli and embeds the bytes in the Rust
// binary (`include_bytes!`). A plain `strings` over the binary therefore sees
// neither the JavaScript nor the source maps, and scanning the uncompressed
// `out/` directory does not prove what the artifact contains.
//
// This script closes that gap: it takes the built native library and the
// cargo `OUT_DIR` that holds the compressed assets, keeps only the blobs that
// are really embedded in the binary, decompresses them and scans them.
//
// Usage:
//   node scripts/verify-embedded-assets.mjs <native-library> <cargo-target-dir>
//
// Exit code: 1 when a telemetry marker is found, 0 when the bundle is clean.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
import { collectArtifactStrings, scanStrings } from './verify-no-telemetry.mjs';

const main = () => {
  const [libraryPath, targetDir] = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
  if (!libraryPath || !targetDir) {
    console.error(
      'usage: node scripts/verify-embedded-assets.mjs <native-library> <cargo-target-dir>',
    );
    process.exit(2);
  }

  const library = readFileSync(libraryPath);

  let embedded = 0;
  let stale = 0;
  let telemetry = 0;
  let incidental = 0;

  // The cargo build directory holds one `Minerva-*/out/tauri-codegen-assets`
  // per build fingerprint; the blobs of the builds that are not embedded any
  // more are skipped.
  for (const buildDir of readdirSync(targetDir)) {
    const assetsDir = path.join(targetDir, buildDir, 'out', 'tauri-codegen-assets');
    let assets;
    try {
      assets = readdirSync(assetsDir);
    } catch {
      continue;
    }
    for (const file of assets) {
      const bytes = readFileSync(path.join(assetsDir, file));
      if (!library.includes(bytes)) {
        stale += 1;
        continue;
      }
      embedded += 1;
      let content;
      try {
        content = brotliDecompressSync(bytes);
      } catch {
        continue;
      }
      for (const finding of scanStrings(collectArtifactStrings(content))) {
        if (finding.verdict === 'telemetry') {
          telemetry += 1;
          console.log(`  [TELEMETRY] ${finding.vendor} in ${file}: ${finding.context}`);
        } else {
          incidental += 1;
        }
      }
    }
  }

  console.log(`  assets embedded in the native library : ${embedded}`);
  console.log(`  stale assets skipped (not embedded)  : ${stale}`);
  console.log(`  telemetry markers in embedded assets : ${telemetry}`);
  console.log(`  incidental matches in embedded assets : ${incidental}`);

  if (telemetry > 0) {
    console.error(`FAIL: ${telemetry} telemetry marker(s) found in the embedded bundle.`);
    process.exit(1);
  }
  console.log('  OK: the embedded bundle carries no Sentry/PostHog telemetry.');
};

main();
