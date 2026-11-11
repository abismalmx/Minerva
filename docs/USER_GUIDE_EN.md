# Minerva User Guide and Manual

**Version:** 1.0.5 · **License:** AGPL-3.0 · **Guide languages:** English (this) · [Español](USER_GUIDE_ES.md)

> This guide describes the actual behaviour of the application built from this
> repository. Menu, button and option names are quoted as they appear in the
> interface, which is written in English because that is the language the code
> was written in.

---

## Table of contents

1. [What Minerva is](#1-what-minerva-is)
2. [Installation and first launch](#2-installation-and-first-launch)
3. [Managing the library](#3-managing-the-library)
4. [The reading experience](#4-the-reading-experience)
5. [The Notebook and your notes](#5-the-notebook-and-your-notes)
6. [Contextual image search](#6-contextual-image-search)
7. [Continue reading and keyboard shortcuts](#7-continue-reading-and-keyboard-shortcuts)
8. [Differences from Readest](#8-differences-from-readest)
9. [Frequently asked questions (FAQ)](#9-frequently-asked-questions-faq)
10. [Troubleshooting by operating system](#10-troubleshooting-by-operating-system)
11. [Quick reference](#11-quick-reference)

---

## 1. What Minerva is

### 1.1 In one sentence

Minerva is a **cross-platform ebook reader** — desktop, mobile and web — that
works **without a mandatory account, without telemetry switched on, and without
depending on a proprietary cloud service**.

### 1.2 Where it comes from

Minerva is a **fork** of [Readest](https://github.com/readest/readest), the
ebook reader by Readest's authors. Both the original work and Minerva's
modifications are distributed under the **GNU AGPL v3**, and the original
copyright notices are preserved in the [`NOTICE`](../NOTICE) file, as the
license requires.

The fork is not a rename. It changes the **product model**.

| | Readest (upstream) | Minerva |
| --- | --- | --- |
| Account | Required to use the hosted service | **Optional**. The app works without one |
| Backend | The project's hosted service | **Yours**: Cloudflare Workers + D1 + R2 |
| Telemetry | Collected by default | **Explicit opt-in**, with 90 % of new installs already opted out |
| Visual identity | The Readest brand | Its own identity: Minerva, bronze and gold on warm neutrals |
| Sensitive data | — | **Client-side encrypted** with a passphrase the server never sees |

### 1.3 Philosophy

Four principles explain almost every decision in the project.

**1 · Independence.** Minerva does not depend on a company. The backend is
three Cloudflare resources you can create with your own account (a Worker, a D1
database and an R2 bucket) with a single command:

```bash
./deploy-cloudflare.sh
```

The script creates whatever is missing, generates the secret, applies the
migrations, publishes the Worker and leaves the app configured. It also speaks
the **KOSync** protocol, so **KOReader** can use the same server.

**2 · Privacy by construction, not by policy.** The sensitive fields you sync
are encrypted **before they leave the device**, with a key derived from your
*sync passphrase*. The server stores the salt and the ciphertext, and **cannot
recover your passphrase**. On top of that, the app talks to **your** Worker:
there is no traffic toward third parties.

**3 · No telemetry, no silent tracking.** Instrumentation is **opt-in**: the
telemetry SDK does not even start without a configured key, and when it does
start, capture is disabled unless the user has explicitly accepted it. On first
run, 90 % of new installs are automatically **opted out**; only the remaining
10 % are asked. The decision is stored and honoured forever: a recorded
opt-out always beats a stale `true` in the settings file.

**4 · No bloat.** The fork focused on **self-hosted storage** and dropped the
weight of the hosted service: the file that carried the upstream project's
public credentials (Supabase, Stripe, PostHog and Pagebound embedded in the
source) was deleted, environment variables went from over a hundred to the
nine a self-hosted deployment needs, and the hosted-service account scripts
were removed. The Calibre plugin and the KOReader *koplugin* no longer carry
any credential from the original service.

### 1.4 What it is, and what it is not

| | |
| --- | --- |
| **It is** | A reader for EPUB, PDF, MOBI/AZW3, FB2, CBZ, TXT, HTML and Markdown |
| | A library with shelves, groups, tags, full-text search and your own sync backend |
| | A Markdown notebook tied to each book, with citations that jump back to the exact page |
| | Contextual image search (Wikipedia + Wikimedia Commons) from within the reading view |
| | Multilingual: 35 interface languages, with Spanish and English fully covered |
| **It is not** | A cloud reading service with a mandatory account |
| | A client locked to one backend: the account layer is **optional and replaceable** |
| | A subscription product: on a self-hosted deployment (`SELF_HOSTED=true`) every feature is unlocked |

### 1.5 Formats and platforms

| Supported formats | Platforms |
| --- | --- |
| EPUB · PDF · MOBI · AZW · AZW3 · KF8 · FB2 · CBZ · TXT · MD · HTML · HTM · MHTML · MHT | macOS · Windows · Linux · Android · iOS · Web (PWA) |

`.docx` and `.rtf` files are **converted to EPUB** on import. The `.rbooks`
format is Minerva's own bundle for transferring whole libraries.

---

## 2. Installation and first launch

### 2.1 The 1.0.5 artifacts

| Artifact | Platform | Size |
| --- | --- | --- |
| `Minerva-1.0.5-x86_64.AppImage` | Linux x86_64 | 141 380 088 B |
| `Minerva-1.0.5.exe` | Windows x64 (portable) | 95 532 324 B |
| `Minerva-1.0.5-windows-x86_64.zip` | Windows x64 (portable, compressed) | 50 225 191 B |
| `Minerva-1.0.5.apk` | Android (arm64-v8a) | 57 597 296 B |
| `Minerva-1.0.5-arm64-clean.apk` | Android (arm64-v8a) — the same APK under the delivery name | 57 597 296 B |

SHA-256:

```text
632ac17d3be9c83ac2831db9d7ae30399781d46e27df2be1c323bc067bb0a97a  Minerva-1.0.5-x86_64.AppImage
9e7534e6d277af78e728aaea374f7ace408410c99f1c5c114d133923881b6c2b  Minerva-1.0.5.exe
8674c297b80afbe16198dbc4485c589c251dbc16bb0a15e64b6136c0bb5e3156  Minerva-1.0.5-windows-x86_64.zip
396bd5bb903bccfcdfda1bd9c8e93052e462495fd80e1f788345478a5b4a9e99  Minerva-1.0.5.apk
396bd5bb903bccfcdfda1bd9c8e93052e462495fd80e1f788345478a5b4a9e99  Minerva-1.0.5-arm64-clean.apk
```

The APK is signed with the **Android debug key** (v2 and v3 signature
schemes), so it installs straight away with "allow unknown sources". It is
not signed with a release key, so Android identifies it as a debug app. It
is the **same** key the previous 1.0.5 was signed with, so you can install
it on top without uninstalling first. On Windows the `.exe` runs, but
SmartScreen will show it as *unknown publisher*.

> **Neutral, sovereign binaries.** All four artifacts were compiled **without
> any third-party or personal URL baked in**: there is no
> `NEXT_PUBLIC_API_BASE_URL` burnt into the bundle, no third-party account
> configured, no analytics endpoint. The only origin that appears is the
> `https://tu-worker.workers.dev` placeholder in the sign-in form. That is
> why the binary works **100 % offline** (read, annotate, library, export)
> and never talks to a service you did not pick yourself.
>
> The frontend travels **brotli-compressed** inside the binary, so a `strings`
> over the `.exe` sees neither the URL it carries nor any other one. The
> check on the artifact is done by decompressing it, which is what the
> project's verification tool does (see
> [6.5.2.1 Neutrality verification of the final artifact](DEVELOPER_GUIDE_EN.md#6521-neutrality-verification-of-the-final-artifact)).
>
> **About Linux:** the 1.0.5 AppImage uses the **WRY** runtime (WebKitGTK) and
> ships the engine inside the package itself, hence its size.
>
> **The previous batch of binaries was withdrawn:** it was compiled **before**
> the telemetry-eradication commit (`06f838a`) and still carried the Sentry SDK
> inside. This batch is compiled from the clean commit and verified before it
> is published (see
> [6.5.5 Binary verification of the artifact](DEVELOPER_GUIDE_EN.md#655-level-5--binary-verification-of-the-artifact)).
>
> The desktop packages (AppImage, installer and Windows portable, universal
> macOS DMG) are rebuilt in CI from the clean commit with
> [build-all-platforms.yml](https://github.com/minerva/minerva/actions/workflows/build-all-platforms.yml).

### 2.2 Linux (AppImage)

The AppImage is a single, self-contained file: no installation required.

```bash
# 1. Make it executable
chmod +x Minerva-1.0.5-x86_64.AppImage

# 2. Run it
./Minerva-1.0.5-x86_64.AppImage
```

To add it to the application menu, move it to `~/Applications/` or `/opt/` and
install its `.desktop` file:

```bash
sudo install -Dm755 Minerva-1.0.5-x86_64.AppImage /opt/minerva/minerva.appimage
install -Dm644 squashfs-root/minerva.desktop \
  ~/.local/share/applications/minerva.desktop
update-desktop-database ~/.local/share/applications 2>/dev/null
```

The bundled `.desktop` file declares MIME associations for EPUB, MOBI, AZW,
AZW3, FB2, CBZ, PDF, plain text and Markdown, plus the `x-scheme-handler/
minerva` and `x-scheme-handler/readest` schemes.

> **A note on AppImages:** the package includes a hook
> (`00-no-userns-prompt.hook`) that suppresses the system's warning about
> unconfined user namespaces when the wrapped binary runs.

#### First launch

1. The **library** opens. If it is empty, you get the *Start your library*
   empty state with two options: pick a book from your device, or drop a book
   onto the window.
2. **Settings → Behavior → Privacy** holds the **Help improve Minerva**
   switch. It is off by default on new installations.
3. If you want sync, go to **Settings → Integrations → Minerva Cloud
   (Cloudflare)** and follow [section 9.2](#92-syncing-with-your-own-server).

### 2.3 Windows

There are two ways to install it.

#### Option A — the executable directly

Simply **double-click** `Minerva-1.0.5.exe`. It opens and works with no prior
installation.

> **Requirements:** Windows 10 1809 or later. Minerva uses **WebView2**, the
> system's web engine. It ships preinstalled on Windows 11; on Windows 10 it
> installs itself the first time (and asks you to restart afterwards).

#### Option B — the portable ZIP

`Minerva-1.0.5-windows-x86_64.zip` contains three files:

```
minerva.exe             125 151 037 B   the executable
WebView2Loader.dll        160 880 B   the WebView2 engine loader
minerva_thumbnail.dll   9 343 351 B   Explorer thumbnail extension
```

Unzip the archive into a folder (say `C:\Apps\Minerva`) and run `minerva.exe`.
**Do not move `minerva.exe` out of that folder**: both DLLs must sit next to
it.

#### About `minerva_thumbnail.dll`

This DLL is a Windows shell extension for Explorer that generates thumbnails
and previews for books (EPUB, MOBI, AZW, AZW3, FB2, CBZ) and renders PDF pages
with the native `Windows.Data.Pdf` engine. **It is not required**: remove it
and the app works exactly the same, you only lose the thumbnails. If you leave
it in the folder without registering it, Explorer simply ignores it.

Registration in the Windows registry is done by the **NSIS installer**, which
needs a Windows machine to be produced. See
[`BUILD_WINDOWS_MACOS.md`](BUILD_WINDOWS_MACOS.md) for the procedure.

#### Explorer integration

Without the NSIS installer, you can associate the formats by hand: right-click
an `.epub` → *Open with* → *Choose another app* → *Minerva* → tick *Always*.

### 2.4 Android

The APK is built for **arm64-v8a** (Android 8.0 / API 26 and later). The APK
from this batch is **unsigned**; use `Minerva-1.0.5-debug-signed.apk`, which is
signed with the v2/v3 schemes and is installable.

#### Installing over ADB

```bash
adb install -r Minerva-1.0.5-debug-signed.apk
```

#### Installing by copying the file

1. Copy `Minerva-1.0.5-debug-signed.apk` to the phone.
2. Open it from your file manager.
3. Android will ask you to allow installation from unknown sources: accept it
   for the file manager you are using.

> **Heads-up:** because this uses a debug key, the system may show warnings.
> That is expected for an APK not published on Google Play.

#### Storage permission

Minerva declares `MANAGE_EXTERNAL_STORAGE` ("All files"), which gives it
access to your books so it can read them straight from disk. If you would
rather not grant it, copy your books into the app's own folder and use the
file picker import instead.

#### Android and sync

The app declares a `MediaPlaybackService` for the system's text-to-speech
service. Playback notifications appear in the notification shade.

### 2.5 macOS

> **There is no `.dmg` for version 1.0.5.** Building for macOS from Linux is
> impossible for four independent reasons, each fatal on its own:
>
> 1. **There is no Apple SDK.** The app links against Apple's frameworks
>    (`objc2`, `objc2-foundation`, `objc2-authentication-services`, `cocoa`,
>    `dispatch2`) and there are 74 code sites under `cfg(target_os = "macos")`.
>    `zig cc` ships no macOS SDK, and `osxcross` needs you to supply the SDK
>    you downloaded from Xcode on a Mac.
> 2. **Signing is macOS-only.** `codesign` needs the *Developer ID
>    Application* certificate.
> 3. **Notarization is macOS-only.** `xcrun notarytool` and `altool` do not
>    exist on Linux.
> 4. **The bundlers are compiled per host.** The Tauri CLI only offers the
>    `dmg` and `app` package types when it is itself built on macOS.
>
> **How to get it:** on a Mac with Xcode installed,
>
> ```bash
> pnpm tauri build -t universal-apple-darwin --bundles dmg \
>   --config src-tauri/tauri.macos-nonestore.conf.json
> ```
>
> This needs the `aarch64-apple-darwin` and `x86_64-apple-darwin` Rust
> targets. The result is a universal `.app` (Apple Silicon + Intel) and its
> `.dmg`.

#### A note about the macOS App Store

The project's `package.json` references three configuration files that **do
not exist** in the repository:

- `src-tauri/tauri.appstore.conf.json`
- `src-tauri/tauri.appstore-dev.conf.json`
- `src-tauri/tauri.macos-appstore.conf.json`

The `build-macos-universial-appstore`, `build-macos-universial-appstore-dev`
and `release-mac-appstore.sh` scripts fail before they start, on any system.
If you need that route, those files have to be created first.

### 2.6 First launch, on any system

The app **never asks for an account**. When it opens:

1. You land on the **library**, showing the *Continue reading* poster (if you
   have a book in progress) or the *Start your library* empty state.
2. **Settings → Language** to change the interface language. By default it
   follows the system.
3. **Settings → AI Assistant** if you want the book chat. It appears
   **disabled** until you flip the *Enable AI Assistant* switch.
4. **Settings → Integrations** if you want to connect your own server.

**The binaries this guide points at are neutral.** They carry no third-party
and no personal URL baked in: the executable does not know in advance which
server it talks to. That is why the app works **fully offline** (read,
annotate, library, export) without touching the network, and why syncing is
your decision: you name **your** Worker.

If the build has the self-hosted mode enabled —and the public binaries do—
the **sign-in screen** shows an editable **Cloudflare Server** field
(placeholder `https://tu-worker.workers.dev`). Paste your Worker's URL
there and the app stores it: no extra deployment, no reconfiguring files,
no recompiling.

---

## 3. Managing the library

### 3.1 Importing books

The **Import Books** button in the library header opens the menu with **every**
way in:

| Menu entry | What it does |
| --- | --- |
| **From Local File** | File picker. Accepts several files at once |
| **From Directory** | Imports a folder recursively. Desktop only (a phone cannot read arbitrary folders) |
| **From Pasted Text** | Paste an article or your notes and they become a book |
| **From Web Browser** | Captures a page open in the system browser. Desktop only |
| **From Web Novel** | Downloads the chapters of a web novel. Desktop only |
| **From Feed URL** | Subscribes to an RSS, Atom or JSON Feed |
| **Online Library / OPDS Catalogs** | OPDS catalogues |

And besides that menu:

| Route | Detail |
| --- | --- |
| **Drag and drop** | Drop files or folders onto the library window |
| **Nearby BookDrop (LocalSend)** | Transfer between devices on the same network, no cloud involved |
| **Browser extension** | *Send to Minerva* (Chromium) clips the page into a self-contained EPUB and sends it to your inbox |
| **Email** | Send to your configured *Send to Minerva* address |
| **Open with / share sheet** | The operating system hands the file to Minerva. *Auto-import books on open* is on by default on mobile |
| **Shared book link** | A `…/s/…` link adds the book to your library |
| **`.rbooks` file** | Minerva's own exportable, importable library bundle |

#### Importing a folder

The **Import Books** dialog offers:

| Option | What it does |
| --- | --- |
| **Folder** | Source folder |
| **File Formats** | Extensions to look for: EPUB, PDF, MOBI/AZW/AZW3, FB2, CBZ/ZIP, TXT/MD, HTML |
| **File size larger than** | Skips files below a minimum size in KB (20 KB by default), so the library does not fill with noise |
| **Read books in place** | Does not copy the file: it reads the original where it lies, and the library references it |
| **Auto-import new books from this folder** | Watches the folder: anything added later comes in on its own |
| **Create groups from subfolders** | Each first-level subfolder becomes a library group |

#### The URL shortcut

The library also accepts a `?url=` parameter, useful for scripts and for
direct links to a remote folder.

### 3.2 Organising

#### Bookshelves

Shelves are sections of the library with their own configuration. Five are
built in:

| ID | Default name |
| --- | --- |
| `recent` | Recently read |
| `audiobooks` | Audiobooks |
| `podcasts` | Podcasts |
| `default` | Default |
| `finished` | Finished books |

Create your own in **View menu → Bookshelves → Manage Bookshelves**. Each shelf
configures separately:

| Setting | Values |
| --- | --- |
| **Layout** | Carousel / Grid / List |
| **Hide covers** | Hides covers in list mode |
| **Book covers** | Crop / Fit |
| **Skeuomorphic covers** | Raised-looking covers |
| **Grouping** | Group by your own criterion, or use the global one |
| **Sorting** | Your own order, or use the global one |
| **Exclusive** | The shelf takes only its own books, not those of other shelves |
| **Limit** | Maximum number of books shown |

#### Groups and tags

- **Groups**: *Group Books* groups books by a free-form criterion (a saga, an
  author, a project). Create, rename and delete them from a book's context
  menu or in multi-select mode.
- **Tags**: the **Tag Books** dialog assigns tags to one or more books, and
  lets you create new tags on the spot.

#### Reading status

Every book has a status, editable from the context menu:

| Status | Label |
| --- | --- |
| Unread | *Unread* |
| In progress | *Reading* |
| Finished | *Finished* |
| On hold | *On hold* |

Opening a book moves it to *Reading* automatically; reaching 100 % marks it
*Finished*.

### 3.3 Viewing, filtering and searching

#### View mode

The library's **View** menu offers:

| Control | Options |
| --- | --- |
| View mode | **List** / **Grid** |
| **Columns** | Automatic, or 1 to 12 depending on the window width |
| **Group by…** | Authors · Books · Groups · Series · Tags · Subjects · Status |
| **Sort by…** | Title · Author · Format · Pages · Series · Updated · Created · Published · Progress · Time Remaining |
| **Then by…** | A second criterion, with *Ascending* / *Descending* |

Implicit defaults are shown marked *(Auto)*. For instance, if you group by
*Authors*, the secondary sort automatically becomes *Series*.

#### Metadata search

The **Search Books...** field filters by title, authors, format, group,
description, tags, subjects and Calibre custom columns. It accepts regular
expressions if you write them as such.

#### Full-text search

The same field can switch to **Full Text Search**, which walks the **content**
of every book, not just its metadata.

| Mode | What it does |
| --- | --- |
| **Contains** | Substring |
| **Whole Words** | Complete words |
| **Regular Expression** | Regular expression |
| **Nearby Words** | Words near each other, within a window of 5, 10, 20 or 50 words |
| **Fuzzy** | Tolerant of typos |

Extra options: **Match Case** and **Match Diacritics** (the latter is disabled
in regex mode).

The index is stored in `search.db` and rebuilt only when needed. Nearby-words
and fuzzy searches run in a **Web Worker**, so the interface never blocks. The
limit is 500 results per book.

> If you see *Enter at least two words*, fuzzy mode needs at least two words.
> If you see *Invalid regular expression*, fix the pattern.

### 3.4 Metadata

From a book's context menu: **Show Book Details**. The **Edit Metadata** button
opens the editor.

| Field | Field |
| --- | --- |
| Cover image | Title |
| Subtitle | Author |
| Series | Series Index |
| Total in Series | ISBN |
| Publisher | Publication Date |
| Language | Identifier |
| Subjects | Tags |
| Description | |

On top of that:

- **Auto-Retrieve Metadata** looks the book up in **Open Library** and
  **Google Books** and fills in the empty fields.
- **Lock cover** / **Unlock cover**, and **Lock All** / **Unlock All**, pin the
  fields so a later sync does not overwrite them.

**Calibre custom columns** found in the book's OPF are shown read-only and can
be used as shelf filter fields.

---

## 4. The reading experience

### 4.1 View modes

The reader's **View** menu changes depending on the book's format.

#### Reflowable books (EPUB, MOBI, FB2, TXT, HTML, Markdown)

| Mode | Shortcut | What it does |
| --- | --- | --- |
| **Paginated** (default) | — | Fixed pages, with dragging and page turns |
| **Scrolled Mode** | `Shift + J` | Continuous scrolling, vertical or horizontal |
| **Paragraph Mode** | `Shift + P` | Shows one paragraph at a time, centred and in focus |
| **Speed Reading Mode** (RSVP) | `Shift + V` | One word at a time, with a speed control |
| **Auto Scroll** | `Shift + A` | Automatic advance with adjustable speed |

The RSVP start dialog lets you choose: *From Chapter Start*, *Resume* or *From
Current Page*.

#### Fixed-layout books (PDF, CBZ)

| Control | Options |
| --- | --- |
| **Zoom Mode** | Single Page · Auto Spread · Vertical Scrolling · Horizontal Scrolling · Fit Page · Fit Width |
| **Zoom Level** | Adjust with *Zoom In* / *Zoom Out* / *Reset Zoom* |
| **Contrast** | *Decrease Contrast* / *Reset Contrast* / *Increase Contrast* |
| **Webtoon Mode** | Vertical comic strip view |
| **Separate Cover Page** | The cover gets a page of its own |
| **Right-to-Left Pages** | Reversed reading order |
| **Lock Horizontal Panning** | Locks horizontal dragging |

PDFs also get **Apply Theme Colors** and **Invert Image In Dark Mode**.

### 4.2 Fonts and typography

**Settings → Font.**

| Control | Detail |
| --- | --- |
| **Override Book Font** | Ignores the typeface the book declares |
| **Default Font Size** / **Minimum Font Size** | Default and minimum size (8 to 120) |
| **Font Weight** | 100 to 900, in steps of 100 |
| **Font Category** | Serif / Sans-Serif |
| **Serif Font** / **Sans-Serif Font** / **Monospace Font** | A specific font from each category |
| **CJK Font** | Only shown in a CJK environment |
| **Custom Fonts → Manage Fonts** | Your own fonts |

The bundled fonts are **Bitter, Literata, Merriweather, Roboto Slab,
Vollkorn, PT Serif, Georgia, Times New Roman** (serif), **Roboto, Noto Sans,
Open Sans, PT Sans, Helvetica** (sans), **Fira Code, Consolas, Courier New,
Lucida Console, PT Mono** (monospace) and the **LXGW WenKai / Source Han /
Noto Sans CJK** family for Chinese and Japanese. The fonts installed on your
system are enumerated automatically.

**Importing your own font:** *Manage Fonts → Import Font*. Accepted formats:
`.ttf`, `.otf`, `.woff`, `.woff2`. They are stored under `Minerva/Fonts` and
become selectable in the *Font* panel's lists.

### 4.3 Theme, colours and textures

**Settings → Theme.** There are two scopes, switched with the **Library /
Reader** segmented control:

| Setting | Values |
| --- | --- |
| **Theme Mode** | Auto · Light · Dark · Ambient |
| **Theme Color** | Minerva (default) · Gray · **Sepia** · Grass · Cherry · Sky · Solarized · Gruvbox · Nord · Contrast · Sunset · *Custom* |
| **Background Texture** | None · Concrete · Paper · Sand · Parchment · Scrapbook · Leaves · Moon Sky · Night Sky |
| **Invert Image In Dark Mode** | Inverts images in dark mode |
| **Override Book Color** | Forces the book's colour over the theme's |
| **Highlight Colors** | The colours of your highlights |
| **Reading Ruler** | A visual guide over the reading line |
| **Dialogue Highlight** | Emphasises dialogue |
| **Code Highlighting** | Syntax colouring in technical books |

> **About *Ambient* mode:** it follows the device's ambient light sensor and
> switches between light and dark according to the real illumination. It is
> designed mainly for Android and e-ink, and only appears if the device has
> the sensor.
>
> **About *sepia*:** it is a theme **colour**, not a separate mode. The modes
> are Auto, Light, Dark and Ambient; sepia is chosen under *Theme Color*.

The reader's quick switch (in the **View** menu) cycles the modes: Dark →
Light → Ambient → Auto.

#### E-ink mode

**Settings → Behavior → Device → E-Ink Mode.** It adapts the interface for e-paper
screens: no shadows, no gradients, crisp 1 px borders, and the bronze accents
turned into ink. The Linux AppImage ships a hook that avoids the
*user namespaces* warning on launch.

### 4.4 Page layout

**Settings → Layout.**

| Group | Settings |
| --- | --- |
| **General** | Override Book Layout · Writing Mode (Default / Horizontal / Vertical / RTL) · Border Frame |
| **Paragraph** | Use Book Layout · Paragraph Margin · Line Spacing · Word Spacing · Letter Spacing · Text Indent · Full Justification · Hyphenation |
| **Page** | Top / Bottom / Left / Right Margin · Additional Margin · Column Gap · Maximum Number of Columns · Maximum Column Height / Width |
| **Header & Footer** | Show Header / Footer · Remaining Time · Remaining Pages · Reading Progress · Progress Bar · Current Time · Use 24 Hour Clock · Battery Status · Battery Percentage · Font Size · Text / Background Color · Opacity |
| **Screen** | Orientation (Auto / Portrait / Landscape) |

Inside the reader there is a quick access: the bottom bar offers **Font Size**,
**Page Margin** (Small / Large), **Line Spacing** (Small / Large) and **More
Settings**.

### 4.5 Navigation, bookmarks and search

#### Table of contents

The **TOC** tab of the sidebar shows the book's index. For a PDF without an
outline, Minerva lists every page as a thumbnail.

#### Bookmarks

| Action | How |
| --- | --- |
| Add or remove a bookmark | `Ctrl + B` / `Cmd + B`, or the *Bookmark* button |
| Bookmark with a drag gesture | Pull down from the top edge of the page to add or remove it |
| See your bookmarks | **Bookmark** tab of the sidebar |

#### Jumping

| Action | Shortcut |
| --- | --- |
| Go to page | *Go to Page* button in the bottom bar |
| Previous / next chapter | `Alt + ←` / `Alt + →` (`Opt` on macOS) |
| Back / forward | `Shift + H` / `Shift + L` |
| Start / end of book | `Home` / `End` |

#### Searching inside the book

`Ctrl + F` / `Cmd + F` opens the sidebar search, with the same modes as the
library search: *Contains*, *Whole Words*, *Regular Expression*, *Nearby
Words*, plus *Match Case* and *Match Diacritics*. The scope can be the whole
**book** or the current **chapter**.

### 4.6 Highlights and annotations

Selecting text brings up the floating toolbar:

| Button | Shortcut | What it does |
| --- | --- | --- |
| **Copy** | `Ctrl + C` | Copies the text |
| **Copy Link** | — | Copies a link to the exact position |
| **Highlight** | `Ctrl + H` | Highlights with the current style and colour |
| **Underline** | `Ctrl + U` | Underlines |
| **Annotate** | `Ctrl + N` | Opens the note editor over the selection |
| **Photo** | — | Opens the image search (see [section 6](#6-contextual-image-search)) |
| **Search** | `Ctrl + F` | Searches the selection in the book |
| **Dictionary** | `Ctrl + D` | Looks the selection up in the dictionary |
| **Translate** | `Ctrl + T` | Translates the selection |
| **Ask Gemini** | — | Explains the selection with AI |
| **Speak** | `Ctrl + R` | Reads the selection aloud |
| **Proofread** | `Ctrl + P` | Proofreads the selection |
| **Share** | — | Shares the selection |
| **Quote Card** | — | Renders a quote card image |

Highlight styles are *highlight*, *underline* and *squiggly*; colours are red,
yellow, green, blue and violet. *Apply to every occurrence in the book*
extends a highlight to every appearance of the text in the section.

Annotations are listed in the sidebar's **Annotate** tab, grouped by chapter,
with filters by kind, colour and style, and their own search field. Each row
offers copy, edit and delete.

### 4.7 Other reader features

| Feature | Access | Detail |
| --- | --- | --- |
| **Text to speech** | `T` | Player with synced lyrics, chapters, speed control and an audio cache. Supports EPUB 3 Media Overlays and pairing with on-device audiobooks |
| **Translation** | `Ctrl + T` | Configurable translators (DeepL, Yandex, custom) with an option to show the original |
| **Dictionary** | `Ctrl + D` | Wiktionary, Wikipedia, the system dictionary and imported dictionaries (MDict, DICT, Slob, Babylon, Yomitan, StarDict). The **Yomitan** plugin is bundled |
| **Word Lens** | Settings → Language | A short gloss in your own language above difficult words |
| **Footnotes** | Click the callout | *Back* and *Jump to Location* |
| **Reading statistics** | View menu | Time, activity, current streak, longest streak, total books and pages |
| **Sign in with Apple** | — | For services that require it |
| **Two-book reading** | — | A grid of books open at the same time |

---

## 5. The Notebook and your notes

The Notebook is **Minerva's own implementation**: a side panel with a Markdown
editor tied to the book you are reading.

### 5.1 Opening the Notebook

| Route | Detail |
| --- | --- |
| `N` | Toggles the panel's visibility |
| **Notebook** button | In the reader's top bar (quill icon) |
| **All notes** button | At the foot of the Notebook itself: jumps to the full annotation list |

When the Notebook is **pinned** (*Pin Notebook*, in the panel header) it takes
up layout space and **does not hide** as you navigate. When it is not pinned it
behaves as a floating layer over a dimmed background, and closes with
`Escape` or with Android's back button.

You can **resize it** by dragging the handle on its left edge (or with the
arrow keys, since the handle is a `slider`). The width is remembered between
sessions. On mobile it takes the full width and resizes vertically.

### 5.2 How the Notebook is organised

The Notebook is organised by the book's chapters:

| Selector | Meaning |
| --- | --- |
| **All chapters** | The whole document as one flow |
| **General notes** | Your loose notes, with no chapter assigned |
| *(each table-of-contents entry)* | That chapter's notes, with an excerpt count and a mark if you have written anything |

The compass button (*Jump to current reading chapter*) jumps to the chapter you
are reading right now.

> Each chapter is stored apart from the rest, but the complete document is a
> single Markdown file. The Notebook is saved **next to the book**, in its
> `config.json` — not in the database. That means it travels with the book in
> backups and in file sync.

### 5.3 Writing in Markdown

The editor is rich Markdown. The toolbar offers:

| Control | Markdown produced |
| --- | --- |
| **Text style** → Text / Heading 1 / Heading 2 / Heading 3 | Paragraph, `#`, `##`, `###` |
| **Bold** | `**text**` |
| **Italic** | `*text*` |
| **Strikethrough** | `~~text~~` |
| **Highlight** → Yellow / Mint / Blue / Coral / No highlight | `==text==` or `<mark data-color="mint">text</mark>` |
| **Bulleted list** | `- item` |
| **Numbered list** | `1. item` |
| **Quote** | `> quote` |
| **Quote from the book** | Inserts a citation linked to the exact spot (see below) |

> Underline is deliberately **disabled**: it has no unambiguous spelling in
> portable Markdown. Raw HTML is disabled too, for safety. The round trip to
> Markdown is guaranteed by the project's test suite.

`Ctrl + Enter` / `Cmd + Enter` saves. The status line reads **Saving…**,
**Saved**, **Couldn't save** or **Waiting for a valid book position**.

### 5.4 Notes on the book's text

There are four ways to create a note:

**A · Annotate a selection.** Select text → **Annotate** (`Ctrl + N`). An
editor opens right over the selection. Write and save. The note is **anchored
to that exact spot** in the book.

**B · Copy to the Notebook.** Turn on **Settings → Behavior → Annotation Tools
→ Copy to Notebook**. From then on, the **Copy** action in the selection
toolbar also stores the text as an *excerpt* in the Notebook, and shows the
message *Copied to Notebook*. This is the only path that creates excerpts.

**C · Just write.** Type directly in the Notebook. It is the only content that
needs no anchor in the book.

**D · Edit from the sidebar.** In the **Annotate** tab, the pencil on each row
opens an inline editor.

### 5.5 Citations that jump back to the book

If you have excerpts saved, the **Quote from the book** toolbar entry lists
each one with its chapter and page. Inserting one produces:

```markdown
> The quoted text, with whitespace normalised.

> [Chapter 3 · Page 42](minerva-cfi:epubcfi(/6/4))
```

That link is an **EPUB CFI**: it points at the exact position. Clicking it
takes the reader to that page.

> **The button is disabled if you have no excerpts.** Turn on *Copy to
> Notebook* and copy something from the book to get started.

### 5.6 Exporting

Precision matters here, because there is an important distinction.

| What gets exported | Where | Format |
| --- | --- | --- |
| **Highlights and annotation notes** | Book menu → **Export Annotations** | Markdown, Plain Text or JSON (Minerva) |
| **The Notebook document** | — | **No direct file export** |

The **Export Annotations** dialog is highly configurable:

| Group | Options |
| --- | --- |
| **Format** | Markdown · Plain Text · JSON (Minerva) |
| **Format Options** | Title · Author · Export Date · Cover Image · Chapter Titles · Chapter Separator · Highlights · Context · Notes · Page Number · Note Date |
| **Annotation Link** | App Link or Web Link |
| **Filter Annotations** | By colours and by styles |
| **Advanced** | Custom template with a full template language: `{{ variable }}`, `{{ variable \| date('%Y-%m-%d') }}`, `{% if %}`, `{% for %}`, and the formatters *date*, *blockquote*, *nl2br*, *upper*, *lower*, *capitalize*, *title*, *trim*, *truncate(n)*, *replace('a','b')*, *default(val)*, *length*, *first*, *last*, *join(', ')* |

**Save** writes `<title>.md`, `<title>.txt` or `<title>-annotations.json`. On
macOS, **Share** appears as well.

> **The Notebook is left out of this export by design.** The filter is
> explicit: only annotations, bookmarks and excerpts are exported. If you
> need the Notebook as Markdown, the route is copying its content manually, or
> taking the app's full backup, which does include the book's `config.json`
> with the Notebook inside.

### 5.7 Importing annotations from other apps

Book menu → **Import Annotations**:

| Source | File |
| --- | --- |
| **Minerva** | `.json` exported by Minerva |
| **Moon+ Reader** | `.mrexpt` |
| **ReadEra** | `.bak` |

### 5.8 The AI chat inside the Notebook

If you enable **Settings → AI Assistant**, the Notebook gains a second tab,
**AI**, with a chat that answers questions **about the book you are reading**.

**The book has to be indexed first.** The tab shows *Index This Book* →
*Start Indexing*, and reports progress (*`current / total chunks`*). The chat
context includes the title, the author and the current page, and answers show
their **sources**: clicking a source that carries a CFI takes the reader to the
cited passage.

| Provider | API key | Notes |
| --- | --- | --- |
| **Ollama (Local)** | No | Everything stays local. The recommended choice if privacy matters |
| **AI Gateway (Cloud)** | Yes | Cloud |
| **OpenAI Compatible** | Yes | Any compatible endpoint |
| **Gemini** | Yes | As the in-situ reading assistant, independent of the chat |
| **Reedy (Beta)** | — | Desktop only, in beta |

Choosing *None (disable RAG)* as the embedding model runs the chat without
retrieval-based indexing.

> **Indexing sends the book's text to the provider you chose.** With Ollama
> the text never leaves your machine. With a cloud provider it does. Choose
> accordingly.

---

## 6. Contextual image search

This is Minerva's second own implementation: **searching for images of
characters, places or concepts without leaving the reading view**.

### 6.1 How to use it

1. **Select the text** you are interested in: a person's name, a place, a
   term.
2. Press the **Photo** button on the floating toolbar (*Search photo or attach
   image*).
3. The **Search Image / Photo** dialog opens with the **query already filled
   in** from your selection, and the search **runs automatically**.
4. Review the results and pick one.

You can also open it from the **Photo** button inside an existing note's
editor, to attach an image to that specific note.

### 6.2 Where the results come from

| Source | What it contributes |
| --- | --- |
| **Wikipedia** | The article's lead image, with a biographical extract |
| **Wikimedia Commons** | Photographs, portraits, paintings and high-resolution media |

The search runs **in parallel** against both, and the results are merged
without duplicate URLs. A segmented control offers three modes: **all**,
Wikipedia only, or Commons only.

### 6.3 Language

The dialog uses the **book's language** to search Wikipedia. If that yields
nothing, it **falls back to English automatically**. You can change the
language by hand.

### 6.4 What happens when you pick an image

Confirming with **Use this photo** inserts Markdown into the note:

```markdown
![Image title](https://url.of.the.image)

> Biographical summary or image description.
```

The summary is added only if you leave **Include biographical summary in
note** ticked. The message *Photo attached to note* confirms the operation.

If you are not editing a note, the image is inserted into the note attached to
your current selection.

### 6.5 When there are no results

The dialog offers two alternative routes:

| Option | When to use it |
| --- | --- |
| **Paste image URL instead** | You already have a direct image URL |
| **Search person, character, place...** | Change the query |

The help text is explicit: *Try searching with the full name, switching
language, or paste an image URL.*

> **The preview needs a direct link.** If you paste a web page URL instead of
> the image itself, you will see *Could not load image preview. Check that the
> link is direct.*

### 6.6 Privacy

Queries travel to `wikipedia.org` and `commons.wikimedia.org`. **The text you
selected does leave your machine** as the search string, but only the query —
not the book. Minerva sends no book content to any image service.

---

## 7. Continue reading and keyboard shortcuts

### 7.1 The *Continue reading* poster

The first thing you see when you open the library is a full-size composition:

| Element | Content |
| --- | --- |
| Cover | With the **spine**: the rule on the book's edge that fills with your progress |
| Title and author | Of the book in progress |
| Percentage | The large figure, as the protagonist |
| Progress bar | The same mark as the spine, laid horizontally |
| Time remaining | An estimate in minutes, computed from the median of your recent sessions |

Clicking anywhere on the cover opens the book exactly where you left it.

> **The composition is a dust jacket:** the book and its details on the paper,
> the reading percentage printed on a tonal panel beside it, the way a jacket
> states the edition of a classic. The number commands; everything else is
> reduced enough to let it speak.

**When it appears.** Only when there is a book in *Reading* status with
progress between 0 % and 100 %, and only in the library's **default** view.
If you are searching, filtering by a group, or looking at a named shelf, the
poster disappears: a filtered view is a view over the collection, not a place
to advertise one book.

**The spine.** It is Minerva's own identity signal: the vertical rule on the
book's edge that fills with reading progress. When you focus a card, the
spine **lights up**: it goes from dim bronze to full bronze. Colour only,
never a transformation.

### 7.2 Keyboard shortcuts

The full list lives in **Settings → Keyboard Shortcuts** and in the help
dialog, which opens with `Shift + ?`. **Every one of them is remappable.**

#### General

| Shortcut | Action |
| --- | --- |
| `Shift + ?` | Show the keyboard shortcuts |
| `Ctrl + Shift + P` / `Cmd + Shift + P` | Command palette |
| `Shift + F` · `Ctrl + ,` · `Cmd + ,` | Open Settings |
| `Ctrl + O` / `Cmd + O` | Open books |
| `N` | Toggle the Notebook |
| `S` | Toggle the sidebar |
| `Ctrl + Tab` / `Opt + Tab` / `Alt + Tab` | Switch sidebar tab |
| `Ctrl + F` / `Cmd + F` | Search in book |
| `Shift + J` | Toggle scroll mode |
| `Shift + P` | Toggle paragraph mode |
| `Shift + V` | Speed reading mode (RSVP) |
| `Shift + A` | Auto scroll |
| `Ctrl + B` / `Cmd + B` | Toggle bookmark |
| `T` | Toggle text to speech |
| `Enter` | Toggle the toolbar |
| `Shift + R` | Reload page |
| `Escape` | Close |

#### Selection

| Shortcut | Action |
| --- | --- |
| `Ctrl + H` / `Cmd + H` | Highlight the selection |
| `Ctrl + U` / `Cmd + U` | Underline the selection |
| `Ctrl + N` / `Cmd + N` | Annotate the selection |
| `Ctrl + F` / `Cmd + F` | Search the selection |
| `Ctrl + C` | Copy the selection |
| `Ctrl + T` / `Cmd + T` | Translate the selection |
| `Ctrl + D` / `Cmd + D` | Dictionary lookup |
| `Ctrl + R` / `Cmd + R` | Read the selection aloud |
| `Ctrl + P` / `Cmd + P` / `Alt + P` | Proofread the selection |

#### Navigation

| Shortcut | Action |
| --- | --- |
| `←` · `H` | Previous page / go left |
| `→` · `L` · `Space` | Next page / go right |
| `↑` · `K` | Up |
| `↓` · `J` | Down |
| `Shift + →` · `Shift + ↓` · `PageDown` | Next page |
| `Shift + ←` · `Shift + ↑` · `PageUp` | Previous page |
| `Alt + ←` / `Opt + ←` | Previous chapter |
| `Alt + →` / `Opt + →` | Next chapter |
| `D` | Scroll half a page down |
| `U` | Scroll half a page up |
| `Home` | Start of book |
| `End` | End of book |
| `Shift + H` | Back |
| `Shift + L` | Forward |

#### Text to speech

| Shortcut | Action |
| --- | --- |
| `Space` | Play / pause |
| `Ctrl + ]` / `Cmd + ]` | Next sentence |
| `Ctrl + [` / `Cmd + [` | Previous sentence |
| `Ctrl + Shift + }` | Next paragraph |
| `Ctrl + Shift + {` | Previous paragraph |
| `Shift + M` | Highlight the current sentence |

#### Zoom and window

| Shortcut | Action |
| --- | --- |
| `Ctrl + =` / `Cmd + =` | Zoom in |
| `Ctrl + -` / `Cmd + -` | Zoom out |
| `Ctrl + 0` / `Cmd + 0` | Reset zoom |
| `F11` | Fullscreen |
| `Ctrl + W` / `Cmd + W` | Close window |
| `Ctrl + Q` / `Cmd + Q` | Quit the app |

#### Notes

| Shortcut | Action |
| --- | --- |
| `Ctrl + Enter` / `Cmd + Enter` | Save note |

> On macOS, `Cmd` replaces `Ctrl` throughout; Minerva shows the right key for
> your platform.

---

## 8. Differences from Readest

### 8.1 What Minerva adds

| Feature | What it is | Where |
| --- | --- | --- |
| **Markdown notebook** | A side panel with a real Markdown editor, organised by the book's chapters, with citations that link to the exact position in the text (CFI) and a guaranteed Markdown round trip | `src/app/reader/components/notebook/` |
| **Contextual image search** | From your selection, searches Wikipedia and Wikimedia Commons, with the language taken from the book, an optional biographical extract and Markdown insertion into the note | `src/services/imageSearch/`, `annotator/ImageSearchDialog.tsx` |
| **The *Continue reading* poster** | A full-size poster with the book in progress, its percentage printed as the protagonist figure and an estimated time remaining | `src/app/library/components/ContinueReadingHero.tsx` |
| **The *Minerva* visual identity** | Bronze and gold on warm neutrals, a serif display face, the "spine" as its own signal, halftone texture, and a shadow-free e-ink mode | `src/styles/themes.ts`, `globals.css`, `IDENTITY.md` |
| **Self-hostable backend** | One Worker + D1 + R2 on your own account, a one-command deployment, client-side encryption and KOSync compatibility | `workers/minerva-sync/`, `deploy-cloudflare.sh` |
| **Its own multiplatform packaging** | Linux with the **CEF** runtime, Windows with **WebView2** and the thumbnail DLL compiled separately, Android with **NDK 28.2** and an arm64 APK | `docs/BUILD_WINDOWS_MACOS.md` |
| **Complete Spanish** | The whole interface catalogue, including the new features | `public/locales/es/` |

### 8.2 What Minerva changes

| Aspect | Change |
| --- | --- |
| **Account** | Optional. The whole app is usable without registering |
| **Sync** | Points at **your** Worker, with client-side encryption. The file providers (WebDAV, Google Drive, S3, OneDrive, iCloud) remain available |
| **Telemetry** | Strict opt-in, with a default opt-out for 90 % of new installations and no SDK started when no key is configured |
| **Payments** | On a self-hosted deployment (`SELF_HOSTED=true`) **every** feature is unlocked: there is no store |
| **Branding** | Minerva everywhere: name, icon, palette, typography, interface text and installer |
| **Dependencies** | The embedded credentials of the hosted service were removed; `.env.example` went from over a hundred variables to nine |
| **Sensitive data** | Encrypted in the client with PBKDF2 (600 000 iterations) on the native surface; MD5 on the KOSync-compatible surface |
| **Linux packaging** | CEF runtime instead of Electron: one self-contained binary, no separate Chromium install |

### 8.3 What Minerva removes

| Removed | Detail |
| --- | --- |
| **Embedded hosted-service credentials** | `publicDefaults.ts` (Supabase, Stripe, PostHog and Pagebound, base64-encoded) was deleted from the repository. The Calibre plugin and the KOReader *koplugin* no longer carry the original service's key |
| **Hosted-service account scripts** | `inspect-accounts.mjs` and `merge-accounts.mjs` deleted |
| **Mandatory account dependency** | No registration needed to read, import, annotate or use the Notebook |
| **Runtime self-installation on Linux** | The AppImage is self-sufficient |

### 8.4 About the translations

The interface is available in **35 languages**:

`ar` · `bn` · `bo` · `de` · `el` · `en` · `es` · `fa` · `fr` · `he` · `hi` ·
`hu` · `id` · `it` · `ja` · `ka` · `ko` · `ms` · `nl` · `pl` · `pt` · `pt-BR` ·
`ro` · `ru` · `si` · `sl` · `sv` · `ta` · `th` · `tr` · `uk` · `uz` · `vi` ·
`zh-CN` · `zh-TW`

Minerva uses a *key-as-content* scheme: the English string **is** the
translation key, and the English locale is empty on purpose. Languages that
have not received a translation yet fall back gracefully to the English text,
so you never see an empty string.

**Spanish** and **English** cover 100 % of the features, including all the new
ones: the Notebook, image search, the *Continue reading* poster, reading
statuses and full-text search.

> **About the new features in the other languages:** the most recent strings
> —the *Continue reading* poster and the image search dialog— are translated
> into Spanish and pending translation in the other languages, which show the
> English text until the translation lands. The other languages already cover
> the Notebook, reading statuses and full-text search.

To change the language: **Settings → Language → Language**, or pick *System
Language* to follow the system.

---

## 9. Frequently asked questions (FAQ)

### 9.1 General

**Do I have to create an account?**
No. Minerva is fully usable without an account. An account is only needed if
you want to sync across devices.

**Does it send data anywhere without me asking?**
No. With no backend configured, the app makes no account requests. Telemetry
is off by default and its SDK does not even start without a configured key.

**Does it work offline?**
Yes, completely. The library, notes, the Notebook and annotations are local.
Only the features that need the network (sync, translation, web dictionary,
image search, AI) require one.

**Which formats does it support?**
EPUB, PDF, MOBI, AZW, AZW3, KF8, FB2, CBZ, TXT, MD, HTML, HTM, MHTML, MHT.
`.docx` and `.rtf` are converted to EPUB on import.

**What is the difference between a note and an excerpt?**
A **note** (annotation) is your own text anchored to a position in the book.
An **excerpt** is text from the book copied into the Notebook. The Notebook's
citations are built from excerpts.

**Can I edit the Markdown by hand?**
Not directly, but Markdown is the storage format: if you export the
annotations as Markdown you can edit them and import them back.

### 9.2 Syncing with your own server

**How do I set the server up?**
```bash
git clone --recurse-submodules https://github.com/minerva/minerva.git
cd minerva
npx wrangler login
./deploy-cloudflare.sh
```
The script prints the Worker's URL when it finishes.

**How do I connect the app?**
1. **Settings → Integrations → Minerva Cloud (Cloudflare)**.
2. Paste the Worker's URL and press **Test connection**.
3. Register with an email address and a *passphrase*. The server only stores
   a PBKDF2 derivation: **it cannot recover your passphrase**, so keep it
   safe.

**Can I put my Worker's URL in directly when I sign in?**
Yes. The **sign-in screen** has a **Cloudflare Server** field (placeholder
`https://tu-worker.workers.dev`). Paste your Worker's URL there and press
**Sign in** or **Sign up**: the app sanitizes it, stores it in the device's
`localStorage`, and from that moment on it talks to your Worker. There is
nothing else to deploy and nothing else to reconfigure.

The field is **mandatory** in self-hosted mode: if there is no stored URL
yet, the app asks for one and will not let you in.

**Which URLs does it accept?**
Only `https://` —with the single exception of `http://` on `localhost` and
loopback addresses, for local testing. The app discards credentials
embedded in the URL (`https://user:pass@…`), the query string (`?…`) and the
fragment (`#…`), and strips trailing slashes. If the URL is not valid, the
form says so and does not go on.

**And if I do not want to sync with anything?**
You do not have to do anything. The app works **100 % offline** with the
official binaries: reading, annotating, the library, exports and the Notebook
never leave your device. The Worker's URL is only needed when you want to
sync across devices or keep your books in your own R2.

**What exactly is the passphrase?**
It is the key your data is encrypted with, in the client. The server stores
the salt and the ciphertext. If you lose it, the data synced from that device
cannot be recovered.

**Can KOReader use the same server?**
Yes. **Settings → Integrations → KOReader**, with the Worker's URL, your email
address and your passphrase.

**Which other sync providers are there?**
WebDAV, Google Drive, S3, OneDrive and iCloud for **file** sync; KOSync,
BookOrbit, Readwise, Hardcover, Pagebound and Notion for progress and notes.

### 9.3 The Notebook

**Where is the Notebook stored?**
In the book's own `config.json`, inside the library folder — not in the
database. That is why the Notebook travels with the book through backups and
file sync.

**Can I export the Notebook to a Markdown file?**
Not directly. The annotation export covers highlights, bookmarks and
excerpts, but deliberately excludes the Notebook document. The alternative
route is copying the panel's content, or taking the app's full backup.

**Why is *Quote from the book* disabled?**
Because you have no excerpts. Turn on *Copy to Notebook* in Settings →
Behavior, and copy something from the book.

**I lost unsaved Notebook changes**
Minerva keeps a recovery copy in localStorage on every edit. If opening the
book shows *Unsaved Notebook changes conflict with the latest saved version*,
you can choose **Use latest saved** or **Recover draft**. In the save-failure
dialog, **Copy draft** puts the Markdown on your clipboard.

**Is there a size limit on the Notebook?**
Yes: 256 KB per book. Beyond that you will see *Notebook is too large to
save. Copy or remove some text to continue.*

### 9.4 Image search

**Where do the images come from?**
From Wikipedia and Wikimedia Commons, queried in parallel and de-duplicated.

**Does my book's text get sent anywhere?**
Only the search string you selected, to `wikipedia.org` and
`commons.wikimedia.org`. The book itself is not sent.

**Why does my query return nothing?**
Try the full name, change the language, or use **Paste image URL instead** to
paste a direct image URL.

**Does the language matter?**
Yes. The search uses the book's language and falls back to English when there
are no results.

### 9.5 Privacy

**How do I turn telemetry off for good?**
**Settings → Behavior → Privacy → Help improve Minerva**, and switch it off.
The decision is stored and survives updates. You can also opt out from the
command palette.

**What is sent if I turn it on?**
Anonymous usage events, tagged with the app version. No books, no read text,
no notes. Minerva uses no session recordings, no feature flags and no
surveys.

**What encryption does sync use?**
Sensitive fields are encrypted **in the client** before upload. The key is
derived from your passphrase with PBKDF2 (600 000 iterations). The server
stores only the salt and the ciphertext.

---

## 10. Troubleshooting by operating system

### 10.1 Linux

| Symptom | Likely cause | Solution |
| --- | --- | --- |
| *Permission denied* running the AppImage | The execute bit is missing | `chmod +x Minerva-1.0.5-x86_64.AppImage` |
| *AppImage needs FUSE* | FUSE is not installed | `sudo apt install libfuse2` (Debian/Ubuntu) or `sudo dnf install fuse` (Fedora), or run with `--appimage-extract-and-run` |
| *dlopen(): libcef.so not found* | Incomplete extraction | Clear the AppImage cache and extract again: `rm -rf ~/.cache/appimage` |
| A *user namespaces* warning appears | The kernel asks for confinement | The AppImage ships a hook that prevents it; if it persists, run `sysctl -u kernel.unprivileged_userns_clone` |
| It does not appear in the application menu | The `.desktop` file is missing | Install it as described in [2.2](#22-linux-appimage) |
| The window opens blank | WebKitGTK missing | This build uses the CEF runtime; if the problem persists, install `libnss3`, `libgbm1`, `libasound2` and `libxkbcommon` |
| The app will not start on an old distribution | glibc too old | You need glibc 2.31 or later |

### 10.2 Windows

| Symptom | Likely cause | Solution |
| --- | --- | --- |
| *This app can't run on your PC* | Wrong architecture or an old system | Windows 10 1809+ on x64. On ARM64, use the Windows x64 emulator |
| *WebView2 runtime not found* | The WebView2 runtime is missing | It installs itself the first time; if that fails, download it from Microsoft and restart |
| The window opens blank | WebView2 failed to load | Update the WebView2 runtime and restart the app |
| SmartScreen says *unknown publisher* | The executable carries no Authenticode signature | Expected for this build. **More info → Run anyway**, or use a signed build |
| The antivirus blocks the `.exe` | False positive from a mingw build | Check the file's SHA-256 before allowing it |
| Thumbnails do not appear in Explorer | The DLL is not registered | Registration is done by the NSIS installer, which needs a Windows machine. See `docs/BUILD_WINDOWS_MACOS.md` |
| `minerva.exe` cannot find `WebView2Loader.dll` | The DLL is out of its folder | Keep all three files together in the same folder |
| The window opens behind another | Window stacking | Alt+Tab, or `Ctrl + W` and reopen |

### 10.3 Android

| Symptom | Likely cause | Solution |
| --- | --- | --- |
| *App not installed* | A different signature, or an older version | Uninstall the previous version. Changing signing key means you must uninstall first |
| *Parse error* while installing | The APK is damaged | Verify the SHA-256 and download it again |
| *For Work Profile* during install | Managed-profile policy | Install from the personal device |
| The app closes when opening a PDF | Out of memory on a fixed-layout PDF | Try *Fit Width* to reduce consumption |
| It cannot find your books | `MANAGE_EXTERNAL_STORAGE` not granted | Settings → Apps → Minerva → Permissions → *All files* |
| The battery drains fast | Sync or auto scroll running | Settings → Integrations: check the frequency; turn auto scroll off |
| Installation is blocked | Android blocks unknown sources | Settings → Apps → Special access → *Install unknown apps* → enable the file manager you use |

### 10.4 macOS

| Symptom | Likely cause | Solution |
| --- | --- | --- |
| There is no `.dmg` to download | macOS cannot be built from Linux | Build it on a Mac. See [2.5](#25-macos) |
| *The application cannot be opened* | Missing signature or permission | `xattr -cr /Applications/Minerva.app` and open it again |
| *macOS cannot verify the developer* | Unsigned, unnotarised binary | Requires a Developer ID signature and notarization, both macOS-only |
| *The application cannot be opened* after installing | Gatekeeper | System Settings → Privacy & Security → *Open Anyway* |
| The app cannot find the library | Folder permission | System Settings → Privacy & Security → Files and Folders → add your library folder |
| The *Sign in with Apple* shortcut fails | Development environment | A distribution build has to be re-signed with your Apple certificate |

---

## 11. Quick reference

### 11.1 Where everything lives

| I want to… | Where |
| --- | --- |
| Import books | Library → **Import Books** button |
| Organise | **View** menu → *Group by…*, *Sort by…*, *Bookshelves* |
| See a book's details | Context menu → **Show Book Details** |
| Edit metadata | *Show Book Details* → **Edit Metadata** |
| Search inside the content | Library → search field → **Full Text Search** |
| Change the theme | Settings → Theme |
| Change the font | Settings → Font |
| Change the margins | Settings → Layout |
| Open the Notebook | `N` or the **Notebook** button |
| Export highlights | Book menu → **Export Annotations** |
| Import annotations | Book menu → **Import Annotations** |
| Search for an image | Select text → **Photo** button |
| Connect your server | Settings → Integrations → **Minerva Cloud (Cloudflare)** |
| Turn on AI | Settings → AI Assistant |
| See the shortcuts | `Shift + ?` |
| See your statistics | **View** menu → **Reading Statistics** |
| Turn on e-ink mode | Settings → Behavior → Device → **E-Ink Mode** |

### 11.2 Shortcuts people forget

| Shortcut | Why |
| --- | --- |
| `N` | The Notebook is Minerva's own feature |
| `Ctrl + N` | Annotate the selection without touching the mouse |
| `Shift + ?` | The full shortcut list, without hunting through a manual |
| `Ctrl + Shift + P` | The command palette holds almost every setting |
| `Shift + J` / `Shift + P` | Fast switch between paginated and scrolled |
| `Ctrl + B` | A bookmark, always at hand |

### 11.3 Related documents

| Document | Contents |
| --- | --- |
| [`README.md`](../README.md) | What the repository is, backend deployment, project structure |
| [`BUILD_WINDOWS_MACOS.md`](BUILD_WINDOWS_MACOS.md) | Windows cross-compilation, the thumbnail DLL, the macOS blockers, the state of the `Cargo.lock` |
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | Backend runbook: migrations, verification, backups, rollback |
| [`SECURITY.md`](../SECURITY.md) | Threat model, attack surfaces and mitigations |
| [`NOTICE`](../NOTICE) | Original authorship and attributions |

---

## License and attribution

Minerva is free software under the **GNU Affero General Public License v3.0**
or later. The full text is in [`LICENSE`](../LICENSE).

Minerva is an independent project. It derives from
[Readest](https://github.com/readest/readest), © Bilingify LLC and Readest's
contributors, and preserves the original copyright notices as the license
requires. Third-party components keep their own licenses; the list is in the
*Acknowledgments* section of the [`README.md`](../README.md).

> If you run a modified Minerva over a network, section 13 of the AGPL
> obliges you to offer the corresponding source code. Publish your repository
> and point to it in the **About Minerva** dialog.
