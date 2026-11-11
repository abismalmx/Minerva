# Minerva plugin for CrossPoint

An [SD-card plugin](https://github.com/crosspoint-reader/crosspoint-reader/blob/develop/docs/sd-plugins.md)
for [CrossPoint](https://github.com/crosspoint-reader/crosspoint-reader) e-readers
(Xteink X3/X4 and other FreeInk devices) that connects the reader to your
[Minerva](https://minerva.invalid) account:

- **Library**: browse and search the EPUBs in your Minerva cloud library on the
  reader and download them to `/Minerva/` on the SD card.
- **Reading statistics**: every reading session on the reader (active reading
  time and how far you got) is added to your Minerva reading statistics.

## Requirements

- CrossPoint firmware with SD plugin support (the plugin system merged into
  `develop` on 2026-09-30; releases up to 1.6.5 do not include it).
- A Minerva account. Any sign-in method works, since the reader never sees your
  password.
- Books uploaded to Minerva Cloud. Only EPUBs are listed, since that is the
  format CrossPoint reads.

## Install

Download `Minerva-<version>.crosspoint-plugin.zip` from the
[latest Minerva release](https://github.com/minerva/minerva/releases/latest)
and unzip it. Copy the `minerva/` folder to the SD card as
`/.crosspoint/plugins/minerva/` (or `/plugins/minerva/`), then restart the
reader.

## Update

The reader's plugin list shows the installed version under **Minerva**, and
so does the **Minerva** card on the web **Settings** page (see Sign in below
for opening it). On that card, select **Check for update**, then **Update**
when a newer release is available, and reload the page.

## Sign in

Signing in links the reader to your account with a code you approve on the
Minerva web app. The reader gets its own key, which works only for this plugin
and is revoked when you sign out; your password is never stored on the reader.

On the reader, open **File Transfer**, join your Wi-Fi network, and open the
address it shows in a browser on your phone or computer. Go to **Settings**,
find the **Minerva** card, and select **Sign in**. Open the link it shows, check
that the code matches, and select **Link Reader**.

Sign-in happens only on this web page. Until you sign in, **Plugins → Minerva**
on the reader points you to the web page.

Your library then appears on the reader under **Plugins → Minerva**. **Sign
out** revokes the reader's key. Minerva does not sync reading progress: if an
earlier version of the plugin pointed the reader's **KOReader Sync** at Minerva,
signing in or out clears that setting.

## Reading statistics

Reading sessions are queued on the reader and sent to Minerva the next time it
is online: when File Transfer joins a network, or on the way to sleep if Wi-Fi
credentials for the last network are saved. Each session's time is spread over
the pages it covered, in the book's Minerva page count, so it counts like
reading in Minerva. Until a Minerva app has opened the book, sessions are
counted in steps of 1% of the book. Books matching one in your Minerva library
(the same file, identified by its KOReader-compatible partial MD5) merge with
that book's statistics. Others appear under their file hash.

## Development

Tests live with the app, in
`apps/minerva-app/src/__tests__/crosspoint-plugin/minerva-plugin.test.ts`. The
server side is the routes in `apps/minerva-app/src/app/api/crosspoint/` (device
sign-in, catalog and reading sessions)
and the `/link` page where codes are approved. Reader keys and pending sign-ins
live in the tables from `docker/volumes/db/migrations/024_crosspoint_devices.sql`.
