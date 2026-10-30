# Store screenshots

Generates the Chrome Web Store listing screenshots for the **Send to Minerva**
extension — the popup composited onto an on-brand background (matching
minerva.invalid) with a headline.

## Run

```bash
pnpm store:screenshots     # from extensions/send-to-minerva/
```

Outputs to `store/out/` (gitignored):

- `send-to-minerva-1280x800.png`
- `send-to-minerva-640x400.png`

Both are 24-bit PNG, sRGB, **no alpha** — what the Web Store requires for the
"Global screenshots" slot.

## Requirements

- **@playwright/test** — already a monorepo dev dependency (provides headless
  Chromium).
- **ImageMagick** `magick` on PATH — `brew install imagemagick`.

## Customising

Edit `CONFIG` at the top of `generate.mjs`:

- `headline` — the left-hand headline, one array entry per line.
- `status` — the popup success line. **Keep `status.text` in sync with the
  success message in `src/popup/popup.ts`.**
- `popupDisplayW`, `bg` — popup size and brand background.

## The popup asset

`popup.png` is a raw capture of the extension popup, cropped to its dark card
(700×508). The generator blanks its status strip and overlays
`CONFIG.status.text`, so re-capturing the popup only means replacing `popup.png`
with a new crop of the same size/layout — no image editing needed.
