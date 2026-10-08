# bits

A local home for small pieces of information you want to find again. Built from the supplied knowledge-card concept, using Folio’s React/Electron foundation. There are no folders, accounts, or required sources.

## Run

```sh
npm install
npx install-electron  # if Electron's binary is not already installed
npm start
```

Requires Node.js 22.12+ and npm. For development, `npm run dev` opens a browser preview at http://127.0.0.1:5174, and `npm run desktop:dev` runs the Electron app with live updates.

## Use

- Add a bit by writing or pasting text. Titles, comma-separated topics, and source notes are optional.
- The grid shows the information itself and preserves paragraphs, lists, and commands. Long entries show their opening; open the card to read the full text. Cards and the reader render Markdown tables, headings, emphasis, lists, blockquotes, and code blocks.
- Cards open in **Read** mode. Use the eye / pencil **Read** and **Edit** buttons to switch; unsaved edits remain available when previewing. Saving returns to the reader. The dialog starts larger and can be resized from its bottom-right corner on desktop. Wide tables and code blocks scroll horizontally.
- Search matches every query word across titles, information, topics, and sources, ignoring case and accents. This is word search; semantic retrieval is not implemented.
- Click a topic to filter the same grid. Favorites combine with search and topic filters. Sort by creation time, last edit, or title.
- Delete in the editor, then use Undo in the notification to restore the bit.
- Library settings includes JSON backup export/import and a confirmed option to start empty. The six initial cards are illustrative notes from the supplied example, not independently verified reference material.
- `/` or `Ctrl/Cmd+K` searches; `Ctrl/Cmd+N` adds; `Ctrl/Cmd+Enter` saves in the editor; `Escape` closes the editor (with an unsaved-changes check) or clears search and the topic.

## Import text from images

In **Add a bit → Import from image**, choose a PNG, JPEG, WebP, BMP, or TIFF. PP-OCRv6 Small extracts the text locally on the CPU and appends it to the editable information field. Review/correct the text and press Save yourself. Existing draft text is preserved, including edits made while OCR is running. Cancel stops the worker and ignores any late result. The source image is neither saved in the library nor deleted.

The installed app has the OCR runtime ready. On a new installation, the same control offers **Set up image import** for a one-time download. Setup requires Python 3.10–3.13 (3.11/3.12 recommended); it installs its own virtual environment and the official Small detection and recognition models. It needs roughly 1.3 GB on disk including Python dependencies (the models themselves are about 30 MB). No GPU, account, API key, or image upload is required. After setup, extraction works offline. The browser preview does not provide image import.

Limits: one image at a time, 25 MB, 40 megapixels, 100,000 resulting characters. This is text OCR, not table/layout reconstruction or AI summarization; difficult images may need manual corrections. EXIF orientation is honored; document rotation/unwarping models are not loaded.

For development, run `npm run setup:ocr`. Runtime/models live under `~/.local/share/bits/ocr` (or `$XDG_DATA_HOME/bits/ocr`). Set `BITS_OCR_HOME` to override that directory, or `BITS_OCR_PYTHON` to choose a supported Python interpreter during setup. The runtime is separate from the AppImage and survives updates. The worker and setup scripts are bundled as application resources.

The model choices and API follow [PaddleOCR’s official OCR documentation](https://github.com/PaddlePaddle/PaddleOCR/blob/main/docs/version3.x/pipeline_usage/OCR.en.md). Versions are pinned in `ocr/requirements.txt`.

AI distillation from URLs/video, global capture shortcuts, synchronization, and semantic retrieval are future work.

## Storage and recovery

The desktop app stores its library in Electron’s user-data directory, normally `~/.config/bits/library.json` on Linux. Saves are serialized and atomic, with the previous version at `library.json.bak`. The app never overwrites an unreadable library automatically. Importing a valid backup is an explicit recovery action. A failed save remains visible with Retry and Export backup controls.

Set `BITS_DATA_DIR` to an absolute directory to use a separate test library. Only one desktop instance per data directory is allowed. The browser preview uses `localStorage` under `bits.library.v1` and is separate from desktop data. Browser storage can be removed by clearing site data, so export backups for portability and safety. Both versions validate imports before replacing anything. Libraries have a 25 MB limit; individual bits accept up to 100,000 content characters and 30 topics.

Deletion and library replacement have immediate Undo. The current notification holds the undo action until dismissed or superseded by another notification, or until the app closes. Import replaces rather than merges; export first if you want to keep both libraries.

No telemetry or cloud OCR service is used. OCR setup downloads packages and model weights; extraction uses the local models. No remote content is fetched when displaying notes. Sources are stored as plain text. Markdown HTML is escaped (except presentational `<br>` line breaks); remote images display their alt text without fetching them. HTTP/HTTPS Markdown links open externally when clicked. Electron uses a sandboxed renderer, context isolation, a limited IPC bridge, caller validation, and blocked navigation/permissions.

## Linux packages

```sh
npm run package
npm run install:linux
```

Packaging creates an AppImage, a tarball, and an unpacked executable in `release/`. The installer registers **bits** in your applications menu and copies the AppImage to `~/.local/share/bits/bits.AppImage` (or `$XDG_DATA_HOME/bits/`). It does not alter Folio.

To reuse an already installed Electron distribution while packaging:

```sh
npm run package -- --config.electronDist=node_modules/electron/dist
```

## Checks

`npm test` covers backup validation, search/filter composition, optional fields, topic normalization, concurrent disk saves, reopening data, and preserving corrupted files. `npm run build` checks the production build. UI verification includes text-only capture, topic filtering, editing, reload persistence, unsaved-change protection, and delete/undo.

OCR tests cover worker validation, cancellation/timeouts, incomplete model setup, draft-safe appending, late results, no-text results, and errors. To exercise the real installed models on a text image, run `node tests/ocr-integration.mjs /absolute/path/to/image.png`.
