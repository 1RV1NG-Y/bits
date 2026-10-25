// One-time move of the pre-sync library (library.json) into the synced store.
//
// Order, chosen so an interruption at any point is safe to resume:
// 1. Read and validate library.json. An unreadable file is left untouched and reported.
// 2. Rename it to library.pre-sync.json. That file is the backup, and old versions of
//    bits no longer find a library.json to diverge from.
// 3. Import every bit with its id, dates, topics, source and favorite. Bits already in
//    the store are skipped, so a resumed run adds nothing twice.
// 4. Read everything back and compare field by field.
// 5. Write sync/migrated.json. Only then is the migration considered done.
// Nothing here touches the network; migrating never shares anything by itself.
const fs = require("node:fs/promises");
const path = require("node:path");

const exists = (file) => fs.access(file).then(() => true, () => false);

function toImported(entry) {
  const { id, title, body, source, topics, favorite, createdAt, updatedAt } = entry;
  return { id, title, body, source, topics, favorite, createdAt, updatedAt };
}

function same(note, entry) {
  return note && note.title === entry.title && note.body === entry.body && note.source === entry.source &&
    note.favorite === entry.favorite && note.createdAt === entry.createdAt && note.updatedAt === entry.updatedAt &&
    JSON.stringify(note.topics) === JSON.stringify(entry.topics);
}

/**
 * @returns {Promise<{ migrated: number } | null>} the number of bits moved, or null when
 *   there was nothing to do.
 */
async function migrateLegacyLibrary({ userData, helper, validate }) {
  const marker = path.join(userData, "sync", "migrated.json");
  if (await exists(marker)) return null;
  const legacy = path.join(userData, "library.json");
  const backup = path.join(userData, "library.pre-sync.json");
  const source = (await exists(backup)) ? backup : (await exists(legacy)) ? legacy : null;
  let entries = [];
  if (source) {
    try {
      entries = validate(JSON.parse(await fs.readFile(source, "utf8"))).entries;
    } catch {
      throw new Error(
        `Your library from before sync (${path.basename(source)}) could not be read. It has been kept intact. Restore a backup to continue.`,
      );
    }
    if (source === legacy) await fs.rename(legacy, backup);
  }
  if (entries.length) {
    await helper.request("importNotes", { notes: entries.map(toImported) });
    const stored = new Map((await helper.request("notes")).map((n) => [n.id, n]));
    const wrong = entries.filter((e) => !same(stored.get(e.id), e));
    if (wrong.length)
      throw new Error(`Moving your library into sync didn't check out for ${wrong.length} bits. Your original is kept at ${backup}.`);
  }
  await markMigrated(userData, { from: source && path.basename(backup), count: entries.length });
  return { migrated: entries.length };
}

/** Records that there is nothing (more) to migrate, e.g. after restoring a backup instead. */
async function markMigrated(userData, details = {}) {
  const marker = path.join(userData, "sync", "migrated.json");
  await fs.mkdir(path.dirname(marker), { recursive: true });
  await fs.writeFile(marker, JSON.stringify({ migratedAt: new Date().toISOString(), ...details }, null, 2), { mode: 0o600 });
}

module.exports = { migrateLegacyLibrary, markMigrated };
