import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
// Import the real exported helpers from the .mjs build script (vitest/vite can
// import ESM .mjs directly), so the test exercises the actual logic.
import {
  classifyOccurrence as classifyOccurrenceUntyped,
  collectArtifactStrings as collectArtifactStringsUntyped,
  scanStrings as scanStringsUntyped,
} from '../../../scripts/verify-no-telemetry.mjs';

const classifyOccurrence = classifyOccurrenceUntyped as (
  text: string,
  index: number,
  vendor: string,
) => 'telemetry' | 'incidental' | null;
const collectArtifactStrings = collectArtifactStringsUntyped as (
  buffer: Buffer,
) => { origin: string; text: string }[];
const scanStrings = scanStringsUntyped as (
  strings: { origin: string; text: string }[],
) => { origin: string; verdict: string; vendor: string; context: string }[];

/** A ZIP with a single STORED entry, built by hand so no zip library is needed. */
const buildStoredZip = (name: string, content: Buffer): Buffer => {
  const nameBuffer = Buffer.from(name);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 8);
  local.writeUInt32LE(content.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(nameBuffer.length, 26);
  const localPart = Buffer.concat([local, nameBuffer, content]);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(content.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(nameBuffer.length, 28);
  central.writeUInt32LE(0, 42);
  const centralPart = Buffer.concat([central, nameBuffer]);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralPart.length, 12);
  eocd.writeUInt32LE(localPart.length, 16);

  return Buffer.concat([localPart, centralPart, eocd]);
};

describe('classifyOccurrence', () => {
  it('flags a telemetry endpoint', () => {
    expect(classifyOccurrence('https://o123.ingest.sentry.io/api/1/envelope/', 21, 'sentry')).toBe(
      'telemetry',
    );
  });

  it('flags the android SDK package', () => {
    expect(classifyOccurrence('io.sentry.dsn', 3, 'sentry')).toBe('telemetry');
  });

  it('flags a camelCase SDK identifier', () => {
    expect(classifyOccurrence('SentryInitProvider', 0, 'sentry')).toBe('telemetry');
  });

  it('flags a standalone vendor name', () => {
    expect(classifyOccurrence('enabled Sentry reporting', 8, 'sentry')).toBe('telemetry');
  });

  it('flags posthog in any spelling', () => {
    expect(classifyOccurrence('PostHog was removed', 0, 'posthog')).toBe('telemetry');
    expect(classifyOccurrence('canvasPostHogEntry', 6, 'posthog')).toBe('telemetry');
  });

  it('does not flag an identifier that merely ends in Entry', () => {
    // pdf.js property names: "s" + "Entry".
    expect(classifyOccurrence('this.transparentCanvasEntry', 21, 'sentry')).toBe('incidental');
    expect(classifyOccurrence('settingsEntry', 7, 'sentry')).toBe('incidental');
    expect(classifyOccurrence('hasXfaDatasetsEntry', 13, 'sentry')).toBe('incidental');
  });
});

describe('scanStrings', () => {
  it('separates telemetry from incidental matches', () => {
    const findings = scanStrings([
      { origin: 'assets/index.js', text: 'const canvasEntry = 1;' },
      { origin: 'assets/index.js', text: 'Sentry.init({ dsn: "https://x@y/1" });' },
    ]);
    expect(findings.filter((f) => f.verdict === 'telemetry')).toHaveLength(1);
    expect(findings.filter((f) => f.verdict === 'incidental')).toHaveLength(1);
    expect(findings.find((f) => f.verdict === 'telemetry')?.origin).toBe('assets/index.js');
  });
});

describe('collectArtifactStrings', () => {
  it('decompresses a zip payload instead of scanning the compressed bytes', () => {
    const content = Buffer.from('const canvasEntry = 1;');
    const zip = buildStoredZip('assets/index.js', content);
    const collected = collectArtifactStrings(zip);
    expect(collected.some((entry) => entry.text.includes('canvasEntry'))).toBe(true);
    expect(collected.some((entry) => entry.origin === 'assets/index.js')).toBe(true);
  });
});

describe('verify-no-telemetry CLI', () => {
  const script = path.join(process.cwd(), 'scripts', 'verify-no-telemetry.mjs');

  it('fails on a zip that carries the SDK', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'verify-telemetry '));
    const dirty = path.join(dir, 'dirty.apk');
    writeFileSync(
      dirty,
      buildStoredZip('assets/index.js', Buffer.from('Sentry.init({ dsn: "https://x@y/1" });\n')),
    );

    expect(() =>
      execFileSync(process.execPath, [script, dirty], { encoding: 'utf8', stdio: 'pipe' }),
    ).toThrow();
  });

  it('passes on a clean zip and still reports the incidental matches', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'verify-telemetry '));
    const clean = path.join(dir, 'clean.apk');
    writeFileSync(
      clean,
      buildStoredZip('assets/index.js', Buffer.from('const canvasEntry = 1;\n')),
    );

    const output = execFileSync(process.execPath, [script, clean], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    expect(output).toContain('OK: no Sentry/PostHog telemetry found.');
    expect(output).toContain('incidental matches: 1');
  });
});
