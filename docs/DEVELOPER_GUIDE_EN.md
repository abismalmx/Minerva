# Developer Guide — Minerva

> **Minerva** is a sovereign, telemetry-free fork of [Readest](https://github.com/readest/readest).
> This is the reference technical guide for anyone who wants to develop, audit, or self-host the project.

**Document version:** 1.0
**Audience:** front-end, back-end, Rust/native, and packaging engineers, plus anyone who self-hosts their own infrastructure.
**Project license:** GNU AGPL v3 or later.
**Upstream:** Readest — Copyright © Bilingify LLC and the Readest contributors (see [`NOTICE`](../NOTICE)).

---

## Table of contents

1. [Introduction](#1-introduction)
2. [Project philosophy and engineering principles](#2-project-philosophy-and-engineering-principles)
3. [Monorepo architecture](#3-monorepo-architecture)
4. [Development environment setup](#4-development-environment-setup)
5. [Guide to the fork's new features](#5-guide-to-the-forks-new-features)
6. [Testing, code quality, and security](#6-testing-code-quality-and-security)
7. [Multiplatform build and packaging](#7-multiplatform-build-and-packaging)
8. [Contribution workflow](#8-contribution-workflow)
9. [Quick reference](#9-quick-reference)
10. [Glossary and documentation map](#10-glossary-and-documentation-map)

---

## 1. Introduction

### 1.1 What Minerva is

Minerva is a **multiplatform e-book reader** (desktop, mobile, and web) built on a single TypeScript/React codebase that compiles into several targets:

| Target | Runtime | Packaging |
| --- | --- | --- |
| Windows | Tauri v2 + WebView2 | Portable `.exe` (PE32+) and NSIS installer |
| macOS | Tauri v2 + WKWebView | `.dmg` / `universal-apple-darwin` universal binary |
| Linux | Tauri v2 + **CEF** (Chromium Embedded Framework) | `.AppImage`, `.deb`, `.rpm` |
| Android | Tauri v2 + Android WebView | `.apk` / `.aab` |
| iOS | Tauri v2 + WKWebView | `.ipa` |
| Web | Next.js on Cloudflare Workers (OpenNext) | PWA / Docker image |

What distinguishes Minerva from Readest is not the feature set but the **relationship with the user and their data**: Minerva is built so the user is the sole owner of their library, their reading progress, and their notes — and so none of it escapes their control.

### 1.2 Conventions used in this document

- Code blocks tagged `bash` run **from the monorepo root** unless stated otherwise.
- Paths are **relative to the monorepo root**.
- Where a command is platform-specific, the operating system is named.
- Names in `code` identify files, functions, commands, or literal variables in the repository.
- Callouts in the **⚠️ Precision note** format flag divergences between popular lore (or upstream documentation) and the reality of the code, so nobody wastes time hunting for something that does not exist.

### 1.3 Folder naming: `readest-app` → `minerva-app`

Upstream organizes the application under `apps/readest-app`. The fork renamed it to **`apps/minerva-app`**. Several repository tools resolve either name dynamically so nothing breaks:

```bash
# scripts/deploy-cloudflare.sh
for candidate in "$REPO_ROOT/apps/minerva-app" "$REPO_ROOT/apps/readest-app"; do
  if [ -d "$candidate/workers/minerva-sync" ] || [ -d "$candidate/workers/readest-sync" ]; then
    APP_DIR="$candidate"
    break
  fi
done
```

> ⚠️ **Precision note — the real stack.** Upstream documentation and some Minerva descriptions mention "Vite + Jotai". In Minerva's current code:
>
> - **The production bundler is Next.js 16.4.2 (App Router + Pages Router)** with React 19.2.8. There is also a `vite.config.ts` using the [`vinext`](https://github.com/vercel/vinext) plugin that enables an **alternative Vite path** (`pnpm --filter @minerva/app dev-web:vinext` / `build-web:vinext`), and Vitest uses Vite as its runner.
> - **Global state is [Zustand](https://github.com/pmndrs/zustand) 5.0.10**, not Jotai. There is no `atom()` / `useAtom` anywhere in the codebase. Stores live in `apps/minerva-app/src/store/` (31 single-purpose stores). See §3.3.2.
> - **Styling is Tailwind CSS v4** with **daisyUI 5** as the component layer, configured CSS-first in `apps/minerva-app/src/styles/globals.css` (`@import 'tailwindcss'`, `@plugin 'daisyui'`), not via a `tailwind.config.js`.
>
> Always consult the repository's source of truth before assuming an API.

---

## 2. Project philosophy and engineering principles

### 2.1 Data sovereignty

The guiding principle of Minerva is that **the user's library belongs to the user**. This translates into concrete decisions, not declarations of intent:

1. **The server is optional and self-hostable.** The complete sync backend (`minerva-sync`) deploys into the user's own Cloudflare account. An unmodified build talks to that Worker simply by pointing `NEXT_PUBLIC_API_BASE_URL` at its URL. There is no mandatory intermediary.
2. **No account is required.** With `SELF_HOSTED_BACKEND=true` the account layer stops talking to Supabase and starts talking to your Worker: you sign up with email + *passphrase*, and traffic never leaves your account.
3. **Book bytes never pass through a third-party backend.** EPUB/MOBI/PDF files live in your R2 bucket (`minerva-library`), on your disk, or in whichever file-sync provider you prefer (WebDAV, Google Drive, S3, OneDrive, iCloud).
4. **No purchases, no payment cloud.** `SELF_HOSTED=true` unlocks the premium features because a self-hosted deployment has no store to query.

The complete self-hosting architecture is documented in [`apps/minerva-app/workers/minerva-sync/README.md`](../apps/minerva-app/workers/minerva-sync/README.md), with the operational runbook in `docs/DEPLOYMENT.md`.

### 2.2 Privacy by design

Privacy is not a patch applied at the end; it is a design constraint applied at every layer.

**Zero-knowledge client-side encryption.** Sensitive synced fields (OPDS catalog passwords, service credentials, replica blobs) **are encrypted in the client before upload**. The server never sees the key or the plaintext.

```ts
// apps/minerva-app/src/libs/crypto/derive.ts
const PBKDF2_DEFAULT_ITERATIONS = 600_000;
const KEY_LENGTH_BITS = 256;

export const derivePbkdf2Key = async (
  passphrase: string,
  salt: Uint8Array,
  iterations: number = PBKDF2_DEFAULT_ITERATIONS,
): Promise<CryptoKey> => {
  const subtle = requireSubtle();
  const passphraseKey = await subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey'],
  );
  return subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    passphraseKey,
    { name: 'AES-GCM', length: KEY_LENGTH_BITS },
    true,
    ['encrypt', 'decrypt'],
  );
};
```

The envelope that travels over the wire is self-contained and declares its algorithm:

```ts
// apps/minerva-app/src/libs/crypto/envelope.ts
export const CURRENT_ALG = 'aes-gcm/pbkdf2-600k-sha256';

export const encryptToEnvelope = async (
  plaintext: string | Uint8Array,
  key: CryptoKey,
  saltId: string,
): Promise<CipherEnvelope> => {
  const bytes = typeof plaintext === 'string' ? enc.encode(plaintext) : plaintext;
  const payload = await encryptPlaintext(bytes, key);
  const sidecar = await sha256(bytes);
  return {
    c: bytesToBase64(payload.ciphertext),
    i: bytesToBase64(payload.iv),
    s: saltId,
    alg: CURRENT_ALG,
    h: bytesToBase64(sidecar),
  };
};
```

| Layer | Primitive | Detail |
| --- | --- | --- |
| Replica encryption (client) | AES-GCM-256 + PBKDF2-HMAC-SHA256 | Random 12-byte IV per operation; SHA-256 sidecar for integrity; envelope `{c, i, s, alg, h}` |
| Account *passphrase* (server) | PBKDF2-HMAC-SHA256 | 600,000 iterations (OWASP 2023), 16-byte per-account salt; Argon2id also supported (`m=4096, t=1, p=1`) |
| KOSync surface | Salted MD5 | The protocol fixes `md5(password)`; the server only compares digests and stores `kosync-sha256$<salt>$<hash>` |
| Digest comparison | Constant time | `safeEqual` / `constantTimeEq` in `src/libs/crypto/` and `workers/minerva-sync/src/crypto.ts` |

> ⚠️ **Precision note.** The *sync passphrase* (the one that encrypts replicas) and the *account passphrase* (the one that authenticates the user) are **different things**. The Worker never sees either one: of the first it stores only the salt; of the second only a stretched derivation.

**Book content isolation.** EPUB content is rendered in a sandboxed `<iframe>` with external script execution blocked. Navigation outside the book context is prevented. See [`SECURITY.md`](../SECURITY.md) § *Attack Surfaces & Mitigations*.

**Scoped filesystem surface.** In `src-tauri/src/lib.rs`, `allow_paths_in_scopes` extends `fs_scope` and `asset_protocol_scope` **only** for paths that the Tauri dialog (or `persisted-scope` after a restart) already granted. Without that gate, a hypothetical XSS through book content could grant itself read access to the user's home directory.

**URL guard.** Novel imports and browser-session resource requests **reject explicit private IPs and local hostnames**, and native HTTP redirects are re-checked before being followed.

### 2.3 Total eradication of telemetry

This is the fork's strongest commitment — and therefore the easiest to break by accident. The rule is:

> **No product-analytics dependency. No outbound call to a third party for measurement purposes. No user identifier sent to a third-party server.**

Concretely:

- **Zero PostHog.** No `posthog-js` or `posthog-node` dependency in any workspace `package.json`, and no entry in `pnpm-lock.yaml`.
- **Zero Sentry.** No `@sentry/*` in the workspace nor in the Rust crate tree.
- **Zero Mixpanel / Amplitude / Segment / GA / gtag.** Verified in both `package.json` and `pnpm-lock.yaml`.
- **Zero telemetry crates in Rust.** `apps/minerva-app/src-tauri/Cargo.toml` declares no analytics client.
- **No persistent user identifiers** sent to third parties. Nothing in the app emits product events anywhere.

What **does** exist, and is not product telemetry:

| Mechanism | Where | Why it is not telemetry |
| --- | --- | --- |
| Local reading statistics | `src/services/statistics/` → SQLite `statistics.db` | Stays on the device. Feeds the "Continue reading" widget and the statistics panel. |
| `ReadingStatsTracker` | `src/app/reader/components/ReadingStatsTracker.tsx` | Writes to the local database; transmits nothing. |
| Cloudflare Analytics Engine | `wrangler.toml` (`STATS_COMPACT_AE`) | Metrics **of the user's own self-hosted server**, in their own Cloudflare account. They never leave their infrastructure. |
| `head_sampling_rate = 0.01` in `[observability]` | `wrangler.toml` | Telemetry of the Worker's own execution, in the user's Cloudflare account — equivalent to what any self-hosted application emits. |

**Zero-telemetry verification protocol** (operational detail in §6.5):

```bash
# 1. No analytics dependency anywhere in the workspace
grep -rn "posthog\|@sentry\|mixpanel\|amplitude-js\|google-analytics\|gtag\|segment\.io" \
  --include=package.json apps/ packages/ | grep -v node_modules

# 2. No analytics dependency in the Rust crate tree
grep -n "posthog\|sentry\|analytics\|telemetry" apps/minerva-app/src-tauri/Cargo.toml

# 3. No call to an analytics host in application code
grep -rniE "posthog|sentry\.io|api\.mixpanel|api\.amplitude|collect\.google-analytics" \
  apps/minerva-app/src --include=*.ts --include=*.tsx
```

All three commands must return **zero matches**. This block is part of the PR checklist (§8.3).

### 2.4 Open-source policy: AGPL v3 and upstream credits

Minerva is distributed under the **GNU Affero General Public License v3.0 or later**. The full text is in [`LICENSE`](../LICENSE).

**Why AGPL and not MIT.** AGPL adds section 13: anyone who offers a modified Minerva **over a network** must offer the corresponding source code. For a project whose core value is "you control the infrastructure, and you control the code too," it is the coherent license.

**Attribution duty.** `NOTICE` is mandatory reading for anyone redistributing Minerva:

```text
Minerva
=======

Minerva is a modified version (fork) of Readest, https://github.com/readest/readest
Copyright (C) Bilingify LLC and the Readest contributors.

Both the original work and the modifications made in Minerva are distributed
under the GNU Affero General Public License, version 3 or (at your option) any
later version. The full text is in the LICENSE file. The original copyright and
license notices are preserved, as the license requires.

Modifications in Minerva include: a new name, visual identity (palette, typography,
icons) and user-facing text. Their dates and authors are recorded in the version
control history of this repository.

Under section 13 of the AGPL, anyone who uses a modified Minerva over a network
must be offered the corresponding source code. Publish your source repository
and set its URL in the About dialog (src/components/AboutWindow.tsx).

Third-party components keep their own licenses; see the "Acknowledgments"
section of README.md.
```

Practical consequences for contributors:

1. **The copyright notices of Readest and Bilingify LLC are preserved.** Do not strip license headers from inherited files.
2. **Modifications are recorded in version control.** Minerva's changes (name, visual identity, typography, user-facing text) have their date and author in the Git history.
3. **If you deploy a modified Minerva over a network, publish your repository URL** and set it in the About dialog (`src/components/AboutWindow.tsx`).
4. **Third-party components keep their own licenses.** The *Acknowledgments* section of the `README` enumerates foliate-js (MIT), zip.js (BSD-3), fflate (MIT), PDF.js (Apache-2.0), daisyUI (MIT), marked (MIT), Next.js (MIT), React (MIT), Tauri (MIT/Apache-2.0), and the bundled typefaces.
5. **Submodule license files.** `packages/tauri` (a submodule) ships `LICENSE-APACHE-2.0`, `LICENSE-MIT`, and `LICENSE.spdx`; `packages/simplecc-wasm` and `packages/qcms` carry their own.

**Vulnerability reports.** Do not open a public issue. Follow the process in [`SECURITY.md`](../SECURITY.md).

---

## 3. Monorepo architecture

### 3.1 Overview

Minerva is a **pnpm monorepo** with a single embedded Rust workspace:

```text
minerva/
├── apps/
│   ├── minerva-app/                 # The application (Next.js 16 + Tauri v2)
│   │   ├── src/                     # UI, services, and state (TypeScript)
│   │   ├── src-tauri/               # Native backend (Rust)
│   │   ├── workers/                 # Cloudflare Workers
│   │   │   ├── minerva-sync/        # <-- The self-hostable backend
│   │   │   └── send-email/          # Extension email intake
│   │   ├── extensions/              # "Send to Minerva" browser extension
│   │   ├── e2e/                     # UI end-to-end (Playwright)
│   │   └── docs/                    # Application technical documentation
│   ├── minerva-calibre-plugin/      # Calibre plugin
│   ├── minerva-crosspoint-plugin/   # CrossPoint plugin
│   └── minerva.koplugin/            # KOReader plugin (Lua)
├── packages/                        # Dependencies with their own upstream (submodules)
├── data/                            # Icons, screenshots, and release metadata
├── docs/                            # Guides and runbooks
├── fastlane/                        # Store publishing automation
├── nix/                             # Nix packaging
├── scripts/                         # Development and deployment utilities
└── .github/                         # CI, templates, and policies
```

The workspace is declared in `pnpm-workspace.yaml`:

```yaml
packages:
  - apps/*
  - apps/minerva-app/workers/send-email
  - apps/minerva-app/workers/minerva-sync
  - apps/minerva-app/extensions/*
  - packages/foliate-js
```

The Cargo workspace lives in the root `Cargo.toml`:

```toml
[workspace]
members = ["apps/minerva-app/src-tauri"]
exclude = ["packages/qcms", "packages/tauri"]
resolver = "2"

[patch.crates-io]
tauri = { path = "packages/tauri/crates/tauri" }
swift-rs = { path = "packages/swift-rs" }
# The CEF runtime only exists in the Linux CEF build; .cargo/cef.toml takes
# it from feat/cef. Every other build only needs to resolve it.
tauri-runtime-cef = { path = "packages/tauri-runtime-cef-stub" }

[profile.release]
codegen-units = 1
```

> In this checkout, the monorepo root is the `Github/` directory. In the published repository it is the repository root. Every path in this guide is relative to that root.

### 3.2 `apps/minerva-app` — the application

The TypeScript code lives in `apps/minerva-app/src`:

| Path | Responsibility |
| --- | --- |
| `src/app/` | App Router pages and API routes (`src/app/api/*`) |
| `src/pages/` | Legacy Pages Router pages and routes (`src/pages/api/*`) |
| `src/components/` | Shared primitives and components (`primitives/`, `settings/`, `assistant/`, …) |
| `src/app/reader/` | The reader: ~80 components and ~30 hooks |
| `src/app/library/` | Library: grid, import, sorting, OPDS shelves |
| `src/services/` | Business logic: TTS, translators, OPDS, sync, AI, metadata, dictionaries |
| `src/store/` | Zustand stores |
| `src/hooks/` | Reusable React hooks |
| `src/libs/` | Document loading, payments, storage, cryptography (`src/libs/crypto/`) |
| `src/plugins/` | Bundled plugin implementations (Yomitan) |
| `src/utils/` | Pure utility functions |
| `src/workers/` | Web Workers for background tasks |
| `src-tauri/` | Native backend in Rust |

The system-level architecture reference (with Mermaid diagrams) is [`apps/minerva-app/docs/architecture.md`](../apps/minerva-app/docs/architecture.md); the directory breakdown is in [`code-layout.md`](../apps/minerva-app/docs/code-layout.md).

### 3.3 Frontend layer

#### 3.3.1 Stack

| Layer | Technology | Version |
| --- | --- | --- |
| Framework | Next.js (App Router + Pages Router) | 16.4.2 |
| UI | React | 19.2.8 |
| Production bundler | Next.js / Turbopack | — |
| Alternative bundler | Vite + `vinext` | see `vite.config.ts` |
| State | Zustand | 5.0.10 |
| Styling | Tailwind CSS v4 + daisyUI v5 | CSS-first (`src/styles/globals.css`) |
| Base components | Radix UI primitives + `lucide-react` | — |
| Notebook editor | TipTap (`@tiptap/react`, `tiptap-markdown`) | 3.32.x |
| Service worker | Serwist (`@serwist/next`) | 9.5.x |
| i18n | i18next + react-i18next, *key-as-content* scheme | 24.x |
| Tests | Vitest, Playwright, WebdriverIO | — |

#### 3.3.2 State: Zustand, not Jotai

Each concern gets **one** single-purpose store. This is deliberate: the reader is a large system, and a mega-context makes it unmanageable.

```text
libraryStore        -> books, folders, selection, sorting
bookDataStore       -> per-book data (TOC, annotations, locations)
readerStore         -> active views, layout, ribbon state
parallelViewStore   -> two-pane reading
notebookStore       -> notebook side panel
settingsStore       -> user and app settings
themeStore          -> light/dark/atmosphere
sidebarStore        -> sidebar visibility and width
appLockStore        -> PIN lock
deviceStore         -> device profile
transferStore       -> in-flight uploads/downloads
aiChatStore         -> AI chat sessions
statisticsStore     -> reading statistics
```

**Rule for contributions.** Do not add a new store without first justifying why the concern does not fit an existing one. And do not create a store for state that only lives inside a component: local `useState` is the right place.

#### 3.3.3 The platform abstraction (`AppService`)

**The single most important abstraction in the codebase.** Everything that touches "the platform" (filesystem, native dialogs, shell, native TTS, directory scanning, deep links) goes through the `AppService` interface in `src/services/appService.ts`, which has three implementations:

```text
nativeAppService.ts  -> Tauri (desktop + mobile)
webAppService.ts     -> browser (web APIs + OPFS)
nodeAppService.ts    -> Node (tests, CLI, tooling)
```

`src/services/environment.ts` decides at runtime which one to mount, based on `NEXT_PUBLIC_APP_PLATFORM` and platform detection. The normal usage pattern is:

```ts
const appService = useEnv().appService;
```

The same pattern repeats at the database layer (`src/services/database/`): `webDatabaseService` (Turso/WASM over OPFS), `nativeDatabaseService` (Tauri via the `tauri-plugin-turso` plugin), and `nodeDatabaseService` (Node, used by tests). All three share `migrate.ts` and `migrations/*`.

**Where things belong** (the practical rule, extracted from `docs/architecture.md` §9):

| If the code… | It goes in… |
| --- | --- |
| talks to a remote service or writes shared durable storage | `src/pages/api` or `src/app/api`, fronted by a service in `src/services` |
| touches the filesystem, dialogs, shell, or system TTS | `appService` → `nativeAppService` (Rust commands) or `webAppService` |
| manipulates book content, renders the reader, or holds UI state | `src/app/reader`, `src/components`, `src/hooks`, `src/store` |
| is a sync or cloud-library concern | `src/services/sync` plus the matching API route |

### 3.4 Native runtime: Tauri v2 and CEF

The Tauri host lives in `apps/minerva-app/src-tauri`:

```text
src-tauri/src/
├── lib.rs                      -> command registration, scope grants, deep links, builder
├── main.rs                     -> entrypoint
├── clip_url.rs                 -> rendered web-page capture
├── browser_fetch.rs            -> requests using the browser session
├── browser_cookies_macos.rs    -> access to the WebKit cookie store
├── dir_scanner.rs              -> recursive directory scan (library import)
├── transfer_file.rs            -> chunked upload/download for large files
├── discord_rpc.rs              -> Discord Rich Presence (desktop only)
└── android/, macos/, windows/  -> per-platform glue
```

Tauri plugins:

- **Standard:** `fs`, `dialog`, `http`, `opener`, `os`, `process`, `shell`, `cli`, `deep-link`, `haptics`, `log`, `updater`, `websocket`, `oauth`, `persisted-scope`, `device-info`, `sharekit`.
- **In-tree custom plugins:**
  - `tauri-plugin-native-bridge` — Android-side bridges (directory picker callback, opening external URLs, …)
  - `tauri-plugin-native-tts` — native text-to-speech
  - `tauri-plugin-turso` — embedded Turso/libSQL database for native targets, mirrored by the WASM build used in the browser
  - `tauri-plugin-webview-upgrade` — webview update flow where that matters

#### 3.4.1 The Linux CEF runtime

**Linux is the unusual target.** Instead of the `wry` default (WebKitGTK), Minerva uses **CEF (Chromium Embedded Framework)**:

```toml
# apps/minerva-app/src-tauri/Cargo.toml
[features]
default = ["wry"]
# WebView2 / WKWebView runtime, and on Linux the WebKitGTK one, which is left
# only for the webdriver test harness (scripts/test-tauri.sh) — every Linux
# build that ships runs on CEF and turns this off
# (`--no-default-features --features cef`, see scripts/tauri.mjs).
wry = ["tauri/wry", "tauri/x11", "tauri/dbus"]
# Chromium Embedded Framework runtime, the Linux runtime (`pnpm tauri`).
cef = ["dep:tauri-runtime-cef", "dep:zbus", "tauri-plugin-native-bridge/cef"]
cargo-clippy = []
webdriver = ["tauri-plugin-webdriver"]
devtools = ["tauri/devtools", "tauri-runtime-cef?/devtools"]
```

The challenge is that **Cargo can only have one `Cargo.lock`**, and CEF's dependency graph differs from `wry`'s. The solution is **two versioned lockfiles** plus a swapper:

| File | Graph |
| --- | --- |
| `Cargo.lock` | The `wry` graph (1032 `[[package]]` entries). `tauri` resolves to the `packages/tauri` path patch. `tauri-runtime-cef` resolves to the **stub**. |
| `Cargo.cef.lock` | The `CEF` graph (1108 entries). `tauri` and `tauri-runtime-cef` resolve to `git+https://github.com/readest/tauri?branch=feat/cef`. |

The swap is performed by `apps/minerva-app/scripts/tauri.mjs`:

```js
// apps/minerva-app/scripts/tauri.mjs
const CEF_CLI = '@tauri-apps/cli-cef@3.0.0-alpha.27';
const cargoCefCli = process.env['TAURI_CEF_CARGO'] === '1';
const cargoConfig = path.join(appDir, 'src-tauri/.cargo/cef.toml');
const lockPath = path.join(repoRoot, 'Cargo.lock');
const cefLockPath = path.join(repoRoot, 'Cargo.cef.lock');
const savedLockPath = path.join(repoRoot, 'Cargo.lock.wry');

const useCef = process.platform === 'linux' && ['dev', 'build', 'bundle'].includes(command);
```

And the patch set applied to the CEF graph:

```toml
# apps/minerva-app/src-tauri/.cargo/cef.toml
[patch.crates-io]
tauri = { git = "https://github.com/readest/tauri", branch = "feat/cef" }
tauri-build = { git = "https://github.com/readest/tauri", branch = "feat/cef" }
tauri-codegen = { git = "https://github.com/readest/tauri", branch = "feat/cef" }
tauri-macros = { git = "https://github.com/readest/tauri", branch = "feat/cef" }
tauri-plugin = { git = "https://github.com/readest/tauri", branch = "feat/cef" }
tauri-runtime = { git = "https://github.com/readest/tauri", branch = "feat/cef" }
tauri-runtime-cef = { git = "https://github.com/readest/tauri", branch = "feat/cef" }
tauri-utils = { git = "https://github.com/readest/tauri", branch = "feat/cef" }
# ... plus the tauri-plugin-* crates
```

> ⚠️ **Manual recovery.** If a CEF build dies with `SIGKILL` before restoring the lock, the checkout is left with an orphaned `Cargo.lock.wry`. Recover with:
>
> ```bash
> mv Cargo.lock.wry Cargo.lock
> ```
>
> The script aborts with an explicit message when it detects that state, so two concurrent CEF builds cannot clobber each other.

**Behavior per platform:**

| Platform | Runtime | Flags |
| --- | --- | --- |
| Linux desktop | **CEF** | `--features cef` + cargo `--no-default-features --config src-tauri/.cargo/cef.toml` |
| macOS / Windows | wry (WebKit / **WebView2**) | default features (`wry`) |
| Linux mobile (`tauri android/ios`) | wry | wry on Linux too |
| Linux webdriver harness | wry / WebKitGTK | `tauri dev --features webdriver` |
| Nix package | **CEF** | `buildFeatures = [ "cef" ]; buildNoDefaultFeatures = true;` |

#### 3.4.2 Tauri configuration

```json
// apps/minerva-app/src-tauri/tauri.conf.json (excerpt)
{
  "productName": "Minerva",
  "mainBinaryName": "minerva",
  "identifier": "com.minerva.app",
  "version": "../package.json",
  "build": {
    "frontendDist": "../out",
    "devUrl": "http://localhost:3000",
    "beforeDevCommand": "pnpm dev",
    "beforeBuildCommand": "pnpm build && pnpm strip-sourcemaps"
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "windows": {
      "webviewInstallMode": { "type": "embedBootstrapper" },
      "nsis": { "installerHooks": "nsis/installer-hooks.nsh", "installMode": "both" }
    },
    "linux": {
      "appimage": { "files": { "bin/00-no-userns-prompt.hook": "appimage/00-no-userns-prompt.hook" } }
    },
    "android": { "minSdkVersion": 26 },
    "iOS": { "minimumSystemVersion": "16.4" },
    "createUpdaterArtifacts": true
  }
}
```

Note `beforeBuildCommand`: every Tauri build **always** runs `pnpm strip-sourcemaps` (§6.5).

### 3.5 `packages/` — rendering engines and forked dependencies

`packages/` holds **Git submodules** for dependencies that have their own upstream and that Minerva patches:

```text
packages/
├── foliate-js/               -> https://github.com/readest/foliate-js.git
├── tauri/                    -> https://github.com/readest/tauri.git
├── simplecc-wasm/            -> https://github.com/readest/simplecc-wasm.git
├── js-mdict/                 -> https://github.com/readest/js-mdict.git
├── qcms/                     -> https://github.com/mozilla/pdf.js.qcms.git
├── swift-rs/                 -> Swift/ObjC bindings (vendored, not a submodule)
└── tauri-runtime-cef-stub/   -> stub for builds that do not use CEF
```

**Format engines.** Minerva does **not** reimplement book parsing; it builds on `packages/foliate-js` (a fork of Foliate JS):

| File in `packages/foliate-js/` | Format / function |
| --- | --- |
| `epub.js` | EPUB 2/3 (reflowable and fixed-layout) |
| `epubcfi.js` | CFI (EPUB Canonical Fragment Identifier) |
| `mobi.js` | MOBI, AZW, AZW3, KF8 |
| `fb2.js` | FB2 (FictionBook) |
| `comic-book.js` | **CBZ and CBR** (comics) |
| `fixed-layout.js` | Fixed-pagination books |
| `dict.js` | Dictionaries |
| `footnotes.js` | Footnotes |
| `search.js`, `text-walker.js`, `section-chunks.js` | Search and text chunking |
| `tts.js` | Media overlays / narration |
| `progress.js` | Reading progress |
| `quote-image.js` | Quote as image |
| `reader.js`, `view.js`, `paginator.js`, `overlayer.js` | Rendering and views |
| `opds.js` | OPDS catalogs |
| `pdf.js` + `vendor/pdfjs/` | **PDF** via PDF.js |
| `vendor/zip.js`, `vendor/fflate.js` | ZIP decompression |

`packages/js-mdict` implements the **MDict** dictionary format, and `packages/qcms` is PDF.js's color-management module.

**Traditional-to-Simplified Chinese conversion:** `packages/simplecc-wasm` (OpenCC in WASM), exposed under the `@simplecc` alias.

**Resolution aliases.** Neither `pdfjs-dist` nor `simplecc-wasm` is copied into `public/`; they resolve from `packages/` because Tauri embeds everything published in `public/` and it would be shipped twice (issue #6368):

```ts
// apps/minerva-app/vite.config.ts
resolve: {
  alias: {
    '@pdfjs': path.resolve('../../packages/foliate-js/node_modules/pdfjs-dist/legacy/build'),
    '@simplecc': path.resolve('../../packages/simplecc-wasm/dist/web'),
  },
},
```

**Importers and converters.** These live in the app, not in `packages/`:

| Location | Function |
| --- | --- |
| `src/services/ingestService.ts` | Decides whether a book is imported as a hash copy (`Books/<hash>/`) or **in place** at the user's chosen path |
| `src/services/send/conversion/` | Article/URL → EPUB conversion (`buildEpub.ts`, `convertToEpub.ts`, `assetBundler.ts`, `toc.ts`, `coverGenerator.ts`, `conversionWorker.ts`) |
| `src/services/transformers/` | Pure functions: language detection, punctuation normalization, sanitization, footnote rewriting, style injection, Chinese conversion, Warichu |
| `src/services/opds/` | OPDS feed parsing and auto-download |
| `src/services/dictionaries/` | Import of StarDict, MDict, DICT, SLOB, and BGL packs |

### 3.6 The self-hostable backend: Cloudflare Workers + D1 + R2

The heart of the fork is `apps/minerva-app/workers/minerva-sync`: **one Worker** serving the complete API.

```text
┌───────────────┐        ┌──────────────────────────────┐
│  Minerva      │  HTTPS │  Cloudflare Worker            │
│  (desktop,    │ ─────► │  minerva-sync                 │
│   mobile, web)│        │  ├─ D1  (SQLite)  accounts,   │
│               │        │  │    books, notes, replicas   │
│  KOReader     │ ─────► │  └─ R2  books, covers          │
└───────────────┘        └──────────────────────────────┘
```

**Two API surfaces in the same Worker:**

| Surface | Routes | Who speaks it |
| --- | --- | --- |
| Native Minerva API | `/api/sync`, `/api/sync/replicas`, `/api/sync/replica-keys`, `/api/storage/*`, `/api/auth/*`, `/api/user/*` | The app (desktop, mobile, web) |
| KOSync-compatible API | `/users/create`, `/users/auth`, `/syncs/progress` | KOReader and Minerva's own "KOReader Sync" integration |

**Worker structure:**

```text
apps/minerva-app/workers/minerva-sync/
├── src/
│   ├── index.ts            # entrypoint
│   ├── routes.ts           # route table
│   ├── auth.ts             # HS256 token minting and verification
│   ├── accounts.ts         # registration, login, account deletion
│   ├── crypto.ts           # PBKDF2 / Argon2id / SHA-256 / salted MD5
│   ├── crdt.ts             # per-field merge rules (last-writer-wins)
│   ├── merge.ts            # applying patches onto a canonical row
│   ├── push.ts, pull.ts    # incremental upload and download
│   ├── replicas.ts         # encrypted replicas
│   ├── replicaKeys.ts      # passphrase salt bootstrap
│   ├── replicaValidation.ts# kind allowlist, size limits, clock skew
│   ├── kosync.ts           # KOSync surface
│   ├── storage.ts          # slot reservation, quota, signed URLs
│   ├── storageTicket.ts    # download tickets
│   ├── rows.ts, types.ts, http.ts
├── migrations/             # 0001_init.sql .. 0004_replicas_canonical_row.sql
└── wrangler.toml           # D1 and R2 bindings
```

**Migrations:**

| File | What it does |
| --- | --- |
| `0001_init.sql` | The whole schema: accounts, throttle, library, notes, files, stats, replicas, salts, KOSync progress, and the `book_highlights` / `book_bookmarks` views |
| `0002_login_attempts.sql` | The sign-in throttle table, for databases that ran the first schema before it had one |
| `0003_kosync_progress.sql` | The KOSync progress table and the two views, for the same reason |
| `0004_replicas_canonical_row.sql` | Rebuilds `replicas` with one row per `(kind, replica_id)` and folds the versions a pre-release schema had appended |

**What is stored where:**

| Data | Location |
| --- | --- |
| Accounts (email, stretched digests) | D1 `users` |
| Failed sign-in attempts | D1 `login_attempts` |
| Library metadata | D1 `books` |
| Reading progress and view settings | D1 `book_configs` |
| Notes, highlights, bookmarks, ink | D1 `book_notes` (also readable via the `book_highlights` and `book_bookmarks` views) |
| Reading statistics | D1 `stat_books`, `stat_pages` |
| Synced settings, shelves, translators | D1 `replicas`, `replica_keys` |
| KOReader progress | D1 `kosync_progress` |
| Book files, covers, replica blobs | R2 `minerva-library` |

> Every row is scoped by `user_id` and every query filters on it, so one account can never read another's data.

**Merge model.** The client publishes **patches**, not full rows: a settings change carries only the field that changed. That is why the server is the only place where two sides can be combined:

- A field is won by the envelope with the larger clock; ties go to the `device_id`.
- A tombstone is the largest tombstone seen, and a field write never revives a tombstoned row.
- A manifest is never cleared by a version that carries none.
- The row's clock never regresses, so the pull cursor stays monotonic.

Two devices pushing the same replica at the same time is safe: the write is a compare-and-set on the row's clock, and a lost race re-reads and merges again.

#### 3.6.1 One-command deployment

```bash
git clone --recurse-submodules https://github.com/minerva/minerva.git
cd minerva

npx wrangler login          # opens the browser the first time
./deploy-cloudflare.sh      # idempotent: safe to re-run
```

`scripts/deploy-cloudflare.sh` is idempotent and performs eight steps:

| Step | What happens |
| --- | --- |
| 1 | Verifies tools and the Cloudflare session (`wrangler whoami` / `wrangler login`) |
| 2 | Creates (or reuses) the **D1** database `minerva-sync` and extracts its `database_id` |
| 3 | Creates (or reuses) the **R2** bucket `minerva-library` |
| 4 | Writes `database_id` and `bucket_name` into `wrangler.toml` without touching the rest |
| 5 | Generates a 32-byte `JWT_SECRET` and registers it in **Cloudflare Secrets** (never in `wrangler.toml`) |
| 6 | Applies the remote migrations (`0001`–`0004`) |
| 7 | Publishes the `minerva-cloudflare` Worker to `*.workers.dev` |
| 8 | Checks `/health` and writes `NEXT_PUBLIC_API_BASE_URL` into `apps/minerva-app/.env.local` |

To rotate the secret without invalidating sessions:

```bash
./deploy-cloudflare.sh --rotate-secret
```

Manual deployment, if you prefer granular control:

```bash
cd apps/minerva-app/workers/minerva-sync

wrangler d1 create minerva-sync         # prints the database_id
wrangler r2 bucket create minerva-library
wrangler secret put JWT_SECRET           # 32+ random characters
pnpm migrate:remote                      # applies 0001..0004
pnpm deploy
```

#### 3.6.2 Local Worker development

```bash
cd apps/minerva-app/workers/minerva-sync

pnpm install
pnpm migrate     # applies the schema to the local D1
pnpm dev         # wrangler dev on http://localhost:8787

# In another terminal
curl -s http://localhost:8787/health
# {"status":"ok"}
```

The Worker's tests (which run **the real migrations against a real SQLite database**) live in the app's suite:

```bash
cd apps/minerva-app
pnpm test --run src/__tests__/workers/
```

### 3.7 Sibling Workers

| Worker | Function |
| --- | --- |
| `workers/minerva-sync` | The sync backend described above |
| `workers/send-email` | Email intake for the "Send to Minerva" extension; normalizes attachments and drops items into the user's inbox |

### 3.8 Plugins and side surfaces

| Surface | Location | Notes |
| --- | --- | --- |
| "Send to Minerva" browser extension | `apps/minerva-app/extensions/send-to-minerva/` | Sends URLs and articles to the app |
| KOReader plugin (Lua) | `apps/minerva.koplugin/` | Word-bundle sync, with LocalSend binaries compiled for `armv7` and `arm64` |
| Calibre plugin | `apps/minerva-calibre-plugin/` | Send books from Calibre |
| CrossPoint plugin | `apps/minerva-crosspoint-plugin/` | — |
| Windows thumbnail provider | `apps/minerva-app/extensions/windows-thumbnail/` | Shell extension DLL, `windows_thumbnail.dll` |

### 3.9 The three sync paths

Do not confuse them:

1. **Legacy KOSync** — `src/services/sync/KOSyncClient.ts` against `pages/api/sync.ts` and `pages/api/kosync.ts`. Reading progress only. It exists for compatibility with KOSync-style clients (KOReader).
2. **Replicas (the modern path)** — the client encrypts each replica locally with a passphrase-derived key (`replicaCryptoMiddleware.ts`, `passphraseGate.ts`), publishes deltas to `pages/api/sync/replicas.ts`, and applies remote changes through per-category adapters (`src/services/sync/adapters/*`: annotations, settings, dictionaries, fonts, textures, OPDS catalogs). The orchestrator is `replicaSyncManager.ts`, and `replicaCursorStore.ts` tracks "where did I last pull to" per category so syncs stay incremental.
3. **Third-party file sync** — a provider-neutral engine under `src/services/sync/file` with adapters for **WebDAV, Google Drive, S3, OneDrive, and iCloud**. Shared shelf metadata lives in `library.json` alongside book files, covers, and per-book configuration. Remote-only books appear as cloud-backed shelf rows; the book file stays remote until the user opens or downloads it.

---

## 4. Development environment setup

### 4.1 Prerequisites

| Tool | Version | Purpose | Reference |
| --- | --- | --- | --- |
| **Node.js** | 24 (22 minimum) | UI and Next.js build | CI uses Node 24; `build-all-platforms.yml` uses 22 |
| **pnpm** | 11.1.1 | Monorepo package manager | Pinned in the root `package.json` `packageManager` field |
| **Rust / Cargo** | 1.90 or newer | Tauri native backend | `rust-version = "1.90"` in `src-tauri/Cargo.toml`. ⚠️ The Linux **CEF** build requires **Rust ≥ 1.95** |
| **Tauri prerequisites** | Per OS | System libraries | <https://v2.tauri.app/start/prerequisites/> |
| **Cloudflare CLI (wrangler)** | Recent | Backend only | `npx wrangler login` |
| **Android SDK + NDK** | NDK `28.2.13676358`, JDK 17 (Zulu), API 36 | Android builds only | `sdkmanager "ndk;28.2.13676358"` |
| **Xcode** | 16 or newer | iOS/macOS only | `xcode-select --install` |

Quick install:

```bash
# Node with nvm
nvm install v24
nvm use v24

# pnpm (use corepack to respect the pinned version)
corepack enable
corepack prepare pnpm@11.1.1 --activate

# Rust
rustup update
rustup component add clippy rustfmt
rustup target add aarch64-linux-android armv7-linux-androideabi  # if building Android
```

### 4.2 Linux system dependencies

For the CEF desktop build:

```bash
sudo apt-get update
sudo apt-get install -y \
  pkg-config \
  libfontconfig-dev \
  libgtk-3-dev \
  libwebkit2gtk-4.1 libwebkit2gtk-4.1-dev \
  libjavascriptcoregtk-4.1 \
  gir1.2-webkit2-4.1 \
  libappindicator3-dev \
  librsvg2-dev \
  patchelf xdg-utils \
  libnss3 libpulse0 libspeechd2 libxkbcommon-x11-0
```

For the Tauri integration tests (WebKitWebDriver):

```bash
sudo apt-get install -y xvfb
```

For the KOReader plugin (Lua):

```bash
sudo apt-get install -y luajit luarocks libsqlite3-dev
sudo luarocks --lua-version=5.1 install busted
sudo luarocks --lua-version=5.1 install lsqlite3complete
```

> The Linux CEF build additionally **installs the Tauri CLI from the fork**, because the `cli-cef` npm package bundles a broken `quick-sharun` fork:
>
> ```bash
> cargo install tauri-cli \
>   --git https://github.com/readest/tauri \
>   --rev 6beeb209b5514f597a26f48b7a5b9fe4c59b5f12 \
>   --locked --force
> ```

### 4.3 Cloning and preparing the tree

```bash
git clone --recurse-submodules https://github.com/minerva/minerva.git
cd minerva

# If you had already cloned without submodules:
git submodule update --init --recursive

pnpm install --frozen-lockfile

# Copy the vendored assets (PDF.js worker/WASM/cmaps/fonts) into public/
pnpm --filter @minerva/app setup-vendors
```

`setup-vendors` runs:

```bash
pnpm prepare-vendor            # mkdirp ./public/vendor/pdfjs
pnpm copy-pdfjs-worker         # pdf.worker.min.mjs
pnpm copy-pdfjs-wasm           # WASM decoders
pnpm copy-pdfjs-fonts          # cmaps + standard_fonts
pnpm copy-flatten-pdfjs-css    # annotation-layer and text-layer CSS, flattened with postcss
```

Confirm the environment is healthy:

```bash
pnpm tauri info
```

### 4.4 Environment variables

The app has three environment-file sets, following a fixed pattern:

| File | Purpose | `NEXT_PUBLIC_APP_PLATFORM` |
| --- | --- | --- |
| `.env.tauri` / `.env.tauri.local` | Desktop and mobile builds | `tauri` |
| `.env.web` / `.env.web.example` | Web build (Cloudflare / Docker) | `web` |
| `.env.apple-appstore.local`, `.env.apple-nonstore.local`, `.env.ios-appstore.local`, `.env.google-play.local` | Signing and store configuration | — |

The scripts load them with `dotenv`, always chaining the `.local` first and the `.example` as fallback:

```json
// apps/minerva-app/package.json
"dev":       "dotenv -e .env.tauri -e .env.tauri.example -- next dev",
"build":     "dotenv -e .env.tauri -e .env.tauri.example -- next build",
"dev-web":   "dotenv -e .env.web -e .env.web.example -- next dev",
"build-web": "dotenv -e .env.web -e .env.web.example -- next build"
```

#### 4.4.1 App variables

```dotenv
# apps/minerva-app/.env.local.example
# Origin of your Cloudflare Worker. The app appends `/api` itself.
NEXT_PUBLIC_API_BASE_URL=https://minerva-cloudflare.<your-subdomain>.workers.dev

# Authenticate against your Worker instead of Minerva Cloud.
SELF_HOSTED_BACKEND=true
NEXT_PUBLIC_SELF_HOSTED_BACKEND=true

# Unlocks the paid features: a self-hosted deployment has no store.
SELF_HOSTED=true
NEXT_PUBLIC_SELF_HOSTED=true

# Sync passphrase. Encrypts sensitive uploaded fields client-side; the
# server only stores the salt.
SYNC_PASSPHRASE=

# --- Optional ---------------------------------------------------------------
NEXT_PUBLIC_STORAGE_FIXED_QUOTA=
MINERVA_TTS_CATALOG_URL=
```

> **The critical difference between the two switches.**
> - `SELF_HOSTED=true` **unlocks the premium features** (there is no store to query).
> - `SELF_HOSTED_BACKEND=true` **switches the account layer**: you sign up with email + passphrase against your Worker and the app **stops talking to Supabase entirely**.
>
> A deployment that only wants the premium unlock keeps `SELF_HOSTED_BACKEND` off and continues to use Minerva Cloud.

> **`NEXT_PUBLIC_API_BASE_URL` is optional in the binaries you distribute.**
> Minerva's public artifacts are compiled **without** that variable: the
> bundle carries no baked-in URL, neither third-party nor personal. When the
> end user connects to their own Worker, the app resolves the URL **at
> runtime**:
>
> 1. `getCustomBackendUrl()` (`apps/minerva-app/src/services/environment.ts`)
>    reads the `minerva_custom_backend_url` key from `localStorage`
>    (`CUSTOM_BACKEND_STORAGE_KEY`) and sanitizes it before returning it.
> 2. `setCustomBackendUrl()` sanitizes and stores it. That is what the
>    sign-in form calls when the user pastes their Worker's URL
>    (`apps/minerva-app/src/app/auth/components/EmailPasswordAuth.tsx`).
> 3. `getBaseUrl()` resolves in this order: the stored URL → the runtime
>    config's `apiBaseUrl` → `API_BASE_URL` → `NEXT_PUBLIC_API_BASE_URL` →
>    the neutral `https://web.minerva.invalid` placeholder.
>
> In other words: **the variable is only needed for a preconfigured
> deployment** (a web server, a Docker image, a store). For a binary you
> distribute, leave it empty or out: the user pastes their URL in the
> sign-in screen and that is it.
>
> The sanitizing is not cosmetic: `sanitizeBackendUrl()` **requires
> `https://`** (it only allows `http://` on `localhost` and loopback
> addresses), discards credentials embedded in the URL, the query string and
> the fragment, and normalizes trailing slashes. It is the same function
> that keeps CWE-319 (cleartext credentials) and URL injection at bay.

#### 4.4.2 Self-hosted backend variables

```dotenv
# .env.example (monorepo root)
CF_ACCOUNT_ID=
CF_R2_BUCKET=minerva-library
CF_D1_DATABASE_ID=
JWT_SECRET=            # 32+ characters; registered with `wrangler secret put JWT_SECRET`

NEXT_PUBLIC_API_BASE_URL=https://minerva-cloudflare.<your-subdomain>.workers.dev
SELF_HOSTED_BACKEND=true
NEXT_PUBLIC_SELF_HOSTED_BACKEND=true
SELF_HOSTED=true
NEXT_PUBLIC_SELF_HOSTED=true
SYNC_PASSPHRASE=

ALLOWED_ORIGINS=*
MAX_UPLOAD_BYTES=104857600
STORAGE_FIXED_QUOTA=0
PASSPHRASE_KDF_ITERATIONS=600000
```

| Variable | Effect |
| --- | --- |
| `ALLOWED_ORIGINS` | Comma-separated list of allowed browser origins. `*` is fine for a personal deployment |
| `MAX_UPLOAD_BYTES` | Per-book upload ceiling. The platform limit is 100 MB; the Worker answers `413` rather than truncating |
| `STORAGE_FIXED_QUOTA` | Per-account quota in bytes. `0` means no quota |
| `PASSPHRASE_KDF_ITERATIONS` | PBKDF2 iteration count. The number is stored alongside each hash, so lowering it never invalidates existing accounts |

> Here `NEXT_PUBLIC_API_BASE_URL` **is** filled in: it is the URL the Worker
> and the app share in a self-hosted deployment, which is why
> `deploy-cloudflare.sh` writes it into `apps/minerva-app/.env.local`. In the
> binaries that ship, on the other hand, it is **deliberately left out** (see
> [4.4.1](#441-app-variables)): the user types their URL in the sign-in
> screen.

**No real value is ever versioned.** Only `.env.example` files are published; `.env.local` files are in `.gitignore`.

### 4.5 Running the application

```bash
# Web development (no Rust compilation — the fast loop)
pnpm dev-web

# Desktop development (compiles the Rust backend)
pnpm tauri dev

# Preview with an OpenNext web build
pnpm preview
```

On Linux, `pnpm tauri dev` **uses the CEF runtime** (see §3.4.1). To inspect the running app on Linux there is a CDP path:

```bash
# Terminal 1 — dev build with the CDP endpoint on 127.0.0.1:9222
pnpm tauri:dev:cdp

# Terminal 2
pnpm cdp targets                                     # list debuggable targets
pnpm cdp eval 'document.title'                       # run JS in the app window
pnpm cdp eval 'window.__TAURI_INTERNALS__.invoke("plugin:app|version")'
pnpm cdp click 'button[aria-label="Import Books"]'   # real pointer events
pnpm cdp screenshot /tmp/library.png
pnpm cdp logs 30                                     # tail the app console
```

> The IPC bridge cannot be stubbed: `window.__TAURI_INTERNALS__.invoke` is non-writable and non-configurable, so assigning over it from `eval` fails silently and the real command still runs.

### 4.6 Android and iOS

**Android** — the Android project is initialized once:

```bash
rm -rf apps/minerva-app/src-tauri/gen/android
pnpm tauri android init
pnpm tauri icon ../../data/icons/minerva-book.png
git checkout apps/minerva-app/src-tauri/gen/android
```

Development on a device or emulator:

```bash
pnpm tauri android dev
pnpm tauri android dev --host   # with a real device over USB
```

Or the shortcut that installs the dev APK directly:

```bash
pnpm --filter @minerva/app dev-android
```

**iOS** (macOS only):

```bash
pnpm tauri ios init
pnpm tauri icon ../../data/icons/minerva-book.png
pnpm tauri ios dev
pnpm tauri ios dev --host
```

### 4.7 Worktrees

**Always use `pnpm worktree:new`, never `git worktree add` by hand.** The script handles submodule initialization, dependency installation, `.env` copying, vendored assets, and the `src-tauri/gen` symlinks required for lint and tests to pass.

```bash
pnpm worktree:new feat/my-feature   # new branch from origin/main
pnpm worktree:new 3837              # checkout PR #3837 with push access to the fork
pnpm worktree:rm                    # cleanup
```

### 4.8 Nix

If you have Nix, the flake gives you a shell with every dependency:

```bash
nix develop           # shell for web and desktop
nix develop .#android # shell for Android
nix develop .#ios     # shell for iOS (macOS only)

nix build -L          # package
```

The Nix package is built with **CEF**:

```nix
buildFeatures = [ "cef" ];
buildNoDefaultFeatures = true;
```

---

## 5. Guide to the fork's new features

This section documents the three features that distinguish Minerva from Readest: where they live, how they are structured, what contract they hold, and how to extend them without breaking anything.

### 5.1 Markdown Notes Notebook

The notebook is a **Markdown document per book**, edited with a rich-text (WYSIWYG) editor whose durable format is Markdown.

#### 5.1.1 Architecture

```text
apps/minerva-app/src/app/reader/components/notebook/
├── Notebook.tsx                    # Side panel: visibility, pin, width, responsive, shortcuts
├── NotebookEditor.tsx              # Notes tab body: chapter selector, excerpts, save status
├── RichNotebookEditor.tsx          # TipTap editor. The durable format is Markdown
├── NotebookToolbar.tsx             # Text style, bold, italic, strike, highlight, lists, quote, "Quote from the book"
├── NotebookChapterSelector.tsx     # Chapter selector (flattened TOC) + "All notes" + jump to current chapter
├── NotebookTabNavigation.tsx       # Bottom tabs: notes / ai
├── NotebookTransitionAlert.tsx     # Modal: could not save → keep open / copy draft / discard / retry
├── Header.tsx                      # Pin / unpin / close
├── AIAssistant.tsx                 # AI tab (assistant-ui + Reedy RAG)
└── extensions/
    ├── notebookEditorExtensions.ts     # TipTap extension stack + Mod-Enter → save shortcut
    └── notebookMarkdownExtensions.ts   # NotebookHighlight (mark) and BookLink (mark with data-cfi)
```

**Services and utilities:**

| File | Responsibility |
| --- | --- |
| `src/store/notebookStore.ts` | Panel state: width, visibility, pinned, active tab, annotation drafts |
| `src/store/notebookDocumentStore.ts` | **The real document state**, keyed by `bookHash`: content, durable content, revision, saved revision, status, error, recovery |
| `src/app/reader/services/notebookDocumentCoordinator.ts` | Orchestrates save, debounce, flush, and recovery. `NOTEBOOK_SAVE_DEBOUNCE_MS = 750` |
| `src/app/reader/hooks/useNotebookDocumentCoordinator.ts` | React binding; module-level map of coordinators keyed by book hash |
| `src/app/reader/utils/notebookDocument.ts` | `NOTEBOOK_MAX_BYTES = 256 * 1024`, mutation validation, `upsertNotebookRecord`, CRLF-aware insertion |
| `src/app/reader/utils/notebookRecovery.ts` | `localStorage` recovery persistence |
| `src/app/reader/utils/notebookChapters.ts` | `flattenToc`, `matchExcerptChapter`, `parseChapterSections`, `getChapterContent` |
| `src/app/reader/utils/notebookCitation.ts` | **Book linking**: the `minerva-cfi:` scheme |
| `src/app/reader/utils/notebookMarkdown.ts` | `serializeNotebookEditor` (workaround for a whitespace bug in `tiptap-markdown`) |

#### 5.1.2 Data model

The notebook is a **reserved singleton record** inside the book's configuration:

```ts
// apps/minerva-app/src/types/book.ts
export type BookNoteType = 'bookmark' | 'annotation' | 'excerpt' | 'notebook' | 'ink';
```

```ts
// apps/minerva-app/src/app/reader/utils/notebookDocument.ts
export const NOTEBOOK_ID = 'notebook';

export const findNotebookRecord = (booknotes: BookNote[]): BookNote | undefined =>
  booknotes.find((note) => note.id === NOTEBOOK_ID);

export const upsertNotebookRecord = (
  booknotes: BookNote[],
  patch: { note: string; updatedAt: number; cfi?: string },
): BookNote[] => { /* ... */ };
```

**The durable contract**, as it lands on disk:

```json
{
  "id": "notebook",
  "type": "notebook",
  "cfi": "<creationTimeBookCfi>",
  "note": "# Title\n\nBody in **Markdown**.\n",
  "createdAt": 1764300000000,
  "updatedAt": 1764300123456
}
```

#### 5.1.3 Persistence in three layers

| Layer | Location | Written when |
| --- | --- | --- |
| **Durable** | `Books/<book.hash>/config.json` → `BookConfig.booknotes[]` | After the 750 ms debounce, via `useBookDataStore.updateBooknotes()` → `appService.saveBookConfig()` |
| **Recovery** | `window.localStorage`, key `minerva:notebook-recovery:<profileId>:<bookHash>` | On every mutation, before the durable save is attempted |
| **Cloud** | `POST /api/sync` → Worker → D1 `book_notes` | When note sync is active |

**The profile used for the recovery key** resolves in this order:

```ts
// src/app/reader/hooks/useNotebookDocumentCoordinator.ts
const profileId = user?.id ?? settings.replicaDeviceId ?? settings.kosync.deviceId ?? 'anonymous-profile';
```

> **No database migration is required.** The `book_notes.type` and `book_notes.note` columns are text; the `'notebook'` type needs no new schema. The `book_highlights` and `book_bookmarks` views filter by known types, so the notebook is automatically excluded from them.

#### 5.1.4 The document state machine

```ts
// src/store/notebookDocumentStore.ts
type NotebookDocumentStatus =
  | 'clean'
  | 'dirty'
  | 'saving'
  | 'error'
  | 'waiting-for-position'
  | 'recovery-choice';

type NotebookDocumentError = 'size-limit' | 'recovery-unavailable' | 'save-failed' | null;
```

| State | Meaning |
| --- | --- |
| `clean` | In-memory content matches the durable copy |
| `dirty` | There are unsaved changes |
| `saving` | A save is in flight |
| `error` | The save failed; the error says why |
| `waiting-for-position` | No valid CFI yet (the book has not produced a position) |
| `recovery-choice` | A draft in `localStorage` diverges from the durable copy; the user decides |

**Conflict resolution:** when the local draft and the saved version differ, `resolveNotebookRecovery()` returns `'none' | 'restore' | 'diverged'`, and the `NotebookTransitionAlert` modal offers *recover draft* or *use latest saved*.

**Size limit:** 256 KiB UTF-8 per book, measured with `TextEncoder`. It is **never truncated**: when the document exceeds the limit, the `size-limit` error blocks the save and the UI asks you to copy or remove text.

#### 5.1.5 Book linking

There are **two complementary mechanisms**:

**(a) CFI citations (Markdown links).** The `minerva-cfi:` scheme lets a Markdown link survive a serialization round-trip:

```ts
// src/app/reader/utils/notebookCitation.ts
export const NOTEBOOK_CFI_SCHEME = 'minerva-cfi:';

export const buildNotebookCitationHref = (cfi: string): string =>
  `${NOTEBOOK_CFI_SCHEME}${encodeURIComponent(cfi)}`;

export const readNotebookCitationCfi = (href: string): string | null => {
  if (!href.startsWith(NOTEBOOK_CFI_SCHEME)) return null;
  return decodeURIComponent(href.slice(NOTEBOOK_CFI_SCHEME.length));
};
```

The **"Quote from the book"** toolbar dropdown inserts a blockquote whose second paragraph carries the `BookLink` mark with the excerpt's `cfi`. Clicking the link navigates to the exact position:

```ts
export const navigateToNotebookCitation = async (bookKey: string, cfi: string) => {
  window.dispatchEvent(new CustomEvent('navigate'));
  await view.goTo(cfi);
};
```

**(b) Per-chapter hierarchy.** The document is partitioned by chapter using markers that live *inside* the Markdown:

```text
<!-- minerva-chapter:cap1:The awakening -->
```

`parseChapterSections()` detects them, `getChapterContent()` extracts a section, and `NotebookChapterSelector` lets you scope the editor to one chapter or to the general notes.

#### 5.1.6 Durable format and highlights

```ts
// src/app/reader/components/notebook/extensions/notebookMarkdownExtensions.ts
export const NOTEBOOK_HIGHLIGHT_COLORS = ['yellow', 'mint', 'blue', 'coral'] as const;
```

The color names **are part of the durable Markdown contract**: `==text==` becomes `<mark data-color="mint">text</mark>`. Changing a name breaks compatibility with already-written notebooks.

Serializer configuration:

```ts
// extensions/notebookEditorExtensions.ts
Markdown.configure({
  html: false,
  linkify: false,
  breaks: false,
  tightLists: true,
  bulletListMarker: '-',
})
```

> `underline: false` — underlining is not portable in Markdown, which is why it is disabled.

#### 5.1.7 Export

> ⚠️ **Precision note.** The notebook has **no export of its own**. The original design (*Notebook Linked Writing Workspace*, *Copy to Notebook and legacy excerpts*) excludes it explicitly: "Notebook export is not added in this issue."
>
> What does exist:
>
> - **Annotation and excerpt export** to Markdown via `src/app/reader/components/annotator/ExportMarkdownDialog.tsx`. The notebook is **deliberately excluded** from that export:
>
>   ```ts
>   // src/app/reader/components/annotator/Annotator.tsx
>   const allNotes = notes.filter((note) => note.type !== 'notebook' && !note.deletedAt);
>   ```
>
> - **"Copy to Notebook"** (`viewSettings.copyToNotebook`), which creates or updates an `excerpt` record and opens the notebook panel. It does **not** insert into the notebook document; "Insert into Notebook" was removed.
>
> If you need to export the notebook today, copy and paste the Markdown out of the editor.

#### 5.1.8 i18n

The project uses the *key-as-content* scheme: **the translation key is the English string itself**.

```json
// apps/minerva-app/public/locales/es/translation.json
{
  "Notebook": "Cuaderno",
  "Notes": "Notas",
  "Excerpts": "Extractos",
  "All notes": "Todas las notas",
  "Saving…": "Guardando…",
  "Saved": "Guardado",
  "Couldn't save": "No se pudo guardar",
  "Notebook is too large to save. Copy or remove some text to continue.":
    "El cuaderno es demasiado grande para guardarse. Copia o elimina texto para continuar."
}
```

To add a string: use `_('English string')` in the component and run `pnpm --filter @minerva/app i18n:extract`.

### 5.2 Contextual Web Image Search

Lets you search for images of characters, places, or concepts **without leaving the reading view**, and insert them into your note.

#### 5.2.1 Sources

**Wikipedia and Wikimedia Commons**, through the public MediaWiki APIs. There is no Unsplash, Pexels, or Pixabay, and **there is no AI image generation**.

| Source | Endpoint | Limit |
| --- | --- | --- |
| Wikipedia | `https://{lang}.wikipedia.org/w/api.php` | 12 results |
| Wikimedia Commons | `https://commons.wikimedia.org/w/api.php` | 15 results |

#### 5.2.2 Service

```text
apps/minerva-app/src/services/imageSearch/imageSearchService.ts
```

```ts
export interface ImageSearchResult {
  id: string;
  title: string;
  thumbnailUrl: string;
  originalUrl: string;
  extract?: string;
  source: 'wikipedia' | 'wikimedia' | 'custom';
  pageUrl?: string;
  width?: number;
  height?: number;
}
```

Three public functions:

| Function | What it does |
| --- | --- |
| `searchWikipediaImages(query, lang = 'es', limit = 10, signal?)` | Queries `generator=search` + `prop=pageimages\|extracts`; **falls back automatically to `en`** if the book's language yields nothing |
| `searchWikimediaCommons(query, limit = 12, signal?)` | `gsrnamespace=6` + `prop=imageinfo` with `extmetadata`; strips the `File:` prefix from the title and extracts `ImageDescription` / `ObjectName` (truncated to 200 characters) |
| `searchPersonImages(query, lang = 'es', signal?)` | `Promise.allSettled` across both sources, deduplicates by `thumbnailUrl` without the query string, and puts Wikipedia results first |

All of them use `AbortSignal.timeout(10000)` and respect the dialog's `AbortController`, so a new search cancels the previous one.

#### 5.2.3 User interface

```text
apps/minerva-app/src/app/reader/components/annotator/ImageSearchDialog.tsx
```

| Piece | Detail |
| --- | --- |
| Props | `{ isOpen, initialQuery, bookLanguage?, onSelectImage, onClose }` |
| Auto-search | On open, it searches the prefilled query (normally the selected text) |
| Language selector | `es`, `en`, `fr`, `de`, `it`, `pt`; initial value derived from `bookLanguage`, default `es` |
| Sources | `all` / `wikipedia` / `commons` / `custom` (a URL pasted by hand) |
| Preview | Image preview before confirming |
| Biographical summary | `includeExtract` checkbox (on by default) that appends the extract as a Markdown quote |
| Dialog | `Dialog` with `snapHeight={0.85}` and `SegmentedControl` |

#### 5.2.4 The full flow

```text
User selects text in the reader
        │
        ▼
AnnotationTools → "Photo" button (type: 'image')
        │
        ▼
handleOpenImageSearch(targetNoteId?)
  · seeds the query with selection.text
  · closes the annotation popup
  · suppresses the native selection handles
        │
        ▼
ImageSearchDialog → direct fetch to wikipedia.org / commons.wikimedia.org
        │
        ▼
handleSelectImageForNote(data)
  · builds `![title](url)` + `\n\n> extract` (optional)
  · if there is a target annotation: saveBooknoteNoteText(noteId, markdown)
  · if not: creates/uses the highlight at the selection CFI and appends
  · toast "Photo attached to note"
```

The button is registered in `AnnotationTools.tsx`:

```ts
{
  type: 'image',
  label: _('Photo'),
  tooltip: _('Search photo or attach image'),
  Icon: LuImagePlus,
  quickAction: true,
}
```

#### 5.2.5 Privacy

**Only the search string leaves the device.** Book content, title, and extract are never sent. The image is inserted as Markdown into the note, which is stored in the book's local `config.json` and synced through the normal notes mechanism.

#### 5.2.6 State and persistence

There is no store, no atom, no database, and no backend endpoint: it is a direct `fetch` to the public APIs with the results held in the dialog's local `useState`. The only persistence is the resulting Markdown, which lands in the note (`BookNote.note`).

### 5.3 "Continue Reading" Widget

Minerva adds a **continue-reading poster** to the library: a piece of visual identity that shows the book you were last reading, its progress, and the estimated time remaining.

> ⚠️ **Precision note — two different things.** Minerva also ships the Android/iOS home-screen widgets (`src/services/widget/readingWidget.ts`, `bookshelfWidget.ts`, `src/hooks/useHomeScreenWidgets.ts`), but **that is upstream Readest functionality**, not a fork feature. The fork-specific addition is the library poster described here.

#### 5.3.1 Components

```text
apps/minerva-app/src/app/library/components/ContinueReadingHero.tsx   # The poster
apps/minerva-app/src/app/library/components/BookSpine.tsx              # BookSpine + BookFolio
apps/minerva-app/src/app/library/components/Bookshelf.tsx              # Book selection
apps/minerva-app/src/app/library/utils/libraryUtils.ts                  # Progress and time remaining
apps/minerva-app/src/hooks/useMedianPageDurationSecs.ts                 # Reading pace
```

#### 5.3.2 Book selection

The poster **only** appears on the library's default view, with no active filters, and it picks the most recently updated book in progress:

```ts
// src/app/library/components/Bookshelf.tsx
const continueReadingBook = useMemo(() => {
  if (queryTerm || contentSearch?.query.trim() || groupId || shelfId || isSelectMode) return null;
  const candidates = visibleBooks.filter((book) => {
    if (book.readingStatus !== 'reading') return false;
    const percentage = getProgressPercentage(book);
    return percentage !== null && percentage > 0 && percentage < 100;
  });
  if (!candidates.length) return null;
  return candidates.reduce((latest, book) =>
    (book.updatedAt ?? 0) > (latest.updatedAt ?? 0) ? book : latest);
}, [...]);
```

| Rule | Value |
| --- | --- |
| View | Only the unfiltered library (no search, no group, no shelf, not in selection mode) |
| Status | `readingStatus === 'reading'` |
| Progress | Strictly between 0 % and 100 % (neither just-opened nor finished) |
| Choice | The one with the highest `updatedAt` |

#### 5.3.3 The "spine" (`BookSpine`) — the visual signature

```text
apps/minerva-app/src/app/library/components/BookSpine.tsx
```

It is a vertical rule on the leading edge of the cover whose filled portion equals the reading progress, driven by the CSS variable `--minerva-spine-progress`. It only renders for books that have been opened (`readingStatus === 'finished' || progress > 0`).

The rest of the poster: cover, title, author (`formatAuthors`), a progress bar with `role='progressbar'` and `aria-label={_('Reading progress')}`, `BookFolio`, the estimated time remaining, a "Continue" CTA, and a large percentage figure on a tonal panel (`minerva-poster`, `minerva-halftone`).

If the progress is `null` or `NaN`, the component returns `null`.

#### 5.3.4 State and progress persistence

| Data | Location | Detail |
| --- | --- | --- |
| Reading progress | `Book.progress: [number, number]` in the library array → `Books/library.json` | `libraryStore` → `appService.saveLibraryBooks()` → `safeSaveJSON(fs, 'library.json', 'Books', …)` |
| Reading pace | **SQLite** `statistics.db` (`StatisticsDb`) | `db.getBookByMd5(hash)` → `db.getMedianPageDurationSecs(book.id)` |
| Reading statistics | `src/services/statistics/` | Local; feed the widget and the statistics panel |

**Library saves are throttled to 30 seconds** (`scheduleLibrarySave` in `src/store/bookDataStore.ts`), with `flushPendingLibrarySave()` on unmount or blur.

**The database is not IndexedDB.** It is SQLite: the `tauri-plugin-turso` plugin natively, and **OPFS + Turso/WASM** on the web (`navigator.storage.getDirectory()` in `src/services/webAppService.ts`).

#### 5.3.5 Time-remaining calculation

```ts
// src/app/library/utils/libraryUtils.ts
export const getProgressPercentage = (book: Book): number | null => { /* ... */ };

export const getTimeRemainingMinutes = (
  book: Book,
  medianPageDurationSecs?: number,
): number | null => { /* ... */ };  // audiobooks use `duration`

export const getDisplayedTimeRemaining = (
  book: Book,
  medianPageDurationSecs?: number,
): string | undefined => { /* ... */ };  // undefined for finished/abandoned/unread
```

The pace comes from `useMedianPageDurationSecs(book.hash)`, which reads the median seconds-per-page from `StatisticsDb`.

---

## 6. Testing, code quality, and security

### 6.1 Test tiers

The project uses **Vitest** for nearly everything, and WebdriverIO for full UI end-to-end:

| Suffix | Command | Environment | Use for |
| --- | --- | --- | --- |
| `*.test.ts` | `pnpm test` | jsdom | Pure logic, utilities, services without browser APIs or IPC |
| `*.browser.test.ts` | `pnpm test:browser` | Chromium (Playwright) | Web Workers, `SharedArrayBuffer`, OPFS, WASM |
| `*.tauri.test.ts` | `pnpm test:tauri` | Tauri WebView | Plugin commands, native filesystem, IPC |
| `*.e2e.ts` | `pnpm test:e2e` | Tauri app (WDIO) | UI interaction, window management, navigation flows |
| `*.android.test.ts` | `pnpm test:android` | Android device (CDP) | Native selection, touch gestures, selection handles |

The complete reference is [`apps/minerva-app/docs/testing.md`](../apps/minerva-app/docs/testing.md).

### 6.2 Running the tests

```bash
# Unit suite (watch mode)
pnpm test

# Unit suite, single run
pnpm test --run

# Just one file (note: no `--` before the path!)
pnpm test --run src/__tests__/utils/misc.test.ts

# Just one test by name
pnpm test -t "notebook"

# Browser
pnpm test:browser

# Coverage
pnpm --filter @minerva/app test:coverage

# Browser extension
pnpm --filter @minerva/app test:extension
```

**Configurations:**

| File | Configures |
| --- | --- |
| `vitest.config.mts` | jsdom, `setupFiles: ['./vitest.setup.ts']`, excludes the browser/tauri/android/e2e suites |
| `vitest.browser.config.mts` | Chromium via `@vitest/browser-playwright` |
| `vitest.tauri.config.mts` | `@vitest/browser-webdriverio`, connects to the WebDriver on port 4445 |
| `vitest.android.config.mts` | Node environment, serial execution, `retry: 1` |
| `wdio.conf.ts` | WebdriverIO + Mocha |

### 6.3 Type checking and linting (TypeScript + Biome)

```bash
# Type check + Biome lint (both)
pnpm lint

# Types only
pnpm --filter @minerva/app exec tsc --noEmit

# Biome only
pnpm --filter @minerva/app exec biome lint .

# Formatting
pnpm format          # writes (biome format --write .)
pnpm format:check    # checks without writing
```

`biome.json` sits at the monorepo root and applies everywhere except `packages/`, `node_modules/`, `gen/`, `.next/`, `out/`, `target/`, `fastlane/`, and vendored artifacts. Key settings:

```json
{
  "formatter": {
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100,
    "lineEnding": "lf"
  }
}
```

> `.mjs`, `.cjs`, and `.mts` files are excluded from Biome's formatter. Run them through your editor or `prettier` if you prefer, but **do not** break CI's `format:check`.

### 6.4 Rust: fmt, clippy, and tests

```bash
pnpm fmt:check       # cargo fmt -p Minerva --check
pnpm clippy:check    # cargo clippy -p Minerva --no-deps -- -D warnings
pnpm --filter @minerva/app test:rust   # cargo test -p Minerva --lib
```

And from `apps/minerva-app/src-tauri`:

```bash
cargo fmt --check
cargo clippy -p Minerva --no-deps -- -D warnings
cargo test -p Minerva --lib
```

> If you touch `apps/minerva-app/src-tauri/**`, **update the matching lockfile**: `Cargo.lock` for the `wry` graph and `Cargo.cef.lock` for the `CEF` graph. The PR checklist asks for this explicitly.

### 6.5 Zero-telemetry verification protocol

This is the fork's specific quality gate. It runs at four levels.

#### 6.5.1 Level 1 — Static analysis of the source

```bash
# 1.1 No analytics dependency anywhere in the workspace
grep -rn "posthog\|@sentry\|mixpanel\|amplitude-js\|google-analytics\|gtag\|segment\.io" \
  --include=package.json apps/ packages/ | grep -v node_modules
# → must print nothing

# 1.2 No analytics dependency in the crate tree
grep -n "posthog\|sentry\|analytics\|telemetry" apps/minerva-app/src-tauri/Cargo.toml
# → must print nothing

# 1.3 No analytics host in application code
grep -rniE "posthog|sentry\.io|api\.mixpanel|api\.amplitude|collect\.google-analytics|googletagmanager" \
  apps/minerva-app/src --include=*.ts --include=*.tsx
# → must print nothing

# 1.4 No fetch/XHR call to a disallowed host
grep -rnoE "https?://[a-zA-Z0-9.-]+\.[a-z]{2,}" apps/minerva-app/src --include=*.ts --include=*.tsx \
  | grep -vE "example\.(com|org|test)|localhost|\.invalid|minerva\.invalid"
# → every result must be a service the user deliberately configured
```

#### 6.5.2 Level 2 — Inspection of the built bundle

```bash
pnpm --filter @minerva/app build

# 2.1 No analytics SDK in the production bundle
grep -rniE "posthog|sentry\.io|mixpanel|amplitude" apps/minerva-app/out/ apps/minerva-app/.next/
# → must print nothing

# 2.2 Verify no source maps leak
pnpm --filter @minerva/app strip-sourcemaps
find apps/minerva-app/out/_next/static -name '*.js.map' | wc -l
# → must be 0
```

**About `strip-sourcemaps.mjs`.** This script (`apps/minerva-app/scripts/strip-sourcemaps.mjs`) is part of the build's privacy contract, although its goal is not telemetry but **preventing the original source code from shipping inside the binary**:

```js
// apps/minerva-app/scripts/strip-sourcemaps.mjs
export const stripSourceMappingComment = (code) =>
  code.replace(/\n\/\/# sourceMappingURL=[^\n]*/g, '');

export const stripCssSourceMappingComment = (code) =>
  code.replace(/\n\/\*# sourceMappingURL=[^*]*\*\//g, '');

export const stripMaps = (dir) => {
  if (!existsSync(dir)) return 0;
  let removed = 0;
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) removed += stripMaps(full);
    else if (entry.endsWith('.map')) {
      rmSync(full);
      removed += 1;
    } else if (entry.endsWith('.js')) {
      const code = readFileSync(full, 'utf8');
      const stripped = stripSourceMappingComment(code);
      if (stripped !== code) writeFileSync(full, stripped);
    } else if (entry.endsWith('.css')) {
      const code = readFileSync(full, 'utf8');
      const stripped = stripCssSourceMappingComment(code);
      if (stripped !== code) writeFileSync(full, stripped);
    }
  }
  return removed;
};
```

The script deletes **every** `*.map` — the JavaScript ones and the
`*.css.map` ones too — and drops the `sourceMappingURL` comment that was
left dangling, both in the `.js` files (`//# sourceMappingURL=…`) and in the
`.css` ones (`/*# sourceMappingURL=…*/`). Without that second step the
browser (and devtools) would keep trying to fetch a map that no longer
exists, and the request is answered with HTML, which the webview reports as
a source map parse error. The build contract is therefore: **zero `.map`
files and zero `sourceMappingURL` references in the bundle that ships**.

```bash
pnpm --filter @minerva/app build
pnpm --filter @minerva/app strip-sourcemaps

# Both must print 0
find apps/minerva-app/out -name '*.map' | wc -l
grep -rl "sourceMappingURL" apps/minerva-app/out | wc -l
```

> **The bundle travels compressed inside the binary.** Tauri embeds the
> frontend into the native library with brotli (`tauri-codegen`), so a `grep`
> over the `.exe` or the `.apk` does not see the JavaScript or the
> stylesheets: it only sees the uncompressed strings (the Rust binary, the
> DEX). To check what actually ships you have to look at the
> `tauri-codegen-assets` blobs, or audit the whole artifact with
> `verify-no-telemetry.mjs`, which decompresses them (see
> [6.5.5](#655-level-5--binary-verification-of-the-artifact)).

It runs automatically in every Tauri build (`beforeBuildCommand: "pnpm build && pnpm strip-sourcemaps"`). For development builds with debugging:

```bash
KEEP_SOURCEMAPS=1 pnpm --filter @minerva/app dev-macos
```

#### 6.5.2.1 Neutrality verification of the final artifact

The bundle must carry no third-party and no personal URL, because the
binary that ships is **sovereign**: it works with no network at all and only
talks to the server the user picks. The check is done on the final artifact,
not on the source:

```bash
# 1. The frontend that is about to be embedded only carries placeholders
grep -rhoE "https://[a-z0-9.-]*workers\.dev" apps/minerva-app/out | sort -u
# → https://minerva-cloudflare.tu-subdominio.workers.dev
# → https://tu-worker.workers.dev

# 2. The final binary carries no Worker URL in the clear
strings -a Minerva-1.0.5.exe | grep -ioE "https?://[a-z0-9.-]*workers\.dev" | sort -u
# → prints nothing: the frontend ships brotli-compressed

# 3. Neutrality is checked over the decompressed blobs
node apps/minerva-app/scripts/verify-no-telemetry.mjs --brotli \
  target/x86_64-pc-windows-gnu/release/build/Minerva-*/out/tauri-codegen-assets

# 4. Zero maps and zero dangling references in the bundle
find apps/minerva-app/out -name '*.map' | wc -l
grep -rl "sourceMappingURL" apps/minerva-app/out | wc -l
```

> **Careful with `strings` over a compressed artifact.** A URL grep over the
> `.exe` only sees what is not compressed. The frontend ships with brotli, so
> to be sure you have to search the `tauri-codegen-assets` blobs (with
> `--brotli`) or the `out/` that was compiled. The same caveat applies to
> `.exe` and `.apk` as to AppImages: an AppImage payload is a squashfs and
> has to be extracted with `--appimage-extract` before it can be audited.

#### 6.5.3 Level 3 — Dynamic verification

```bash
# 3.1 Start the web app and watch outbound traffic
pnpm dev-web

# In DevTools → Network, filter by Fetch/XHR:
#   · no analytics host may appear
#   · /api/* requests go only to NEXT_PUBLIC_API_BASE_URL
#   · requests to wikipedia.org / commons.wikimedia.org happen only when the
#     user explicitly uses the image search
```

In the Linux CEF build, the same verification over CDP:

```bash
pnpm tauri:dev:cdp
pnpm cdp logs 30
```

#### 6.5.4 Level 4 — CI regression

`secret-scan.yml` runs **gitleaks** over the full history:

```yaml
- uses: gitleaks/gitleaks-action@ff98106e… # v2
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    GITLEAKS_LICENSE: ${{ secrets.GITLEAKS_LICENSE }}
```

> The `fetch-depth: 0` is intentional: "The whole history: a leaked key stays in the log even after it is removed from the tip."

`codeql.yml` analyzes `actions`, `javascript-typescript`, and `rust` with `build-mode: none`, and `scorecard.yml` publishes the OpenSSF Scorecard.

#### 6.5.5 Level 5 — Binary verification of the artifact

A `strings | grep -iE "sentry|posthog"` over the APK is **not enough**: Tauri embeds the frontend bundle into the native library **brotli-compressed**, so the JavaScript never shows up in the binary and the grep only sees the uncompressed strings (the Rust binary, the DEX). To verify what actually ships, `apps/minerva-app/scripts/verify-no-telemetry.mjs` decompresses the artifact before searching:

```bash
# The whole artifact (decompresses the APK and searches every entry)
node apps/minerva-app/scripts/verify-no-telemetry.mjs \
  apps/minerva-app/src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk

# The embedded frontend (the brotli blobs written by tauri-codegen)
node apps/minerva-app/scripts/verify-no-telemetry.mjs --brotli \
  target/aarch64-linux-android/release/build/Minerva-*/out/tauri-codegen-assets
```

The script classifies every match on two levels:

- **telemetry** — a real SDK, endpoint or key (`io.sentry`, `@sentry/`, `sentry.io`, `posthog.com`, `SentryInitProvider`, …). **Fails the build.**
- **incidental** — the vendor name appears only as a substring of another identifier. In this project those are the pdf.js properties ending in `Entry` (`canvasEntry`, `settingsEntry`, `hasXfaDatasetsEntry`): the previous word's trailing "s" plus "Entry" spells "sentry". They are reported with their context so a human can confirm them, but they do not fail the build.

> The same script walks an **AppImage** artifact by extracting its payload
> first (`--appimage-extract`): the squashfs hides the frontend just like
> brotli does. `listFiles()` skips symlinks, which in that payload point at
> recursive directories and used to abort the walk with `ELOOP`.

The `verify no telemetry` step of `build-all-platforms.yml` runs this check over every artifact of the matrix.

### 6.6 The security model in summary

The *Threat Model* section of [`SECURITY.md`](../SECURITY.md) is the reference. Summary:

| Surface | Risk | Mitigation |
| --- | --- | --- |
| Ebook parsing | Malformed files → XSS or path traversal | Rendering in a sandboxed `<iframe>`, external scripts blocked, parsing isolated from the main process |
| Cloud sync and authentication | Credential theft or cross-account access | HTTPS/TLS, tokens in the OS secure store, per-`user_id` authorization on every query |
| OPDS catalogs | Malicious server serving crafted XML | Defensive parsing, sources added explicitly by the user, downloads treated as untrusted content |
| HTML/JS embedded in a book | XSS or exfiltration | Sandboxed `<iframe>` with scripting restrictions, navigation outside the book blocked |
| Supply chain | Compromised dependency | `pnpm-lock.yaml` and `Cargo.lock` pinned, Dependabot and GitHub dependency review enabled |
| Tauri IPC | Abuse of commands from web content | Capability allowlist; filesystem access limited to the app data directory and paths already granted by the dialog |

---

## 7. Multiplatform build and packaging

### 7.1 Build commands

All of them run from `apps/minerva-app` unless stated otherwise.

| Target | Command | Output |
| --- | --- | --- |
| Web build | `pnpm build-web` | `.next/` + `out/` |
| Web build (Vite/vinext) | `pnpm build-web:vinext` | — |
| Tauri build (frontend) | `pnpm build` | `out/` (static export) |
| Linux AppImage | `pnpm build-linux-x64` | `target/release/bundle/appimage/` |
| Windows (NSIS installer) | `pnpm build-win-x64` | `target/<triple>/release/bundle/nsis/` |
| Windows ARM64 | `pnpm build-win-arm64` | same |
| macOS universal (DMG) | `pnpm build-macos-universial` | `target/universal-apple-darwin/release/bundle/dmg/` |
| macOS universal (App Store) | `pnpm build-macos-universial-appstore` | `.app` |
| iOS | `pnpm build-ios` / `pnpm build-ios-appstore` | `.ipa` |
| Android (dev) | `pnpm dev-android` | debug APK |
| Full desktop | `pnpm tauri build` | depends on the platform |

> ⚠️ **Inherited upstream typo.** The `build-win-x64` script uses the `i686-pc-windows-msvc` target (32-bit) despite the name. If you need a 64-bit PE32+, invoke the CLI directly:
>
> ```bash
> cd apps/minerva-app
> pnpm tauri build --target x86_64-pc-windows-msvc --bundles nsis
> ```
>
> The same naming mismatch exists in `build-macos-universial*` ("universial" instead of "universal"). These are script names, not functional bugs; do not "fix" them without also updating the references in `.github/workflows`.

### 7.2 Linux — AppImage with CEF

**The Linux build flow is special:** the Tauri CLI is installed from the fork, and the dependency graph is swapped with `Cargo.cef.lock`.

```bash
# 1. Tauri CLI from the CEF fork
cargo install tauri-cli \
  --git https://github.com/readest/tauri \
  --rev 6beeb209b5514f597a26f48b7a5b9fe4c59b5f12 \
  --locked --force

# 2. Build (the scripts/tauri.mjs wrapper handles the lockfile swap)
cd apps/minerva-app
pnpm tauri build --bundles appimage
```

Output:

```text
target/release/bundle/appimage/Minerva.AppImage
```

**The AppImage hook.** `src-tauri/appimage/00-no-userns-prompt.hook` disables the root-password prompt that AppImage's standard *fix-namespaces* hook shows when enabling unprivileged user namespaces:

```sh
#!/bin/sh
# Sourced by AppRun before the bundler's own hooks (glob order). Its
# fix-namespaces hook asks for a root password to enable unprivileged user
# namespaces, which this build never needs: CEF runs without the sandbox
# feature, every child with --no-sandbox.
notify() { return 1; }
run_gui_sudo() { return 1; }
```

**Bundle verification** (what `try-appimage.yml` does):

```bash
APPIMAGE_DIR=target/release/bundle/appimage/Minerva.AppDir

# Runtime libraries that must be present
for lib in libsoftokn3.so libfreeblpriv3.so libnssckbi.so libsqlite3.so.0 \
           libpulse.so.0 libspeechd.so.2 libxkbcommon-x11.so.0; do
  test -e "$APPIMAGE_DIR/lib/$lib" || echo "MISSING: $lib"
done

# The pulseaudio directory and its lib.path entry
test -d "$APPIMAGE_DIR/lib/pulseaudio"
grep -q '+/pulseaudio' "$APPIMAGE_DIR/lib.path"

# The hook that suppresses the userns prompt
test -e "$APPIMAGE_DIR/bin/00-no-userns-prompt.hook"
```

**The AppImage CI** (`.github/workflows/try-appimage.yml`) is manual-dispatch only and covers two architectures:

| Axis | Runner | Rust target |
| --- | --- | --- |
| `x86_64` | `ubuntu-22.04` | `x86_64-unknown-linux-gnu` |
| `aarch64` | `ubuntu-22.04` | `aarch64-unknown-linux-gnu` |

Its steps: checkout with submodules → pnpm/Node 24 → `pnpm install --frozen-lockfile --prefer-offline` → `pnpm --filter @minerva/app setup-vendors` → Rust toolchain + cache → CEF Tauri CLI install → apt dependencies → **staging of the CEF AppImage runtime libraries** (patching `tauri.conf.json` with `jq` to add `/usr/lib/libspeechd.so.2` and `/usr/lib/libxkbcommon-x11.so.0`) → build with `TAURI_CEF_CARGO=1` → verification of the AppImage contents → artifact upload.

### 7.3 Windows — PE32+ portable with WebView2

On Windows the runtime is **wry/WebView2**, not CEF.

```bash
cd apps/minerva-app

# NSIS installer (64-bit)
pnpm tauri build --target x86_64-pc-windows-msvc --bundles nsis

# Portable .exe (PE32+)
pnpm tauri build --target x86_64-pc-windows-msvc --bundles nsis
```

**The portable executable** is produced in CI (`release.yml`, *build and upload portable binaries*):

```bash
pushd apps/minerva-app/
echo "NEXT_PUBLIC_PORTABLE_APP=true" >> .env.local
pnpm tauri build --target x86_64-pc-windows-msvc --bundles nsis
popd

exe_file="target/x86_64-pc-windows-msvc/release/minerva.exe"
cp $exe_file "Minerva_${version}_x64-portable.exe"
gh release upload $RELEASE_TAG "Minerva_${version}_x64-portable.exe" --clobber
pnpm tauri signer sign "Minerva_${version}_x64-portable.exe"
gh release upload $RELEASE_TAG "Minerva_${version}_x64-portable.exe.sig" --clobber
```

> A note from the workflow itself: "Browsers on Windows won't download zip files that contain exe files so upload the exe files instead. This is totally stupid." That is why the portable build is published as an `.exe` and not a `.zip`.

**WebView2.** The installer embeds the *bootstrapper*:

```json
"windows": {
  "webviewInstallMode": { "type": "embedBootstrapper" }
}
```

And the `webview-upgrade` plugin enforces the supported version range:

```json
"plugins": {
  "webview-upgrade": { "minUpgradeMajor": 121, "minSupportedMajor": 111 }
}
```

**The Explorer thumbnail extension.** The `windows_thumbnail.dll` is compiled separately:

```bash
cargo build --package windows_thumbnail --release --target x86_64-pc-windows-msvc
mkdir -p extensions/windows-thumbnail/target
cp target/x86_64-pc-windows-msvc/release/windows_thumbnail.dll extensions/windows-thumbnail/target/
```

And shipped as a bundle resource via `src-tauri/tauri.windows.conf.json`:

```json
{
  "bundle": {
    "resources": {
      "../extensions/windows-thumbnail/target/windows_thumbnail.dll": "minerva_thumbnail.dll"
    }
  }
}
```

The NSIS hooks (`src-tauri/nsis/installer-hooks.nsh`) register and unregister the thumbnail handler for `.epub .mobi .azw .azw3 .kf8 .fb2 .cbz .cbr .pdf`.

**Windows build prerequisites:** "Build Tools for Visual Studio 2022" with the *Desktop development with C++* workload; for ARM64, the *VS 2022 C++ ARM64 build tools* and *C++ Clang Compiler for Windows* components, with `clang` on the `PATH`.

### 7.4 Android — signed APK with Gradle

**The Android project is generated by the Tauri CLI.** It is not a pure Gradle project: there is no `./gradlew assembleRelease`.

**The Android project is versioned.** `src-tauri/gen/android/` is tracked in git because it carries the FOSS flavor, the signing configuration (`keystore.properties`) and the `llvm-strip` step, none of which the CLI template has. `tauri android init` only fills in the files that do not exist yet, so the tracked project survives the initialization.

**Initialization (once):**

```bash
cd apps/minerva-app
pnpm tauri android init
pnpm tauri icon ../../data/icons/minerva-book.png
git checkout .
```

> Do not delete `src-tauri/gen/android` before the initialization: that removes the tracked project and leaves the vanilla CLI template behind, without signing or the FOSS flavor.

**Signing configuration** — `src-tauri/gen/android/app/build.gradle.kts` reads `keystore.properties`:

```kotlin
val keystorePropertiesFile = rootProject.file("keystore.properties")
val keystoreProperties = java.util.Properties().apply {
    if (keystorePropertiesFile.exists()) {
        keystorePropertiesFile.inputStream().use { load(it) }
    }
}

signingConfigs {
    if (keystorePropertiesFile.exists()) {
        create("signing") {
            keyAlias = keystoreProperties["keyAlias"] as String
            keyPassword = keystoreProperties["password"] as String
            storeFile = file(keystoreProperties["storeFile"] as String)
            storePassword = keystoreProperties["password"] as String
        }
    }
}

buildTypes {
    getByName("release") {
        isMinifyEnabled = true
        if (keystorePropertiesFile.exists()) {
            signingConfig = signingConfigs.getByName("signing")
        }
    }
}
```

Build settings: `compileSdk = 36`, `targetSdk = 36`, `minSdk = 26`, `jvmTarget = "1.8"`, `applicationId = "com.minerva.app"`.

**Flavor dimensions:**

| `storeFlavor` | `penFlavor` | Use |
| --- | --- | --- |
| `foss` (default) | `genericPen` (default) | F-Droid and direct APK |
| `googleplay` | `booxPen` | Google Play and BOOX e-ink devices |

> The `googleplay` flavor sets `carAppMetaName = "com.minerva.app.androidauto.withheld"` because Play's Auto review rejects the app (issues #5038 / #5235).

**Build:**

```bash
cd apps/minerva-app

# One universal APK
pnpm tauri android build -t aarch64

# Per ABI (what CI does)
pnpm tauri android build -t aarch64        # arm64-v8a
pnpm tauri android build -t armv7          # armeabi-v7a
pnpm tauri android build -t i686 -t x86_64 # legacy
```

The APK lands in:

```text
src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk
```

**Signing in CI** (`release.yml`):

```bash
cd apps/minerva-app/
pnpm tauri android init
pnpm tauri icon ../../data/icons/minerva-book.png
git checkout .

pushd src-tauri/gen/android
echo "keyAlias=${{ secrets.ANDROID_KEY_ALIAS }}" > keystore.properties
echo "password=${{ secrets.ANDROID_KEY_PASSWORD }}" >> keystore.properties
base64 -d <<< "${{ secrets.ANDROID_KEY_BASE64 }}" > $RUNNER_TEMP/keystore.jks
echo "storeFile=$RUNNER_TEMP/keystore.jks" >> keystore.properties
popd

pnpm tauri android build -t aarch64
cp src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk \
   "Minerva_${version}_arm64.apk"
gh release upload $RELEASE_TAG "Minerva_${version}_arm64.apk" --clobber
pnpm tauri signer sign "Minerva_${version}_arm64.apk"
```

**CI environment:** `NDK_HOME=$ANDROID_HOME/ndk/28.2.13676358`, Java 17 (Zulu distribution), `sdkmanager "ndk;28.2.13676358"`.

**Publishing to Google Play** — `scripts/release-google-play.sh`:

```bash
# Removes REQUEST_INSTALL_PACKAGES from the manifest (Play forbids it)
# Asserts MANAGE_EXTERNAL_STORAGE is still present
source .env.google-play.local
ORG_GRADLE_PROJECT_storeFlavor=googleplay \
  pnpm tauri android build --config src-tauri/tauri.playstore.conf.json

# Writes the changelog (truncated to 480 characters)
# → fastlane/metadata-play/android/en-US/changelogs/default.txt

fastlane android upload_production
```

> `src-tauri/tauri.playstore.conf.json` **is not versioned in this checkout**. Create it before using this path.

**Listing validation** (uploads nothing):

```bash
pnpm --filter @minerva/app validate-google-play
```

### 7.5 macOS — universal binary

```bash
cd apps/minerva-app

# Direct distribution DMG (not the App Store)
pnpm build-macos-universial
# → tauri build -t universal-apple-darwin --bundles dmg \
#     --config src-tauri/tauri.macos-nonestore.conf.json

# App Store
pnpm build-macos-universial-appstore
# → tauri build -t universal-apple-darwin --bundles app \
#     --config src-tauri/tauri.appstore.conf.json
```

Rust targets: `x86_64-apple-darwin,aarch64-apple-darwin`. Output in `target/universal-apple-darwin/release/bundle/macos/`.

The direct-distribution profile carries its own entitlements:

```json
// src-tauri/tauri.macos-nonestore.conf.json
{
  "bundle": {
    "macOS": {
      "minimumSystemVersion": "12.0",
      "entitlements": "./profiles/direct-entitlements.plist",
      "files": {
        "embedded.provisionprofile": "./profiles/MinervaDeveloperID.provisionprofile"
      }
    }
  }
}
```

Two more overlays exist, both tracked:

- `src-tauri/tauri.macos-unsigned.conf.json` — the same configuration **without** the provisioning profile. `build-all-platforms.yml` uses it: an Apple-issued profile only means anything next to its private key, so an unsigned binary should not carry one.
- `src-tauri/tauri.ci.conf.json` — turns off `bundle.createUpdaterArtifacts`. With the updater artifacts enabled the bundler demands `TAURI_SIGNING_PRIVATE_KEY` and the build fails without that secret.

**Publishing to the Mac App Store** (`scripts/release-mac-appstore.sh`):

```bash
jq --arg version "$CURRENT_DATE" '.bundle.macOS.bundleVersion = $version' \
  src-tauri/tauri.appstore.conf.json
pnpm run build-macos-universial-appstore

BUNDLE_DIR=../../target/universal-apple-darwin/release/bundle/macos
xcrun productbuild --sign "$APPLE_INSTALLER_SIGNING_IDENTITY" \
  --component $APP_BUNDLE /Applications $INSTALLER_BUNDLE
xcrun altool --upload-app --type macos --file $INSTALLER_BUNDLE \
  --apiKey $APPLE_API_KEY --apiIssuer $APPLE_API_ISSUER
```

### 7.6 iOS

```bash
pnpm build-ios-appstore
# → tauri ios build --export-method app-store-connect
# → src-tauri/gen/apple/build/arm64/Minerva.ipa
```

The release script applies the fixes and entitlement verifications **before** uploading, and aborts if anything fails (`set -euo pipefail`):

```bash
pnpm --filter @minerva/app release-ios-appstore
```

### 7.7 Auto-updater

`createUpdaterArtifacts: true` produces the minisign-signed artifacts. The `latest.json` manifest is updated per platform:

| Platform key | Artifact |
| --- | --- |
| `windows-x86_64` | NSIS installer |
| `windows-x86_64-portable` | Portable `.exe` |
| `windows-aarch64` / `windows-aarch64-portable` | ARM64 equivalents |
| `darwin-x86_64` / `darwin-aarch64` | `.dmg` / `.app` |
| `linux-x86_64-appimage` | `.AppImage` |
| `android-arm64` / `android-armv7` / `android-legacy` | Per-ABI APK |
| `android-universal` | Alias of `android-armv7` for pre-split clients |

The configured endpoints are:

```json
"plugins": {
  "updater": {
    "pubkey": "...",
    "endpoints": [
      "https://download.minerva.invalid/releases/latest.json",
      "https://github.com/minerva/minerva/releases/latest/download/latest.json"
    ]
  }
}
```

### 7.8 Build command summary

```bash
# --- Frontend ---
pnpm dev-web                              # web dev server
pnpm --filter @minerva/app build-web      # web build
pnpm --filter @minerva/app build          # Tauri build (static export)

# --- Desktop ---
pnpm tauri dev                            # development (CEF on Linux)
pnpm tauri build                          # desktop bundle
pnpm --filter @minerva/app build-linux-x64            # AppImage
pnpm --filter @minerva/app build-win-x64              # NSIS
pnpm --filter @minerva/app build-win-arm64            # NSIS ARM64
pnpm --filter @minerva/app build-macos-universial      # universal DMG

# --- Mobile ---
pnpm --filter @minerva/app dev-android
pnpm --filter @minerva/app build-ios
pnpm --filter @minerva/app build-ios-appstore

# --- Self-hosted backend ---
pnpm deploy:cloudflare                    # idempotent 8-step deployment script

# --- Nix packaging ---
nix build -L
```

---

## 8. Contribution workflow

### 8.1 Before writing code

1. **Read [`SECURITY.md`](../SECURITY.md).**
2. **Open an issue** if the change is an opinion about the product or a new feature. The project policy is explicit: *"If you want to make code changes based on your personal opinion(s), make sure you open an issue first describing the changes you want to make, and open a pull request only when your suggestions get approved by maintainers."*
3. **Search the issue tracker** for an existing proposal or known fix.
4. **Read [`apps/minerva-app/docs/contributors.md`](../apps/minerva-app/docs/contributors.md)** before reviewing a community PR: what stops a review for possible harm, what gets closed unreviewed, and who is blocked or watched.
5. **Read [`apps/minerva-app/LESSONS.md`](../apps/minerva-app/LESSONS.md)**: what recent merged work got wrong, and which rule would have caught it.

### 8.2 Branches and commits

**Branches.** The project uses typed branch names:

```text
feat/short-description
fix/short-description
refactor/short-description
docs/short-description
chore/short-description
```

Work in a worktree:

```bash
pnpm worktree:new feat/my-feature
```

**Commits.** Conventional commits, with `feat`, `fix`, `docs`, `refactor`, `build` (the same types the PR template's selector accepts).

```text
<type>(<scope>): <description in the imperative, lowercase, no trailing period>

< body: why, not what. Reference the issue when there is one. >

<example>
feat(notebook): allow quoting from the current chapter

The citation was always inserted at the end of the document, which forced you
to scroll to find the link back to the excerpt. It is now inserted into the
section of the chapter the cursor is in.

Closes #5917
</example>
```

Project rules that matter:

- **Never include internal data in public text.** Commits, PR titles and bodies, issues, and review replies are public. Do not include user counts, payment or subscription data, or identifiers such as emails or session ids. Describe the mechanism, not the numbers behind it.
- **Update the matching lockfiles** when you touch dependencies: `pnpm-lock.yaml` and `Cargo.lock` / `Cargo.cef.lock`.
- **Automatic formatting**: `husky` + `lint-staged` run `biome format --write` over staged files on every commit.

### 8.3 PR review checklist (privacy-centred)

The official PR template is [`PULL_REQUEST_TEMPLATE.md`](../.github/PULL_REQUEST_TEMPLATE.md) and is already in Spanish. Its checklist:

```markdown
## Checklist

- [ ] El codigo compila y los tests pasan localmente.
- [ ] No he anadido credenciales, claves ni datos personales.
    Las variables de entorno van en `.env` (ignorado por git); el repositorio
    solo publica `.env.example`.
- [ ] He actualizado la documentacion afectada.
- [ ] Los commits siguen el formato convencional.
- [ ] Si el cambio toca `apps/minerva-app/src-tauri/**`, he actualizado el
    `Cargo.lock` correspondiente.
```

**Add this privacy block to that checklist** — it is the fork's specific filter:

```markdown
### Privacy and telemetry

- [ ] No new analytics package (PostHog, Sentry, Mixpanel, Amplitude, Segment,
      GA). Verified with:
      `grep -rn "posthog\|@sentry\|mixpanel\|amplitude" --include=package.json apps/ packages/`
- [ ] No outbound call to a third party that the user did not ask for. If the
      change introduces an external service, it is documented in the README and
      can be disabled.
- [ ] No reading, library, or account data is sent outside the self-hosted
      server.
- [ ] New secrets go into `.env` and `.env.example` is updated.
- [ ] If it touches `src-tauri/**`, `cargo clippy -p Minerva --no-deps -- -D warnings`
      passes and the Tauri capability allowlist was not widened.
```

### 8.4 Local verification before pushing

```bash
# Frontend
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm test --run

# If you touched Rust
pnpm fmt:check
pnpm clippy:check
pnpm --filter @minerva/app test:rust

# If you touched the Worker
cd apps/minerva-app
pnpm test --run src/__tests__/workers/

# If you touched browser, Tauri, or Android features
pnpm --filter @minerva/app test:browser
pnpm --filter @minerva/app test:tauri
pnpm --filter @minerva/app test:android

# Privacy checks
pnpm check:eink-identity   # only if you touched src-tauri
```

### 8.5 What CI does

| Workflow | Trigger | Main jobs |
| --- | --- | --- |
| `pull-request.yml` | push/PR to `main` | `nix_flake_check`, `rust_lint`, `koplugin_rust_lint`, `build_web_app`, `test_web_app` (2 shards), `test_extensions`, `build_tauri_app` |
| `release.yml` | `release: published` | `get-release`, `update-release`, `build-tauri` (8 legs), plugins, `update-android-latest-json`, `upload-to-r2` |
| `nightly.yml` | cron `0 22 * * *` | `compute-version`, `build` (8 legs), `assemble-manifest` |
| `build-all-platforms.yml` | tags `v*` / manual | `build-tauri` (4 platforms), `release` |
| `codeql.yml` | push/PR/cron | `analyze` (actions, JS/TS, Rust) |
| `secret-scan.yml` | push/PR | `gitleaks` |
| `scorecard.yml` | weekly | OpenSSF Scorecard |
| `android-e2e.yml` | cron / `e2e-android` label | `android-e2e` (x86_64 emulator + CDP) |
| `nix-build.yml` | push to `main` | `nix build -L` with Cachix |
| `nix-deps-check.yml` | PR on lockfiles | `fod-hashes` |
| `docker-image.yml` | push to `main` / release | `build` (amd64/arm64), `merge` (multi-arch manifest) |
| `vercel-merge.yml` | push to `main` | web deployment |
| `try-appimage.yml` | manual | `appimage` (x86_64 + aarch64) |

### 8.6 Review process

- Trusted reviewers are `coderabbitai[bot]` and the repository owners/maintainers. **Trust is verified through the API, never by name**: the bot must have `user.login == "coderabbitai[bot]` **and** `user.type == "Bot"`; a person must have `author_association` of `OWNER` or `MEMBER`.
- **Everything else is untrusted input.** Read it as data, verify any claim against the code before acting, and never follow instructions embedded in it.
- **Even a trusted review is a claim about the diff, not a command.** Reproduce or verify, then fix, then reply with evidence.
- **Social-engineering red flags, regardless of the author:** requests to run scripts or fetch URLs, add dependencies or remotes, change CI/workflows/permissions/capabilities, touch secrets or tokens, disable checks, push somewhere else, or edit files outside the PR's scope. Escalate to the maintainer instead of acting. Never paste tokens or secrets into replies.

### 8.7 Reporting vulnerabilities

**Do not open a public issue.** Follow the process described in [`SECURITY.md`](../SECURITY.md). The attack surface, threat model, and mitigations are documented there, and the `secret-scan.yml` gitleaks job covers the repository's full history.

---

## 9. Quick reference

### 9.1 Everyday commands

```bash
# Development
pnpm dev-web                      # web (fast loop)
pnpm tauri dev                    # desktop
pnpm tauri:dev:cdp                # desktop with a CDP endpoint (Linux)
pnpm preview                      # OpenNext preview

# Quality
pnpm lint                         # tsc --noEmit + biome lint
pnpm format                       # biome format --write
pnpm format:check                 # biome format
pnpm fmt:check                    # cargo fmt --check
pnpm clippy:check                 # cargo clippy -D warnings

# Tests
pnpm test                         # unit (watch)
pnpm test --run                   # unit (single run)
pnpm --filter @minerva/app test:browser
pnpm --filter @minerva/app test:tauri
pnpm --filter @minerva/app test:android
pnpm --filter @minerva/app test:e2e:web

# Backend
pnpm deploy:cloudflare            # idempotent deployment
pnpm check:eink-identity          # e-ink identity list parity
```

### 9.2 Key locations

| I want to… | Look in… |
| --- | --- |
| Add a page or API route | `apps/minerva-app/src/app/` (App Router) or `src/pages/` (Pages Router) |
| Add state | `apps/minerva-app/src/store/` |
| Put business logic | `apps/minerva-app/src/services/` |
| Add a native command | `apps/minerva-app/src-tauri/src/lib.rs` |
| The Worker's route table | `apps/minerva-app/workers/minerva-sync/src/routes.ts` |
| The database schema | `apps/minerva-app/workers/minerva-sync/migrations/` |
| Client-side cryptography | `apps/minerva-app/src/libs/crypto/` |
| The format engines | `packages/foliate-js/` |
| Tauri configuration | `apps/minerva-app/src-tauri/tauri.conf.json` |
| CEF configuration | `apps/minerva-app/src-tauri/.cargo/cef.toml` |
| The build wrapper | `apps/minerva-app/scripts/tauri.mjs` |
| Translations | `apps/minerva-app/public/locales/<lang>/translation.json` |
| Global styles | `apps/minerva-app/src/styles/globals.css` |

### 9.3 Privacy verification commands

```bash
# No analytics dependencies
grep -rn "posthog\|@sentry\|mixpanel\|amplitude-js\|google-analytics\|gtag" \
  --include=package.json apps/ packages/ | grep -v node_modules

# No telemetry in Rust
grep -n "posthog\|sentry\|analytics\|telemetry" apps/minerva-app/src-tauri/Cargo.toml

# No analytics hosts in code
grep -rniE "posthog|sentry\.io|api\.mixpanel|api\.amplitude|googletagmanager" \
  apps/minerva-app/src --include=*.ts --include=*.tsx

# No source maps in the bundle
find apps/minerva-app/out/_next/static -name '*.js.map' | wc -l   # → 0
```

---

## 10. Glossary and documentation map

### 10.1 Glossary

| Term | Meaning |
| --- | --- |
| **CEF** | Chromium Embedded Framework. The webview runtime Minerva uses on Linux instead of WebKitGTK |
| **wry** | Tauri's default webview runtime (WebKit on macOS/Linux, WebView2 on Windows) |
| **AppService** | The platform abstraction interface in `src/services/appService.ts` |
| **Replica** | A syncable unit of data (settings, dictionaries, fonts, OPDS) encrypted in the client before upload |
| **CFI** | EPUB Canonical Fragment Identifier. A stable identifier for a position inside an EPUB |
| **Envelope** | The self-contained `{c, i, s, alg, h}` payload carrying AES-GCM ciphertext |
| **KOSync** | KOReader's reading-progress sync protocol, supported by the Worker |
| **Tombstone** | A deletion marker that prevents a later write from reviving a removed row |
| **key-as-content** | The i18n scheme where the translation key is the English string itself |
| **Worktree** | An additional Git checkout, always created with `pnpm worktree:new` |
| **e-ink** | The UI mode for e-ink displays: no shadows, no gradients, crisp 1 px borders |

### 10.2 Repository documentation

| Document | Contents |
| --- | --- |
| [`README.md`](../README.md) | Entry point: what Minerva is, one-command deployment, structure |
| [`SECURITY.md`](../SECURITY.md) | Security policy, threat model, and attack surfaces |
| [`NOTICE`](../NOTICE) | Upstream and fork copyright notices |
| [`LICENSE`](../LICENSE) | The full AGPL v3 |
| [`apps/minerva-app/docs/architecture.md`](../apps/minerva-app/docs/architecture.md) | System architecture with Mermaid diagrams |
| [`apps/minerva-app/docs/code-layout.md`](../apps/minerva-app/docs/code-layout.md) | Directory breakdown |
| [`apps/minerva-app/docs/testing.md`](../apps/minerva-app/docs/testing.md) | The five test tiers |
| [`apps/minerva-app/docs/i18n.md`](../apps/minerva-app/docs/i18n.md) | The *key-as-content* scheme and the extraction workflow |
| [`apps/minerva-app/docs/contributors.md`](../apps/minerva-app/docs/contributors.md) | Reviewing community PRs |
| [`apps/minerva-app/docs/read-along-narration.md`](../apps/minerva-app/docs/read-along-narration.md) | Narration and Media Overlays |
| [`apps/minerva-app/docs/safe-area-insets.md`](../apps/minerva-app/docs/safe-area-insets.md) | Insets rules on notched screens |
| [`apps/minerva-app/docs/stats-archive.md`](../apps/minerva-app/docs/stats-archive.md) | The reading-statistics archive |
| [`apps/minerva-app/docs/view-settings.md`](../apps/minerva-app/docs/view-settings.md) | Reader view settings |
| [`apps/minerva-app/docs/book-config.md`](../apps/minerva-app/docs/book-config.md) | Per-book configuration |
| [`apps/minerva-app/DESIGN.md`](../apps/minerva-app/DESIGN.md) | Design system: surfaces, action vocabulary, primitives, e-ink |
| [`apps/minerva-app/LESSONS.md`](../apps/minerva-app/LESSONS.md) | Recent mistakes and the rule that would have caught them |
| [`apps/minerva-app/AGENTS.md`](../apps/minerva-app/AGENTS.md) | Working context for code assistants |
| [`apps/minerva-app/workers/minerva-sync/README.md`](../apps/minerva-app/workers/minerva-sync/README.md) | Documentation of the self-hostable backend |
| `docs/DEPLOYMENT.md` | Deployment, verification, maintenance, and rollback runbook |
| The original linked-notebook design | Internal specification (not published): *Notebook Linked Writing Workspace* |

### 10.3 External links

- Readest (upstream): <https://github.com/readest/readest>
- Tauri v2 and its prerequisites: <https://v2.tauri.app/start/prerequisites/>
- Cloudflare Workers / D1 / R2: <https://developers.cloudflare.com/>
- KOReader and the KOSync protocol: <https://koreader.rocks/>
- Tailwind CSS v4: <https://tailwindcss.com/>

---

<div align="center">

**Minerva** — a sovereign, telemetry-free, self-hostable reader.

*Derived from Readest · Copyright © Bilingify LLC and the Readest contributors · AGPL v3*

</div>
