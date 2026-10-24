import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFile, cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, sep } from "node:path";
import { createPackageWithOptions, extractAll, getRawHeader, listPackage, statFile, uncache } from "@electron/asar";
import { rebuild } from "@electron/rebuild";
import { Arch } from "electron-builder";

// afterPack runs before signing. Rebuild only a disposable copy of the packaged
// dependencies so Electron never replaces the development Node SQLite binary.
export default async function rebuildPackagedNative(context) {
  if (context.electronPlatformName !== "darwin") throw new Error("Desktop packaging currently supports macOS only.");
  const arch = Arch[context.arch];
  if (arch !== "arm64" && arch !== "x64") throw new Error(`Unsupported desktop architecture: ${arch}`);
  const contents = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents");
  const archive = join(contents, "Resources", "app.asar");
  const scratch = join(context.packager.projectDir, ".codex-temp", "desktop-native");
  await mkdir(scratch, { recursive: true });
  const work = await mkdtemp(join(scratch, "package-"));
  const stage = join(work, "app");
  const native = join(work, "sqlite-source");
  const require = createRequire(join(context.packager.projectDir, "apps/api/package.json"));
  const sqliteSource = dirname(require.resolve("better-sqlite3/package.json"));
  try {
    extractAll(archive, stage);
    // electron-builder removes binding.gyp and C++ sources from the package.
    // Compile a complete source copy, then transfer only the resulting binary.
    await cp(sqliteSource, native, {
      recursive: true,
      filter: file => !["build", "node_modules"].includes(relative(sqliteSource, file).split(sep)[0])
    });
    await rebuild({
      buildPath: native,
      projectRootPath: native,
      electronVersion: context.packager.info.framework.version,
      arch,
      onlyModules: ["better-sqlite3"],
      force: true,
      buildFromSource: true
    });
    await copyFile(join(native, "build/Release/better_sqlite3.node"), join(stage, "node_modules/better-sqlite3/build/Release/better_sqlite3.node"));
    await rm(archive);
    await rm(`${archive}.unpacked`, { recursive: true, force: true });
    uncache(archive);
    // ASAR matches this glob against absolute paths. A basename pattern also
    // matches inside .codex-temp, and keeps sharp's dynamic library on disk.
    await createPackageWithOptions(stage, archive, { unpack: "*.{node,dylib}" });
    uncache(archive);
    for (const file of listPackage(archive).filter(file => /\.(node|dylib)$/.test(file))) {
      if (!statFile(archive, file.replace(/^\//, "")).unpacked) throw new Error(`Native library was packed inside ASAR: ${file}`);
    }
    const hash = createHash("sha256").update(getRawHeader(archive).headerString).digest("hex");
    execFileSync("/usr/libexec/PlistBuddy", [
      "-c", `Set :ElectronAsarIntegrity:Resources/app.asar:hash ${hash}`,
      join(contents, "Info.plist")
    ]);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
