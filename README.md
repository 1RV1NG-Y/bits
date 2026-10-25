# bits

A local home for small pieces of information you want to find again. Built from the supplied knowledge-card concept, using Folio’s React/Electron foundation. There are no folders, accounts, or required sources.

## Run

```sh
npm install
npx install-electron  # if Electron's binary is not already installed
npm start
```

Requires Node.js 22.12+, npm, and a Rust toolchain (stable) to build the sync helper; `npm start` builds it. For development, `npm run dev` opens a browser preview at http://127.0.0.1:5174, and `npm run desktop:dev` runs the Electron app with live updates.

## Use

- Add a bit by writing or pasting text. Titles, comma-separated topics, and source notes are optional.
- The grid shows the information itself and preserves paragraphs, lists, and commands. Long entries show their opening; open the card to read the full text. Cards and the reader render Markdown tables, headings, emphasis, lists, blockquotes, and code blocks.
- Cards open in **Read** mode. Use the eye / pencil **Read** and **Edit** buttons to switch; unsaved edits remain available when previewing. Saving returns to the reader. The dialog starts larger and can be resized from its bottom-right corner on desktop. Wide tables and code blocks scroll horizontally.
- Search matches every query word across titles, information, topics, and sources, ignoring case and accents. This is word search; semantic retrieval is not implemented.
- Click a topic to filter the same grid. Favorites combine with search and topic filters. Sort by creation time, last edit, or title.
- Deleting moves a bit to **Trash**, with Undo in the notification. Restore bits from the Trash tab, or empty it to delete them for good.
- Library settings includes JSON backup export and import. Importing adds the bits you don’t have yet (it previews how many) and never replaces anything. **Move all bits to Trash** starts fresh, with Undo.
- **Devices** (the monitor/phone icon in the header) pairs your other devices; see [Sync between devices](#sync-between-devices).
- `/` or `Ctrl/Cmd+K` searches; `Ctrl/Cmd+N` adds; `Ctrl/Cmd+Enter` saves in the editor; `Escape` closes the editor (with an unsaved-changes check) or clears search and the topic.

## Import text from images

In **Add a bit → Import from image**, choose a PNG, JPEG, WebP, BMP, or TIFF. PP-OCRv6 Small extracts the text locally on the CPU and appends it to the editable information field. Review/correct the text and press Save yourself. Existing draft text is preserved, including edits made while OCR is running. Cancel stops the worker and ignores any late result. The source image is neither saved in the library nor deleted.

The installed app has the OCR runtime ready. On a new installation, the same control offers **Set up image import** for a one-time download. Setup requires Python 3.10–3.13 (3.11/3.12 recommended); it installs its own virtual environment and the official Small detection and recognition models. It needs roughly 1.3 GB on disk including Python dependencies (the models themselves are about 30 MB). No GPU, account, API key, or image upload is required. After setup, extraction works offline. The browser preview does not provide image import.

Limits: one image at a time, 25 MB, 40 megapixels, 100,000 resulting characters. This is text OCR, not table/layout reconstruction or AI summarization; difficult images may need manual corrections. EXIF orientation is honored; document rotation/unwarping models are not loaded.

For development, run `npm run setup:ocr`. Runtime/models live under `~/.local/share/bits/ocr` (or `$XDG_DATA_HOME/bits/ocr`). Set `BITS_OCR_HOME` to override that directory, or `BITS_OCR_PYTHON` to choose a supported Python interpreter during setup. The runtime is separate from the AppImage and survives updates. The worker and setup scripts are bundled as application resources.

The model choices and API follow [PaddleOCR’s official OCR documentation](https://github.com/PaddlePaddle/PaddleOCR/blob/main/docs/version3.x/pipeline_usage/OCR.en.md). Versions are pinned in `ocr/requirements.txt`.

AI distillation from URLs/video, global capture shortcuts, and semantic retrieval are future work.

## Sync between devices

bits syncs directly between your own devices over your Wi-Fi network: no account, server, or cloud service. Pair a device from **Devices**: a device that’s already set up shows a code for a new device to scan or paste; a PC that can’t scan shows its own code for your phone to scan. Bits already on both devices are kept. Changes then sync whenever the apps are open on the same network, and pass through any device in between, so Linux and Windows on the same machine stay in step through your phone.

The footer says **Saved on this device** or **received by** your other devices; the latter means they’ve stored the change on disk, which matters before you reboot into another system. If the same field of a bit is changed on two devices that hadn’t seen each other’s change, both versions are kept, the card shows **Two versions**, and the editor lets you pick one or combine them. Edits to different fields, and topics added on different devices, simply combine.

The Android app is currently a test app with its own small interface. The engine, its merge rules, and what has been tested are described in [sync/README.md](sync/README.md). On Linux with `ufw`, allow UDP 47100 (sync) and 5353 (discovery) from your local network; on Windows, allow `bits-sync-helper.exe` on private networks when asked.

## Storage and recovery

The desktop app keeps its library in the `sync` folder of Electron’s user-data directory (normally `~/.config/bits/sync` on Linux, `%APPDATA%\bits\sync` on Windows). Each change is written to disk, checksummed, and fsynced before the app reports it saved; a change that can’t be written is rolled back and reported, and your draft stays in the editor. An unreadable library is never overwritten automatically.

**Upgrading from 1.2 or earlier:** on first start, the old `library.json` is renamed to `library.pre-sync.json` (your backup) and every bit is moved into the synced library with its id, dates, topics, source, and favorite, then checked field by field. An interrupted move resumes on the next start. If the old file can’t be read, it is left untouched and the app offers to restore a backup instead. Once upgraded, don’t open an older version of bits: it would no longer find your library.

Set `BITS_DATA_DIR` to an absolute directory to use a separate test library, and `BITS_SYNC_PORT` to run a second instance on one machine. Only one desktop instance per data directory is allowed. The browser preview uses `localStorage` and is separate from desktop data, with no sync. Export backups for portability and safety. Libraries have a 25 MB limit; individual bits accept up to 100,000 content characters and 30 topics.

Trash, Move all to Trash, and imports apply to all your paired devices. Undo stays available until the notification is dismissed or replaced, or the app closes; Trash keeps deleted bits after that.

No telemetry, cloud sync, or cloud OCR service is used; devices talk to each other directly, encrypted and authenticated with per-device keys. OCR setup downloads packages and model weights; extraction uses the local models. No remote content is fetched when displaying notes. Sources are stored as plain text. Markdown HTML is escaped (except presentational `<br>` line breaks); remote images display their alt text without fetching them. HTTP/HTTPS Markdown links open externally when clicked. Electron uses a sandboxed renderer, context isolation, a limited IPC bridge, caller validation, and blocked navigation/permissions.

## Linux packages

```sh
npm run package
npm run install:linux
```

Packaging creates an AppImage, a tarball, and an unpacked executable in `release/`. The installer registers **bits** in your applications menu and copies the AppImage to `~/.local/share/bits/bits.AppImage` (or `$XDG_DATA_HOME/bits/`). It does not alter Folio.

Packages include the sync helper. To reuse an already installed Electron distribution while packaging:

```sh
npm run package -- --config.electronDist=node_modules/electron/dist
```

## Windows

Each push builds bits on Windows in CI (`.github/workflows/windows.yml`) and uploads **bits-windows-x64**, a zip: extract it and run `bits.exe`. To build it yourself on Windows you need Node 22+, Rust (MSVC), and the Visual Studio C++ build tools; then run `npm ci` and `npm run package:win`. The zip is unsigned and not an installer. Image import (OCR) setup has only been tested on Linux.

## Checks

`npm test` covers backup validation, search/filter composition, optional fields, topic normalization, and moving a pre-sync library into sync (every field kept, resuming after interruption, unreadable files left untouched; needs `npm run sync:helper` first). `npm run sync:test` covers the sync engine: storage, merge rules, pairing, and multi-device scenarios. `npm run build` checks the production build. UI verification includes text-only capture, topic filtering, editing, reload persistence, unsaved-change protection, and delete/undo.

OCR tests cover worker validation, cancellation/timeouts, incomplete model setup, draft-safe appending, late results, no-text results, and errors. To exercise the real installed models on a text image, run `node tests/ocr-integration.mjs /absolute/path/to/image.png`.
