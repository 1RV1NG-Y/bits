import { chmod, copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

if (process.platform !== 'linux') throw new Error('This installer is for Linux desktops.');
if (process.getuid?.() === 0) throw new Error('Run this as your normal user, without sudo.');

const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const arch = process.arch === 'x64' ? 'x86_64' : process.arch;
const source = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(root, 'release', `bits-${pkg.version}-${arch}.AppImage`);
const xdg = process.env.XDG_DATA_HOME;
const dataHome = xdg && path.isAbsolute(xdg) ? xdg : path.join(homedir(), '.local/share');
const executable = path.join(dataHome, 'bits', 'bits.AppImage');
const applications = path.join(dataHome, 'applications');
const desktopFile = path.join(applications, 'bits.desktop');
const iconTheme = path.join(dataHome, 'icons/hicolor');

// Desktop files have their own string escaping and command-line quoting rules.
function desktopString(value) {
  return value.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll('\r', '\\r').replaceAll('\t', '\\t');
}
function execArgument(value) {
  const argument = value.replace(/[\\"`$]/g, '\\$&').replaceAll('%', '%%');
  return desktopString(`"${argument}"`);
}

async function install(destination, mode, { from, text }) {
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    if (from) await copyFile(from, temporary);
    else await writeFile(temporary, text, 'utf8');
    await chmod(temporary, mode);
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}

// Replace the executable atomically so updating does not alter a running image.
await install(executable, 0o755, { from: source });
await install(path.join(iconTheme, '512x512/apps/bits.png'), 0o644, { from: path.join(root, 'build/icon.png') });
await install(path.join(iconTheme, 'scalable/apps/bits.svg'), 0o644, { from: path.join(root, 'public/bits.svg') });
await install(desktopFile, 0o644, { text: `[Desktop Entry]
Version=1.0
Type=Application
Name=bits
GenericName=Knowledge Notes
Comment=Small pieces of information, ready when you need them.
Exec=${execArgument(executable)}
TryExec=${desktopString(executable)}
Icon=bits
Terminal=false
Categories=Utility;
Keywords=knowledge;notes;bits;information;
StartupNotify=true
StartupWMClass=bits
` });

for (const [command, args] of [
  ['desktop-file-validate', [desktopFile]],
  ['update-desktop-database', [applications]],
  ['gtk-update-icon-cache', ['--force', '--ignore-theme-index', iconTheme]],
]) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error?.code === 'ENOENT') continue;
  if (result.error || result.status !== 0) throw new Error(`${command}: ${result.error?.message || result.stderr}`);
}

console.log(`Installed bits: ${executable}`);
console.log(`Applications menu entry: ${desktopFile}`);
console.log('Search for bits in GNOME, then right-click its icon to pin it.');
