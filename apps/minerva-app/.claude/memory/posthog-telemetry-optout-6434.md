---
name: posthog-telemetry-optout-6434
description: "SUPERSEDED by telemetry-removed-2026-11 (2026-11-09): PostHog was fully removed from this fork. Kept as a historical record of the consent/opt-out design that no longer exists."
metadata:
  node_type: memory
  type: project
  originSessionId: 0aa90bd9-2e78-4ce3-b0ab-a92740bc9285
  modified: 2026-09-28T16:28:37.415Z
---

> **SUPERSEDED (2026-11-09).** PostHog was removed from this fork entirely — the
> SDK, the consent dialog, the `telemetryEnabled` setting and the CI secret
> injection are all gone. See [telemetry-removed-2026-11.md](telemetry-removed-2026-11.md).
> Nothing below describes the current code; it is kept as a historical record of
> the opt-out design that was implemented and later removed.

PR #6434 (itsmunzir, for #6422) moves `posthog.init` behind the boot consent decision (`initPostHog` in PHContext, called from Providers after `finalizeTelemetryDecision`) and turns off flags, external deps, recording, and surveys. Follow-up commit 978a37745 was pushed to the fork on 2026-09-29, and the PR MERGED as 2fd17538b.

Traps verified against posthog-js 1.373.2 in jsdom:
- `posthog.opt_in_capturing()` with no args sends a `$opt_in` event (send_instantly). Restoring consent at boot must pass `{ captureEventName: false }`.
- Calls made before init (identify, captureException, capture) are silently dropped. Consent calls made before init write a token-less `__ph_opt_in_out_` key.
- An opted-out init with the 4 disable flags makes zero network requests.

**Decision (chrox):** Sentry crash reports are NOT part of the "Help improve Minerva" analytics switch. Leave the Rust, Android, and iOS Sentry init alone.
**Why:** crash reporting is separate from usage analytics, and the early native init catches startup crashes.
**How to apply:** reject PRs that gate Sentry on `telemetryEnabled`.
