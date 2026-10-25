// End-to-end check of the desktop helper processes: pairing, sync, a hard kill
// right after a save is acknowledged, and reconnection after restart.
// Requires `cargo build --release -p bits-sync-helper` (run from sync/).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const { startHelper } = createRequire(import.meta.url)("../../electron/sync-helper.cjs");
const quiet = { write() {} };

async function waitFor(what, check, timeout = 20000) {
  const end = Date.now() + timeout;
  for (;;) {
    if (await check()) return;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

test("two helper processes pair, sync, survive a hard kill, and reconnect", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "bits-sync-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dirA = path.join(root, "a"), dirB = path.join(root, "b");
  const start = (dir, name, port) => startHelper({ dataDir: dir, name, port, log: process.env.SYNC_LOG ? process.stderr : quiet });

  const a = start(dirA, "Desk", 47181);
  let b = start(dirB, "Laptop", 47182);
  t.after(() => Promise.all([a.stop(), b.stop()]));
  await a.ready;
  await b.ready;

  const invite = await a.request("createInvite");
  assert.match(invite.qrSvg, /<svg/);
  assert.deepEqual(await b.request("join", { ticket: invite.ticket }), { device: "Desk", joined: false });

  const note = await a.request("createNote", { body: "Saved on the desk", topics: ["Sync", "sync", " Test "] });
  assert.deepEqual(note.topics, ["Sync", "Test"]);
  await waitFor("note on B", async () => (await b.request("notes")).some((n) => n.id === note.id));
  await waitFor("A sees B has everything", async () =>
    (await a.request("status")).devices.some((d) => d.name === "Laptop" && d.connected && d.hasAllMyChanges));

  // A save acknowledged by the helper must survive an immediate hard kill.
  const late = await b.request("createNote", { body: "Written just before a crash" });
  b.process.kill("SIGKILL");
  await new Promise((r) => b.events.once("exit", r));
  await waitFor("A notices B is gone", async () =>
    !(await a.request("status")).devices.find((d) => d.name === "Laptop").connected);

  await a.request("updateNote", { id: note.id, patch: { title: "Edited while B was down" } });
  b = start(dirB, "Laptop", 47182);
  await b.ready;
  assert.ok((await b.request("notes")).some((n) => n.id === late.id), "acknowledged save survived the kill");
  await waitFor("B caught up after restart", async () =>
    (await b.request("notes")).some((n) => n.id === note.id && n.title === "Edited while B was down"));
  await waitFor("A received B's pre-crash note", async () =>
    (await a.request("notes")).some((n) => n.id === late.id));
  assert.equal((await b.request("status")).libraryId, (await a.request("status")).libraryId);
});
