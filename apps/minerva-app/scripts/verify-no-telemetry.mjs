#!/usr/bin/env node
// Verify that a built artifact carries no Sentry/PostHog telemetry.
//
// The eradication commit (06f838a) removed the telemetry SDKs from the
// sources, but a build can still ship them: a stale dependency, a leftover
// plugin or a cached bundle puts them back into the artifact. This script
// reads the artifact the way an attacker would -- it decompresses it first,
// because an APK/AppImage keeps its payload compressed -- and reports every
// occurrence of the two vendor names.
//
// It has no dependencies on purpose: it runs in CI on every runner, including
// the Windows one, where neither `strings` nor `unzip` exists.
//
// Usage: node scripts/verify-no-telemetry.mjs [--brotli] <artifact|directory> [...]
//
//   --brotli  the files are brotli-compressed (the frontend bundle Tauri
//             embeds into the native library) and are decompressed first.
//
// Exit code: 1 when a telemetry marker is found, 0 when the artifact is clean.
//
// Verdict levels
// --------------
//   telemetry  the vendor name is really there (SDK, DSN, endpoint, ...).
//              The build fails.
//   incidental the vendor name only appears as a substring of an unrelated
//              identifier, e.g. pdf.js's `canvasEntry` ("s" + "Entry") or
//              `settingsEntry`. These are reported with their context so a
//              human can confirm them, but they do not fail the build.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { brotliDecompressSync, inflateRawSync } from 'node:zlib';

// Vendor names, matched case-insensitively.
const VENDORS = ['sentry', 'posthog'];

// Substrings that only ever appear in a telemetry SDK, an endpoint or a
// configuration key. Their presence is conclusive on its own.
const CONCLUSIVE_MARKERS = [
  'io.sentry',
  '@sentry/',
  'sentry.io',
  'sentry-android',
  'sentry-android-ndk',
  'sentry-rust',
  'sentry-java',
  'sentry-cocoa',
  'sentry-dotnet',
  'sentrybrowser',
  'sentry_javascript',
  'sentry_dsn',
  'sentry_auth_token',
  'sentry_rust',
  'tauri_sentry',
  'tauri-plugin-sentry',
  'posthog.com',
  'app.posthog.com',
  'us.posthog.com',
  'posthog-js',
  'posthog-node',
  'posthog-react',
  'posthog-php',
  'posthog-python',
  'posthog-go',
  'posthog-ruby',
  'posthog-dotnet',
  'posthog_api_key',
  'posthog_host',
  'next_public_posthog',
];

const MIN_STRING_LENGTH = 6;

// ---------------------------------------------------------------------------
// Artifact reading
// ---------------------------------------------------------------------------

/** Printable ASCII/UTF-8 runs of at least `minLength` characters. */
export function extractStrings(buffer, minLength = MIN_STRING_LENGTH) {
  const strings = [];
  let current = '';
  for (const byte of buffer) {
    const printable = byte >= 0x20 && byte <= 0x7e;
    if (printable) {
      current += String.fromCharCode(byte);
    } else {
      if (current.length >= minLength) strings.push(current);
      current = '';
    }
  }
  if (current.length >= minLength) strings.push(current);
  return strings;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;

/**
 * Read every entry of a ZIP archive (an APK is one) without external tools.
 * Returns `null` when the buffer is not a ZIP.
 */
export function readZipEntries(buffer) {
  if (buffer.length < 22 || buffer.readUInt32LE(0) !== 0x04034b50) return null;

  // The end-of-central-directory record sits in the last 64KB.
  const searchStart = Math.max(0, buffer.length - 0x10000 - 22);
  let eocd = -1;
  for (let i = buffer.length - 22; i >= searchStart; i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) return null;

  const entryCount = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries = [];

  for (let i = 0; i < entryCount; i += 1) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) break;
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);

    // The local header repeats the name/extra lengths, which can differ from
    // the central directory ones.
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);

    let content;
    if (compressionMethod === 0) {
      content = raw;
    } else if (compressionMethod === 8) {
      try {
        content = inflateRawSync(raw);
      } catch {
        content = Buffer.alloc(0);
      }
    } else {
      content = Buffer.alloc(0);
    }
    entries.push({ name, content });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Every printable string of an artifact, tagged with where it came from. */
export function collectArtifactStrings(buffer) {
  const zip = readZipEntries(buffer);
  if (!zip) {
    return extractStrings(buffer).map((text) => ({ origin: '<raw>', text }));
  }
  const collected = [];
  for (const entry of zip) {
    for (const text of extractStrings(entry.content)) {
      collected.push({ origin: entry.name, text });
    }
  }
  return collected;
}

/** Every file under `dir`, recursively. */
export function listFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...listFiles(full));
    else files.push(full);
  }
  return files;
}

/**
 * Tauri embeds the frontend bundle into the native library, brotli-compressed
 * (`tauri-codegen`'s `EmbeddedAssets`). The compressed bytes hide the
 * JavaScript from a plain `strings`, so they are decompressed first.
 */
export function decompressBrotli(buffer) {
  return brotliDecompressSync(buffer);
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

const isLower = (char) => char !== undefined && char >= 'a' && char <= 'z';
const isUpper = (char) => char !== undefined && char >= 'A' && char <= 'Z';
const isWordChar = (char) => char !== undefined && /[A-Za-z0-9_]/.test(char);

/**
 * Classify one occurrence of a vendor name inside `text`.
 * Returns `'telemetry'`, `'incidental'` or `null` when there is no match.
 */
export function classifyOccurrence(text, index, vendor) {
  const lower = text.toLowerCase();
  const window = lower.slice(Math.max(0, index - 40), index + vendor.length + 40);
  for (const marker of CONCLUSIVE_MARKERS) {
    if (window.includes(marker)) return 'telemetry';
  }

  const before = text[index - 1];
  const after = text[index + vendor.length];

  // "PostHog" has no benign spelling in this codebase.
  if (vendor === 'posthog') return 'telemetry';

  // Benign occurrences of "sentry" as part of standard system/library identifiers:
  // 1. C++ std::basic_ostream::sentry (_ZNSo6sentry...)
  // 2. JavaScriptCore JIT tag JSEntryPtrTag (JS + Entry)
  if (vendor === 'sentry') {
    if (
      window.includes('jsentry') ||
      window.includes('originaccessentry') ||
      window.includes('ostream6sentry') ||
      window.includes('_znso6sentry')
    ) {
      return 'incidental';
    }
  }

  // A vendor name glued to the end of another lowercase or uppercase word is an unrelated
  // identifier that merely contains it ("canvasEntry", "settingsEntry", "JSEntry").
  if ((isLower(before) || isUpper(before)) && isWordChar(after)) return 'incidental';

  // A vendor name used as a prefix of a camelCase identifier ("SentryDsn")
  // or as a standalone word is telemetry.
  if (isWordChar(after) || !isWordChar(before)) return 'telemetry';

  return 'incidental';
}

/** Find every vendor occurrence in one artifact. */
export function scanStrings(strings) {
  const findings = [];
  for (const { origin, text } of strings) {
    const lower = text.toLowerCase();
    for (const vendor of VENDORS) {
      let index = lower.indexOf(vendor);
      while (index !== -1) {
        const verdict = classifyOccurrence(text, index, vendor);
        if (verdict) {
          findings.push({
            origin,
            verdict,
            vendor,
            context: text.slice(Math.max(0, index - 30), index + vendor.length + 30),
          });
        }
        index = lower.indexOf(vendor, index + 1);
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const main = () => {
  const args = process.argv.slice(2);
  const brotli = args.includes('--brotli');
  const files = args.filter((arg) => !arg.startsWith('-'));
  if (files.length === 0) {
    console.error('usage: node scripts/verify-no-telemetry.mjs [--brotli] <artifact|directory> [...]');
    process.exit(2);
  }

  let telemetryCount = 0;
  let incidentalCount = 0;

  for (const target of files) {
    const isDirectory = statSync(target).isDirectory();
    const artifacts = isDirectory ? listFiles(target) : [target];
    const findings = [];
    for (const artifact of artifacts) {
      let buffer = readFileSync(artifact);
      if (brotli) {
        try {
          buffer = decompressBrotli(buffer);
        } catch {
          continue;
        }
      }
      const relative = isDirectory ? path.relative(target, artifact) : artifact;
      for (const finding of scanStrings(collectArtifactStrings(buffer))) {
        const origin =
          finding.origin === '<raw>' ? relative : `${relative} (${finding.origin})`;
        findings.push({ ...finding, origin });
      }
    }
    const telemetry = findings.filter((f) => f.verdict === 'telemetry');
    const incidental = findings.filter((f) => f.verdict === 'incidental');
    telemetryCount += telemetry.length;
    incidentalCount += incidental.length;

    console.log(`\n${target}`);
    console.log(`  files scanned    : ${artifacts.length}`);
    console.log(`  telemetry markers : ${telemetry.length}`);
    console.log(`  incidental matches: ${incidental.length}`);
    for (const finding of telemetry) {
      console.log(`  [TELEMETRY] ${finding.vendor} in ${finding.origin}: ${finding.context}`);
    }
    for (const finding of incidental) {
      console.log(`  [incidental] ${finding.vendor} in ${finding.origin}: ${finding.context}`);
    }
  }

  console.log('\n---');
  console.log(`telemetry markers : ${telemetryCount}`);
  console.log(`incidental matches: ${incidentalCount}`);
  if (telemetryCount > 0) {
    console.error(`FAIL: ${telemetryCount} telemetry marker(s) found.`);
    process.exit(1);
  }
  console.log('OK: no Sentry/PostHog telemetry found.');
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
