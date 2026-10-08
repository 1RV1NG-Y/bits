const fs = require("node:fs/promises");
const path = require("node:path");

function createStorage(directory, validate) {
  const filename = path.join(directory, "library.json");
  let pending = Promise.resolve();
  return {
    filename,
    async load() {
      try {
        return validate(JSON.parse(await fs.readFile(filename, "utf8")));
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw new Error(
          "Your saved library could not be read. It has been kept intact. Restore a backup to continue.",
        );
      }
    },
    save(data) {
      const valid = validate(data);
      const operation = pending
        .catch(() => {})
        .then(async () => {
          await fs.mkdir(directory, { recursive: true });
          const temp = `${filename}.tmp`;
          const handle = await fs.open(temp, "w", 0o600);
          try {
            await handle.writeFile(JSON.stringify(valid, null, 2));
            await handle.sync();
          } finally {
            await handle.close();
          }
          try {
            await fs.copyFile(filename, `${filename}.bak`);
          } catch (error) {
            if (error.code !== "ENOENT") throw error;
          }
          await fs.rename(temp, filename);
        });
      pending = operation;
      return operation;
    },
    flush() {
      return pending;
    },
  };
}
module.exports = { createStorage };
