// Builds the Android prototype APK (arm64) and signs it with the local Android debug key
// so it can be installed with `adb install`. Not for distribution.
//
//   npm run sync:android        (from the repository root)
//
// Uses ANDROID_HOME (or ~/Android/Sdk when that has no NDK), NDK_HOME (newest NDK found), JAVA_HOME
// (default /usr/lib/jvm/java-21-openjdk), and ~/.android/debug.keystore.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, mkdirSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// Use ANDROID_HOME when it has an NDK; otherwise the user SDK at ~/Android/Sdk.
const hasNdk = (dir) => dir && existsSync(path.join(dir, "ndk")) && readdirSync(path.join(dir, "ndk")).length > 0;
const sdk = [process.env.ANDROID_HOME, path.join(homedir(), "Android/Sdk")].find(hasNdk);
if (!sdk) throw new Error("No Android SDK with an NDK found. Set ANDROID_HOME, or install one under ~/Android/Sdk.");
const newest = (dir) => readdirSync(dir).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1);
const env = {
  ...process.env,
  ANDROID_HOME: sdk,
  ANDROID_SDK_ROOT: sdk,
  NDK_HOME: process.env.NDK_HOME || path.join(sdk, "ndk", newest(path.join(sdk, "ndk"))),
  JAVA_HOME: process.env.JAVA_HOME || "/usr/lib/jvm/java-21-openjdk",
};
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: "inherit", env, ...opts });

run("npx", ["tauri", "android", "build", "--apk", "--target", "aarch64", "--ci"], { cwd: here });

const unsigned = path.join(here, "src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk");
const tools = path.join(sdk, "build-tools", newest(path.join(sdk, "build-tools")));
const keystore = path.join(homedir(), ".android/debug.keystore");
if (!existsSync(keystore))
  run("keytool", ["-genkeypair", "-keystore", keystore, "-storepass", "android", "-alias", "androiddebugkey", "-keypass", "android",
    "-keyalg", "RSA", "-keysize", "2048", "-validity", "10000", "-dname", "CN=Android Debug,O=Android,C=US"]);
const outDir = path.join(here, "dist");
mkdirSync(outDir, { recursive: true });
const aligned = path.join(outDir, "aligned.apk");
const signed = path.join(outDir, "bits-sync-prototype.apk");
run(path.join(tools, "zipalign"), ["-f", "-p", "4", unsigned, aligned]);
run(path.join(tools, "apksigner"), ["sign", "--ks", keystore, "--ks-pass", "pass:android", "--key-pass", "pass:android", "--out", signed, aligned]);
unlinkSync(aligned);
console.log(`\nSigned APK: ${signed}`);
