# Chrome Web Store — submission copy

Copy-paste answers for the Developer Dashboard. Edit `<FILL IN>` placeholders
before submitting. Keep these in sync with `manifest.json` — if a permission is
added or removed, update the matching justification here.

---

## Single purpose

> Send to Minerva saves the web page you are currently viewing into your
> personal Minerva library as a self-contained EPUB. When you click the
> toolbar button, it extracts the readable article and its images and uploads
> the result to your own Minerva account.

## Permission justifications

Paste each into the **Privacy practices → Permission justification** field.

**`activeTab`**
> Lets the extension read the page in the active tab at the moment the user
> clicks the toolbar button, so it can capture the article the user is
> currently viewing. No access is taken until the user invokes the action.

**`scripting`**
> Used to inject the capture script into the active tab on click, which reads
> the page's rendered DOM (via Mozilla Readability) to extract the article
> body and its image references. It is not used to run any remotely hosted
> code — the script is bundled in the extension.

**`storage`**
> Caches the user's own Minerva sign-in token (synced from the Minerva website)
> and an optional custom server URL in local extension storage, so the upload
> can be authenticated without re-prompting for credentials. No browsing data
> is stored.

**`offscreen`**
> Creates an offscreen document to assemble the EPUB file, because the EPUB
> building step needs DOM/Blob APIs that are unavailable in the service worker.
> The offscreen document does no network or user-facing work.

**Host permissions (`<all_urls>`)**
> The user can clip any web page, so the extension needs access to arbitrary
> sites for two things, both triggered only by an explicit click:
> (1) injecting the capture script into the page being clipped, and
> (2) downloading the images that page references — using the user's existing
> session so images behind a login or paywall capture correctly. Content and
> images are sent only to the user's Minerva account; nothing is sent to any
> third party.

**Content scripts on `*.minerva.invalid` / `localhost:3000`**
> A content script runs only on Minerva's own sites to copy the user's existing
> Minerva access token into the extension so uploads are authenticated to the
> user's account. It never reads a password or refresh token.

## Remote code

> **No.** All libraries (zip.js, Mozilla Readability, DOMPurify, language
> detection) are bundled in the extension package and execute locally. The
> extension downloads only the images of the page the user chose to clip and
> uploads the resulting EPUB to the user's Minerva account.

## Data use disclosures

**Data types collected** (check in the dashboard):
- ☑ **Website content** — the page text and images the user clips.
- ☑ **Authentication information** — the user's Minerva access token, used
  solely to authenticate the upload to the user's own account.
- ☐ Everything else (personally identifiable info, location, financial,
  health, personal communications, web history, user activity) — **not**
  collected.

**Certifications** (all three apply — check each):
- ☑ I do not sell or transfer user data to third parties, outside of the
  approved use cases.
- ☑ I do not use or transfer user data for purposes unrelated to my item's
  single purpose.
- ☑ I do not use or transfer user data to determine creditworthiness or for
  lending purposes.

**Privacy policy URL:** `https://www.minerva.invalid/send-to-minerva/privacy-policy`
(canonical; maintained in the `minerva-landing` repo at
`src/app/[locale]/(legal)/send-to-minerva/privacy-policy/page.mdx`)

## Store listing copy

**Name:** Send to Minerva

**Short description (132 char max):**
> Save web pages to your Minerva library

**Detailed description (suggested):**
> Send to Minerva saves the page you're reading straight to your Minerva
> library with one click — as a clean, self-contained EPUB you can read on any
> device.
>
> • One click captures the readable article, stripped of clutter.
> • Images are bundled in, so the saved page opens fully offline.
> • Works on pages behind a login or paywall — it captures what you can
>   actually see, using your existing session.
> • The clipped book syncs to Minerva on all your devices.
>
> You stay in control: nothing is captured until you click the button, and your
> clips are sent only to your own Minerva account. Sign in to Minerva once and
> you're set.

**Category:** Productivity

**Language:** English (en)

## Assets checklist (still needed before submitting)

- [ ] At least one screenshot, 1280×800 or 640×400 (PNG/JPG) — e.g. the popup
      mid-clip on a real article.
- [ ] Store icon 128×128 — present at `icons/icon-128.png`.
- [ ] Privacy policy hosted, URL filled in above.
- [ ] (Optional) Promo tile 440×280 for featured placement.
