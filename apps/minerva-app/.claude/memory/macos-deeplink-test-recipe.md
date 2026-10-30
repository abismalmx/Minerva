---
name: macos-deeplink-test-recipe
description: How to verify minerva:// deep links against the installed macOS app from the shell (routing trap + window-title probe)
metadata:
  node_type: memory
  type: reference
  originSessionId: cc5e7012-1f55-4d68-9267-b38ec2f5f8d8
  modified: 2026-09-29T17:35:53.571Z
---

Used for #6378 (reporter used unsupported `minerva://open/<hash>`; closed as not-a-bug, `minerva://book/<hash>` VERIFIED 6/6 on 0.12.10 2026-09-30).

- Hundreds of stale `Minerva.app` copies (mounted dmgs, sim builds, `target/*/bundle`) register `minerva:` in LaunchServices, with no per-user LSHandlers override. Use `open -a /Applications/Minerva.app "minerva://..."` to pin the target. Plain `/usr/bin/open` happened to hit /Applications too.
- Probe the result without screenshots: `osascript -e 'tell application "System Events" to get name of every window of (first process whose unix id is <pid>)'` gives "Minerva - <book title>" in the reader.
- Book hashes and titles: `~/Library/Application Support/com.minerva.app/Minerva/Books/library.json`.
- Unknown `minerva://` routes are silently dropped (no toast). A toast was declined because the routes are owned by several separate hooks.
