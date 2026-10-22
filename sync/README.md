# bits sync — stage 1 prototype

A standalone prototype that tests **Loro** (replicated data) and **iroh** (peer-to-peer QUIC with
LAN discovery), using one Rust core on Linux and Android. It has its own data and doesn't read or
change the main bits library.

## Layout

| Path | What it is |
|---|---|
| `core/` | `bits-sync` crate: Loro document model, durable storage, pairing, sync sessions, reconnection. `rpc.rs` defines the API every front end uses. |
| `helper/` | `bits-sync-helper`: desktop process that serves the core to Electron as JSON lines over stdio. |
| `desktop/` | Electron host (`main.cjs`, `preload.cjs`), the Node client for the helper (`helper-client.cjs`), and packaging (`electron-builder.yml`). The helper exits when stdin closes or when its parent process dies, so a crashed window never leaves it holding the library. |
| `ui/` | Shared React UI (notes, editor, devices, pairing). Used by Electron and bundled into Android. Reuses Bits' Markdown renderer and palette. |
| `android/` | Tauri v2 app that links the core into the APK. `src-tauri/gen/android` is the generated Gradle project, with a multicast lock and system-bar insets added to `MainActivity.kt`. |
| `tests/` | End-to-end test of two real helper processes. |

## Run it

From the repository root:

```sh
npm run sync:desktop          # build helper + UI, open the desktop prototype
npm run sync:android          # build + sign sync/android/dist/bits-sync-prototype.apk (arm64)
npm run sync:test             # Rust tests + helper process test
```

To run a second independent desktop device on one machine (for example, to watch forwarding),
give it its own profile: `npx electron sync/desktop/main.cjs --profile=laptop`. Set
`BITS_SYNC_DATA_DIR`, `BITS_SYNC_NAME`, and `BITS_SYNC_PORT` to override the data directory,
device name, and port.

Android builds need the SDK in `~/Android/Sdk` (or `ANDROID_HOME`), an NDK, JDK 21, and the
`aarch64-linux-android` Rust target. The APK is signed with the local Android debug key and is
only for testing.

### Windows

Windows builds come from CI on a real Windows machine (`.github/workflows/sync-windows.yml`,
the same approach as quests). It runs the core and helper tests with MSVC and uploads
`bits-sync-prototype-windows-x64`, a zip. Extract it anywhere and run
`bits-sync-prototype.exe`. On first launch, Windows Defender Firewall asks about
`bits-sync-helper.exe`: allow it on **private networks**. Building locally on Windows needs
Node 22+, Rust (MSVC), and the Visual Studio C++ build tools, then:

```powershell
npm ci
npm run sync:helper
npm run sync:ui
npx electron-builder --config sync/desktop/electron-builder.yml --win zip --x64
```

To pair Windows while Linux is off: on Windows, open **Devices → Show this device's code**;
on the phone, open **Devices → Scan code**.

### Installing on a phone over Wi-Fi (no USB)

1. On the phone: **Settings → Developer options → Wireless debugging → on**, then **Pair device
   with pairing code**. Note the IP, pairing port and code shown.
2. On the PC: `adb pair PHONE_IP:PAIRING_PORT` and enter the code.
3. Then `adb connect PHONE_IP:PORT` using the port on the main Wireless debugging screen (it
   differs from the pairing port).
4. `adb install -r sync/android/dist/bits-sync-prototype.apk`

### Desktop firewall

`ufw` is active on this machine and blocks inbound UDP by default. Sync uses UDP port **47100**
(desktop and phone), and mDNS uses UDP **5353**. Allow them from the local network:

```sh
sudo ufw allow from 192.168.100.0/24 to any port 47100 proto udp
sudo ufw allow from 192.168.100.0/24 to any port 5353 proto udp
```

Without these rules, only connections the desktop starts get through. Pairing by scanning the
desktop's code then fails, and reconnecting depends on the desktop dialing the phone.

## How it works

- **Data:** one Loro document per library. `notes` maps note id → a map of fields, with each
  field a last-writer-wins register, so concurrent edits to *different* fields combine. Deletion
  is a `deleted` flag (Trash). `devices` holds membership; `addresses` holds each device's
  current LAN addresses. Both replicate, so a device paired through the phone becomes trusted
  and reachable by the others.
- **Durability:** every change is appended to a checksummed log (`library.log`) and fsynced
  before a save returns or a peer's update is acknowledged. The log compacts into
  `library.snapshot` at 4 MB. A torn final record is dropped on open (the original log is kept
  as `library.log.damaged-*`). If compaction fails partway, saving continues on whichever log
  is on disk. An exclusive lock stops two processes opening the same library.
- **Only durable changes leave the device:** while a local save has failed (disk full, I/O
  error), nothing is sent to peers and the status says so. The save is retried every 2 s. So
  "received by X" always means X holds changes that also survive on this device.
- **Identity:** each installation has its own `device.key` (an iroh key). On Android, cloud backup
  and device-to-device transfer are disabled (`allowBackup="false"` plus
  `data_extraction_rules.xml`), so a new phone can't inherit another phone's identity. A restore
  path that brings back notes under a fresh identity belongs to stage 3.
- **Pairing:** a pairing code (QR or `BITS2…` text) carries the device's address and a
  single-use secret valid for 10 minutes. A device that is already set up shows a *join* code:
  the scanner joins its library. A device with no paired devices shows an *add* code: a set-up
  device (normally the phone) scans it and brings it in. That is how a PC without a camera pairs
  while your other PCs are off. Either way, notes already on both devices are kept and merged.
  The device that changes library saves the library id first and the trust record second, so
  a failure or crash at either step leaves it unpaired and able to retry.
- **All-or-nothing changes:** if a local change can't be written to disk, it is rolled back
  (with Loro's `revert_to`) and the error says nothing was saved. The editor keeps your draft.
- **Sync:** `bits/sync/1` accepts only devices listed in `devices`, with the peer's identity
  authenticated by QUIC/TLS. Each side sends `Hello` with its durable version vector, then the
  updates the other lacks. Each batch is acknowledged after it is on disk. Received changes
  trigger pushes to other connected peers, which provides forwarding. One connection is kept per
  pair (the one dialed by the smaller id).
- **Reconnection:** every 2 s, each device dials paired devices it isn't connected to, with
  backoff. Addresses come from mDNS, the shared `addresses` map, and the last session. QUIC
  keep-alives detect a vanished peer within about 8 s.
- **Status:** "Saved on this device" vs "received by X" comes from each peer's durable
  acknowledgements, stored in `peers.json`, so it survives restarts.

## What was verified

| Check | How | Result |
|---|---|---|
| Storage: reopen, torn tail, compaction, foreign file left untouched | `cargo test` unit tests | pass |
| Compaction interrupted while replacing the log: later saves still work | unit test (obstructed temp file) | pass |
| A failed save is never sent; no peer reports holding it; it syncs after the retry succeeds | unit test (injected write failure) | pass |
| Pairing interrupted at either write, in both directions (join code and add code), then a restart: device is unpaired and a new code works | unit test (obstructed `meta.json`, injected failure) | pass |
| A failed save is rolled back and never appears on any device | unit test | pass |
| Window process force-killed: helper exits within about a second; relaunch works (no stale lock) | packaged Linux build | pass |
| **Dual-boot handoff:** Linux → phone → (Linux off) Windows pairs by showing its code to the phone → phone → (Windows off) Linux, incl. a note made on the phone between boots | integration test; Linux and Windows are never running together | pass |
| Real phone (Galaxy S22, Android 16): QR pairing, mDNS on home Wi-Fi, edits both ways, field merge, no internet, reconnect after closing either app | manual | pass |
| Pairing, single-use invites, already-paired refusal | 3-device in-process test | pass |
| Membership and changes spread through a middle device | same (A and C may also connect directly here; the dual-boot test covers relay-only) | pass |
| Concurrent edits to different fields combine | same | pass |
| Restart while others edit; offline edits on two devices converge | same | pass |
| Trash replicates; removed device is cut off | same | pass |
| Second process on one library is refused | same | pass |
| Acknowledged save survives `kill -9`; restart reconnects | `sync/tests/helper.test.mjs` (two real helper processes) | pass |
| mDNS rediscovery after **both** devices change port | ad-hoc two-helper script | reconnected in about 1 s |
| Electron prototype ↔ helper, pairing by pasted invitation, notes both ways, "received by" status | two Electron instances driven through the real UI | pass |
| Android (API 36 emulator): app starts, joins desktop library, edits both ways, force-stop + relaunch catches up, Back button, keyboard insets, reinstall while running | emulator + two desktop instances | pass |
| Android backup off: package flags no longer include `ALLOW_BACKUP` | `dumpsys package` on the emulator | pass |
| Main bits app | `npm test`, `npm run build` | unchanged, pass |

**Not yet verified:** the Windows build itself, by CI and on your Windows install.

Real-phone finding: release builds stripped parts of ML Kit (used by the QR scanner) that it
loads by reflection, which crashed scanning. Keep rules are in
`src-tauri/gen/android/app/proguard-rules.pro`.

## Known limitations (deliberate for stage 1)

- Same-field concurrent edits are last-writer-wins at the field level. Stage 2 replaces this with
  "preserve both versions and flag the note".
- Topics are one register per note, so concurrent topic additions don't combine yet (stage 2).
- One library per device. A paired device can add others but can't join a second library.
- Removal is advisory: a removed device keeps its copy and is only refused future syncs.
- Sync runs while the app is open. Android background behaviour hasn't been measured.
- No relay or internet path: both devices must be on the same network.
