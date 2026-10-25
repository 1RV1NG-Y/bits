# bits sync

Device-to-device sync for bits: **Loro** for replicated data, **iroh** for peer-to-peer QUIC with
local-network discovery, one Rust core on Linux, Windows, and Android. No accounts, servers, or
cloud services. The desktop app uses it through a bundled helper process; the Android app links
the core directly.

Status: stages 1–3 of the sync plan are done, and stage 4 is under way. Sync works in the main
desktop app, with the merge rules from stage 2 and the pre-sync library migrated automatically.
The Android app now runs the same bits interface as the desktop (Read/Edit, Trash, two-version
picker, Devices with QR scanning); the Android share menu is still to come.

## Layout

| Path | What it is |
|---|---|
| `core/` | `bits-sync` crate: document model and merge rules (`model.rs`), durable storage (`store.rs`), pairing, sync sessions and reconnection (`node.rs`), wire format (`proto.rs`). `rpc.rs` is the API every front end uses. |
| `helper/` | `bits-sync-helper`: desktop process serving the core to Electron as JSON lines over stdio. It exits when stdin closes or when its parent process dies, so a crashed window never leaves it holding the library. |
| `android/` | Tauri v2 app that links the core into the APK and bundles the main bits UI (`dist/`, built from `src/`). `src-tauri/gen/android` is the generated Gradle project, with a multicast lock and system-bar insets in `MainActivity.kt`, backup disabled, and ML Kit keep rules for QR scanning. |
| `tests/` | End-to-end test of two real helper processes. |

The rest lives with the app: `electron/sync-helper.cjs` starts the helper, `electron/migrate.cjs`
moves the pre-sync library in, and `src/library.mjs` is what the UI calls, with one
implementation for the desktop (helper), one for Android (Tauri commands), and one for the
browser preview (no sync).

## Build and test

From the repository root:

```sh
npm run sync:helper      # build the helper (npm start and npm run package do this too)
npm run sync:test        # Rust tests + helper process test
npm run sync:android     # build + sign sync/android/dist/bits-sync-prototype.apk (arm64)
```

Android builds need an SDK with an NDK (`ANDROID_HOME`, or `~/Android/Sdk`), JDK 21, and the
`aarch64-linux-android` Rust target. The APK is signed with the local Android debug key and is
only for testing.

### Windows

Sync was verified on a real Windows install with the stage 1 test app, including the
Linux → phone → Windows handoff. The main app's Windows build is checked by CI; using it on your
Windows install is the next manual check. The `Windows` workflow (`.github/workflows/windows.yml`) builds on Windows with MSVC, runs the
sync and app tests, and uploads `bits-windows-x64`, a zip of the app. Extract it and run
`bits.exe`. On first launch, Windows Defender Firewall asks about `bits-sync-helper.exe`: allow
it on **private networks**. To build locally on Windows you need Node 22+, Rust (MSVC), and the
Visual Studio C++ build tools, then `npm ci` and `npm run package:win`.

To pair a PC while your other PCs are off: on the PC, open **Devices → Show this device's code**;
on the phone, open **Devices → Scan code**.

### Installing on a phone over Wi-Fi (no USB)

1. On the phone: **Settings → Developer options → Wireless debugging → on**, then **Pair device
   with pairing code**. Note the IP, pairing port and code shown.
2. On the PC: `adb pair PHONE_IP:PAIRING_PORT` and enter the code.
3. Then `adb connect PHONE_IP:PORT` using the port on the main Wireless debugging screen (it
   differs from the pairing port).
4. `adb install -r sync/android/dist/bits-sync-prototype.apk`

Wireless debugging turns itself off when the phone leaves or changes Wi-Fi, and picks a new port
when it comes back. While connected, `adb tcpip 5555` switches to a fixed port until the phone
reboots; then `adb connect PHONE_IP:5555`. A DHCP reservation keeps the phone's IP fixed.

### Linux firewall

If `ufw` is active it blocks inbound UDP. Sync uses UDP port **47100** and mDNS uses UDP
**5353**. Allow them from your local network (adjust the subnet):

```sh
sudo ufw allow from 192.168.100.0/24 to any port 47100 proto udp
sudo ufw allow from 192.168.100.0/24 to any port 5353 proto udp
```

## How it works

- **Data:** one Loro document per library. Each note's `title`, `body` and `source` is a
  multi-value register: every save records which versions it replaces (the ones its editor
  opened). If two devices change the same field without having seen each other's change, both
  versions are kept and the note is flagged; the app shows them side by side, and saving
  settles the field everywhere. Edits to different fields combine without a conflict. A save
  based on an older version never overwrites a newer change it hadn't seen, and after saving
  the editor continues from the note as stored, so a second save can't send back stale
  fields. Topics are stored one by one and changed relative to the topics the editor opened
  with, so topics added on another device meanwhile are kept and removals stick. Every note and
  field lives in a *mergeable* container: devices that create the same note independently
  (for example, both importing the same backup) get the same container, and imported text
  gets version ids derived from its content, so their later edits merge instead of one copy
  replacing the other. Favorite,
  Trash, and edit time are last-writer-wins. A note moved to Trash on one device while edited
  on another stays in Trash with the edit kept, and an old copy reconnecting can't bring a
  deleted note back. `devices` holds membership and `addresses` each device's current LAN
  addresses; both replicate, so a device paired through the phone becomes known to the others.
- **Durability:** every change is appended to a checksummed log (`library.log`) and fsynced
  before a save returns or a peer's update is acknowledged. The log compacts into
  `library.snapshot` at 4 MB. A torn final record is dropped on open (the original log is kept
  as `library.log.damaged-*`). If compaction fails partway, saving continues on whichever log
  is on disk. An exclusive lock stops two processes opening the same library.
- **All-or-nothing changes:** if a change can't be written to disk, it is rolled back (Loro's
  `revert_to`) and the error says nothing was saved; the editor keeps your draft. Nothing
  unsaved is ever sent to other devices, so "received by X" always means X holds changes that
  also survive on this device.
- **Schema:** `meta.json` records the document layout. Layout 2 (plain child containers) is
  upgraded on open: notes move into mergeable containers keeping their version ids, which
  every device already shares, so devices that upgrade separately end up identical. The
  upgrade is saved before the new layout is recorded, so an interrupted upgrade resumes. Data
  from the stage 1 prototype (layout 1) is refused with a clear message. Devices on different
  layouts refuse to sync until both are updated.
- **Identity:** each installation has its own `device.key` (an iroh key). On Android, cloud backup
  and device-to-device transfer are disabled (`allowBackup="false"` plus
  `data_extraction_rules.xml`), so a new phone can't inherit another phone's identity.
- **Pairing:** a pairing code (QR or `BITS2…` text) carries the device's address and a
  single-use secret valid for 10 minutes. A device that is already set up shows a *join* code:
  the scanner joins its library. A device with no paired devices shows an *add* code: a set-up
  device (normally the phone) scans it and brings it in. Either way, notes already on both
  devices are kept and merged. The device that changes library saves the library id first and
  the trust record second, so a failure or crash at either step leaves it unpaired and able to
  retry.
- **Sync:** `bits/sync/1` accepts only devices listed in `devices`, with the peer's identity
  authenticated by QUIC/TLS. Each side sends `Hello` with its protocol version and durable
  version vector, then the updates the other lacks. Each batch is acknowledged after it is on
  disk. Received changes are pushed on to other connected devices, which is how changes travel
  through the phone. One connection is kept per pair.
- **Reconnection:** every 2 s, each device dials paired devices it isn't connected to, with
  backoff. Addresses come from mDNS, the shared `addresses` map, and the last session. QUIC
  keep-alives detect a vanished peer within about 8 s.
- **Status:** "Saved on this device" vs "received by X" comes from each peer's durable
  acknowledgements, stored in `peers.json`, so it survives restarts.

## What was verified

| Check | How | Result |
|---|---|---|
| Storage: reopen, torn tail, compaction, foreign file left untouched, interrupted compaction | `cargo test` unit tests | pass |
| Merge rules: same field edited apart keeps both versions and resolves everywhere; different fields combine; old-base save keeps newer remote change; topics combine and removals stick; delete vs edit; stale copy can't revive a deleted note; import keeps ids/dates and is idempotent | `cargo test` unit tests | pass |
| Same note imported independently on two devices: different-field edits both survive; same-field edits become two versions | unit tests | pass |
| Old draft saved after topics were added elsewhere keeps those topics | unit test | pass |
| Second save in one editor session doesn't send back a field another device changed | UI test | pass |
| Layout 2 upgrade: two devices upgrading separately end identical, conflicts kept, resumable; on-disk upgrade on open | unit + node tests; a copy of the real library (8 bits, every field equal to the original) | pass |
| A failed save is rolled back, never sent, and no peer reports holding it | unit test (injected write failure) | pass |
| Pairing interrupted at either write, in both directions, then a restart: device is unpaired and a new code works | unit test | pass |
| **Dual-boot handoff:** Linux → phone → (Linux off) Windows pairs by showing its code to the phone → phone → (Windows off) Linux, incl. a note made on the phone between boots | integration test; Linux and Windows never run together | pass |
| Pairing, single-use codes, forwarding, restarts, offline edits converge, Trash, device removal, second process refused | 3-device integration test | pass |
| Acknowledged save survives `kill -9`; restart reconnects | `sync/tests/helper.test.mjs` | pass |
| Pre-sync library migration: every field kept, original kept as backup, resumes after interruption, unreadable file left untouched, fresh install starts empty | `tests/migrate.test.mjs` (real helper) | pass |
| Main app on a copy of a real library: migration, edit, favorite, Trash/restore, import skips existing bits, pairing two instances, offline same-field edits shown as two versions and resolved from the editor | two desktop instances driven through the UI | pass |
| Window force-killed: helper exits within about a second; relaunch works | packaged Linux build | pass |
| Windows: sync core and helper tests, packaging | CI | pass |
| Windows: stage 1 test app on a real install, incl. the handoff through the phone | manual | pass |
| Windows: main app on a real install | manual | not yet |
| Real phone (Galaxy S22, Android 16): QR pairing, mDNS on home Wi-Fi, edits both ways, field merge, no internet, reconnect | manual (stage 1 test app) | pass |
| Real phone with the main bits UI: paired with the installed desktop app, library synced, Read mode, Back closes dialogs before leaving | manual | pass |
| mDNS rediscovery after both devices change port | two helpers | reconnected in about 1 s |

Real-device findings fixed along the way: release builds stripped parts of ML Kit that the QR
scanner loads by reflection (keep rules in `proguard-rules.pro`); the Windows window threw an
error on close when a peer was connected (events are now sent only to a live window).

## Known limitations

- Android: no share-menu target yet, backups are made from a desktop, image import (OCR) is
  desktop-only, and the package id is still `com.bits.syncprototype` (changing it means a fresh
  install). The APK is debug-signed.
- One library per device. A paired device can add others but can't join a second library.
- Removal is advisory: a removed device keeps its copy and is only refused future syncs.
- Sync runs while an app is open. Android background behaviour hasn't been measured.
- No relay or internet path: devices sync on the same network.
- Loro keeps full edit history, so the stored library grows with every save of a long bit.
  Compaction into a shallow snapshot is future work.
- Windows packages are unsigned zips, not an installer.
