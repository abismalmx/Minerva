---
name: telemetry-removed-2026-11
description: "PostHog and Sentry were fully REMOVED from Minerva (2026-11-09). No telemetry, no crash reporting, no consent UI. Supersedes posthog-telemetry-optout-6434 and sentry-crash-reporting-4914."
metadata:
  node_type: memory
  type: project
---

**PostHog and Sentry no longer exist in this fork.** Everything that could send
data off-box was deleted on 2026-11-09, not merely disabled:

- **PostHog**: `posthog-js` dependency, `src/context/PHContext.tsx`,
  `src/utils/telemetry.ts`, `src/components/TelemetryConsentDialog.tsx` — all
  deleted. `posthog.captureException` (`src/app/error.tsx`),
  `posthog.capture('checkout_error')` (`src/libs/payment/stripe/client.ts`),
  `posthog.identify` (`src/context/AuthContext.tsx`) — all removed. The
  `telemetryEnabled` setting, its Settings toggle, and its command-palette
  entry are gone.
- **Sentry**: the `sentry` crate + `tauri-plugin-sentry` (Rust),
  `io.sentry:sentry-android` (Android, auto-init ContentProvider), the
  `sentryDsn` manifest placeholder, `src-tauri/src/sentry_config.rs`,
  `build.rs::propagate_sentry_dsn`, the `set_webview_info` command, the
  `sentry:default` capability, and the `*.sentry.io` / `*.posthog.com` CSP
  entries — all removed. `Cargo.lock` and `Cargo.cef.lock` regenerated.
- **CI**: `release.yml`, `nightly.yml` and `try-appimage.yml` no longer inject
  `NEXT_PUBLIC_POSTHOG_*` / `SENTRY_*` secrets, so a release build cannot
  re-enable telemetry even if those GitHub secrets still exist. Delete the
  secrets themselves.
- `scripts/upload-sourcemaps.mjs` became `scripts/strip-sourcemaps.mjs`: it
  still deletes `.js.map` files from the app bundle, but no longer uploads them.

**Superseded:** `posthog-telemetry-optout-6434.md` (the consent/opt-out design)
and `sentry-crash-reporting-4914.md` (the Sentry setup). Their "how to apply"
notes are void — the decision they record was reversed for this fork.

**Why:** the fork's whole premise is a self-hosted, privacy-preserving reader
with no dependency on Readest-operated or third-party infrastructure. A
switch that silently re-enables telemetry when a CI secret happens to be set is
not a privacy guarantee.

**How to apply:** do not reintroduce PostHog, Sentry, or any analytics SDK.
Do not gate crash reporting on a settings toggle either — there is no crash
reporting. If a future feature needs usage stats, they belong in the operator's
own backend (the `minerva-sync` Worker), never a third-party endpoint.
