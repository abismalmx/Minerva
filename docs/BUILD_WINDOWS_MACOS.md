# Building Minerva for Windows and macOS

Status of the three desktop/mobile targets, and how to reproduce them. Written
after producing the v1.0.5 artifacts on a Fedora 44 x86_64 host.

| Target  | Artifact                                | Where it was produced |
| ------- | --------------------------------------- | ---------------------- |
| Linux   | `Minerva-1.0.5-x86_64.AppImage` (CEF)  | this host, `appimagetool` |
| Android | `Minerva-1.0.5.apk` (arm64-v8a)         | this host, NDK 28.2.13676358 |
| Windows | `minerva.exe` + portable ZIP            | this host, mingw-w64 cross |
| macOS   | —                                        | requires a macOS host (see below) |

## Windows

### Cross-compiling the executable on Linux

The Rust target is `x86_64-pc-windows-gnu`. The build needs a mingw-w64
toolchain; on this host it lives in a container (`localhost/minerva-mingw`),
reached through wrappers in `~/.local/bin`:

| Wrapper                              | Used by |
| ------------------------------------ | ------- |
| `x86_64-w64-mingw32-gcc`             | the C compiler the `cc` crate drives |
| `x86_64-pc-windows-gnu-gcc`          | rustc's linker and `CC_x86_64_pc_windows_gnu` |
| `x86_64-w64-mingw32-{ar,ranlib,dlltool,windres,objcopy,strip}` | the `windows-link` crate, `tauri-winres` |

Two details the wrappers need, both easy to get wrong:

- **The mounts have to be wider than `$PWD`.** The `cc` crate compiles C
  sources that live in `~/.cargo/registry`, so a wrapper that only mounts the
  working directory fails with `cc1: fatal error: .../zstd-sys-.../zstd.h: No
  such file or directory`. Mount `/home/lord` and `/tmp` instead.
- **`--security-opt label=disable` is required.** Without it SELinux denies the
  container read access to the host paths (`Permission denied`).

Environment for the build:

```bash
export CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER="$HOME/.local/bin/x86_64-pc-windows-gnu-gcc"
export CC_x86_64_pc_windows_gnu="$HOME/.local/bin/x86_64-pc-windows-gnu-gcc"
export AR_x86_64_pc_windows_gnu="$HOME/.local/bin/x86_64-pc-windows-gnu-ar"
cd apps/minerva-app
node node_modules/@tauri-apps/cli/tauri.js build --target x86_64-pc-windows-gnu --no-bundle
```

Use the CLI directly rather than `pnpm tauri`: `scripts/tauri.mjs` sends
Linux to the CEF runtime (`--features cef --no-default-features --config
src-tauri/.cargo/cef.toml`), and CEF is Linux-only. A Windows build wants the
wry runtime, which is what every non-Linux platform gets.

### The thumbnail DLL is a separate crate

`src-tauri/tauri.windows.conf.json` is merged automatically on a Windows build
and adds `../extensions/windows-thumbnail/target/windows_thumbnail.dll` as a
bundle resource. The bundler fails if that file is missing, so build it first:

```bash
cd apps/minerva-app/extensions/windows-thumbnail
cargo build --release --target x86_64-pc-windows-gnu
cp target/x86_64-pc-windows-gnu/release/windows_thumbnail.dll target/windows_thumbnail.dll
```

It is a `cdylib` whose only imports are system DLLs, so Explorer can load it
without a mingw runtime next to it.

### The NSIS installer needs a Windows host

`tauri build --bundles nsis` cannot run here, for two independent reasons:

1. **The bundler is compiled per host.** `tauri-cli` only adds `BundleType::Nsis`
   to its `--bundles` values on a Windows build, so on Linux the flag only
   offers `deb`, `rpm` and `appimage`.
2. **NSIS itself is Windows-only here.** `tauri-bundler` downloads NSIS 3.11
   and runs `makensis.exe`; the template and this project's
   `src-tauri/nsis/installer-hooks.nsh` use `System::Call`, which needs the
   Windows `System.dll` plugin. A Linux `makensis` cannot load it.

To produce the installer, run the build on Windows:

```bash
pnpm tauri build --target x86_64-pc-windows-msvc --bundles nsis
```

That is what `.github/workflows/release.yml` does on its `windows-latest` legs
(`x86_64-pc-windows-msvc` and `aarch64-pc-windows-msvc`). The installer
embeds the WebView2 bootstrapper (`bundle.windows.webviewInstallMode`), and
the NSIS hooks register the thumbnail/preview handler DLL.

For a distributable that does not need an installer, the portable ZIP built
here contains the executable plus its runtime dependencies.

## macOS

**A macOS build cannot be produced from Linux.** Four blockers, each fatal on
its own:

1. **The macOS SDK is not available.** The app links Apple's frameworks
   (`objc2` 0.6, `objc2-foundation` 0.3, `objc2-authentication-services` 0.3,
   `cocoa` 0.25, `dispatch2` 0.3), and `src-tauri/src/macos/` plus 74
   `cfg(target_os = "macos")` sites need the AppKit/Foundation/WebKit/
   AuthenticationServices headers. `zig cc` does not ship an macOS SDK, and
   `osxcross` needs an SDK you supply yourself (from Xcode, on a Mac).
2. **Signing is macOS-only.** `codesign` needs the Developer ID Application
   certificate; the profile the build expects is in the repo
   (`src-tauri/profiles/MinervaDeveloperID.provisionprofile`) but the private
   key is a CI secret.
3. **Notarization is macOS-only.** `xcrun notarytool` / `altool` do not exist
   on Linux. `tauri-action` drives them from the `APPLE_CERTIFICATE`,
   `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD` and `APPLE_TEAM_ID`
   secrets.
4. **The bundlers are compiled per host.** `tauri-cli` only offers
   `BundleType::Dmg` and `BundleType::App` on a macOS build, and both need
   `create-dmg` / `appdmg`, which are macOS tools.

On a macOS host the build is:

```bash
pnpm tauri build -t universal-apple-darwin --bundles dmg \
  --config src-tauri/tauri.macos-nonestore.conf.json
```

`universal-apple-darwin` needs both `aarch64-apple-darwin` and
`x86_64-apple-darwin` Rust targets. The non-store config adds the iCloud
entitlements (`src-tauri/profiles/direct-entitlements.plist`) and embeds the
provisioning profile.

### The App Store lane is missing its config

`package.json` points `build-macos-universial-appstore` and
`build-macos-universial-appstore-dev` at `src-tauri/tauri.appstore.conf.json`
and `src-tauri/tauri.appstore-dev.conf.json`, and
`scripts/release-mac-appstore.sh` edits `src-tauri/tauri.appstore.conf.json`.
**None of those three files exist** in the repository — only
`tauri.conf.json`, `tauri.macos-nonestore.conf.json` and
`tauri.windows.conf.json` are present. The macOS App Store build therefore
fails before it starts, on any host.

## Gaps in `.github/workflows/build-all-platforms.yml`

That workflow builds the four targets on native runners, which is the right
shape: Windows needs a Windows host for the NSIS bundler, macOS needs a macOS
host for the SDK and the signing tools, and Android needs the NDK. Two things
in it will not work as written:

- **The Windows leg does not build the thumbnail DLL.**
  `src-tauri/tauri.windows.conf.json` is merged automatically for a Windows
  build and lists `../extensions/windows-thumbnail/target/windows_thumbnail.dll`
  as a bundle resource, so the bundler fails on a missing file. The leg needs
  the extra step from [the thumbnail DLL section](#the-thumbnail-dll-is-a-separate-crate).
- **The desktop artifact paths do not exist.** `src-tauri` is a member of the
  workspace at the repository root, so cargo writes to `target/` at the root;
  `apps/minerva-app/src-tauri/target/` is never created. The upload paths
  have to be `target/**/bundle/**`. The Android path is fine, since the
  Gradle output really is under `src-tauri/gen/android/app/build/`.

## The Cargo.lock is stale, and that breaks the desktop builds

`Cargo.lock` records `Minerva 0.2.2` while `package.json` says `1.0.5`, so
cargo re-resolves the whole graph on every build. Two consequences:

- `tauri` lands on the newest crates.io release (2.12.x) instead of the 2.11.5
  the `@tauri-apps/api` 2.11.1 packages expect, and `tauri build` then fails
  its own version check:
  `tauri (v2.12.2) : @tauri-apps/api (v2.11.1)`.
- The re-resolved graph does not compile on Windows. `tauri` 2.12 pulls
  `windows` 0.62 while `tauri-plugin-sharekit` 0.3.1 is on `windows` 0.61, and
  `tauri-plugin` 2.7 uses `schemars` 0.8 while the `feat/cef` branch uses
  `schemars` 1, so the scoped plugins fail with `expected Schema, found
  RootSchema`.

The working graph is the one the committed lock describes, pinned to the
versions the npm packages expect. To reproduce it:

```bash
# 1. the lock's only stale field is the package version
#    Minerva 0.2.2 -> 1.0.5

# 2. the plugins have to sit at the versions the npm packages expect, which
#    are older than the newest crates.io release. Otherwise cargo prefers the
#    newer release and the schemars 0.8/1 split reappears (see
#    src-tauri/.cargo/cef.toml)
cargo update -p tauri-plugin-biometric --precise 2.3.2
cargo update -p tauri-plugin-clipboard-manager --precise 2.3.2
cargo update -p tauri-plugin-deep-link --precise 2.4.9
cargo update -p tauri-plugin-dialog --precise 2.7.1
cargo update -p tauri-plugin-fs --precise 2.5.2
cargo update -p tauri-plugin-haptics --precise 2.3.2
cargo update -p tauri-plugin-http --precise 2.6.0
cargo update -p tauri-plugin-log --precise 2.9.1
cargo update -p tauri-plugin-opener --precise 2.5.4
cargo update -p tauri-plugin-os --precise 2.3.2
cargo update -p tauri-plugin-persisted-scope --precise 2.3.7
cargo update -p tauri-plugin-process --precise 2.3.1
cargo update -p tauri-plugin-cli --precise 2.4.1
cargo update -p tauri-plugin-shell --precise 2.3.5
cargo update -p tauri-plugin-single-instance --precise 2.4.2
cargo update -p tauri-plugin-updater --precise 2.11.0
cargo update -p tauri-plugin-window-state --precise 2.4.1
cargo update -p tauri-plugin-websocket --precise 2.4.2

# 3. tauri-plugin has to sit on the release that matches tauri 2.11.5
cargo update -p tauri-plugin --precise 2.6.3

# 4. only now can tauri itself go back to 2.11.5: the newer plugins require
#    tauri ^2.12 and would hold it there
cargo update -p tauri --precise 2.11.5
```

Order matters. `tauri-plugin-fs` carries `links = "tauri-plugin-fs"`, so cargo
refuses to keep two copies of it, and `cargo update` accepts only one
`--precise` version per invocation: the scoped plugins have to move before
`tauri-plugin-fs` does, and `tauri` last.

Once the lock is in that state, `cargo metadata --locked` succeeds and
`tauri build` passes its version check without
`--ignore-version-mismatches`.
