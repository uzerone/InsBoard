import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractFile, getRawHeader, listPackage, statFile } from "@electron/asar";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundle = resolve(root, process.argv[2] ?? "release/mac-arm64/InsBoard.app");
const contents = join(bundle, "Contents");
const archive = join(contents, "Resources/app.asar");
execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", bundle], { stdio: "inherit" });
execFileSync("/usr/bin/plutil", ["-lint", join(contents, "Info.plist")], { stdio: "inherit" });
const expectedHash = execFileSync("/usr/libexec/PlistBuddy", ["-c", "Print :ElectronAsarIntegrity:Resources/app.asar:hash", join(contents, "Info.plist")], { encoding: "utf8" }).trim();
const actualHash = createHash("sha256").update(getRawHeader(archive).headerString).digest("hex");
if (expectedHash !== actualHash) throw new Error("ASAR header integrity mismatch");

for (const file of listPackage(archive).filter(file => /\.(node|dylib)$/.test(file))) {
  if (!statFile(archive, file.replace(/^\//, "")).unpacked) throw new Error(`Packed native library: ${file}`);
}
let compared = 0;
function compare(directory, archiveDirectory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.endsWith(".d.ts")) continue;
    const file = join(directory, entry.name);
    const archived = `${archiveDirectory}/${entry.name}`;
    if (entry.isDirectory()) compare(file, archived);
    else {
      if (!readFileSync(file).equals(extractFile(archive, archived))) throw new Error(`Packaged file differs from build output: ${archived}`);
      compared++;
    }
  }
}
for (const directory of ["apps/desktop/dist", "apps/api/dist", "apps/web/dist", "packages/shared/dist"]) compare(join(root, directory), directory);
for (const [directory, pkg] of [["apps/api/dist", "api"], ["packages/shared/dist", "shared"]]) compare(join(root, directory), `node_modules/@insboard/${pkg}/dist`);

execFileSync(join(contents, "MacOS/InsBoard"), ["-e", `
  const base = process.argv[1];
  const SQLite = require(base + '/node_modules/better-sqlite3');
  const db = new SQLite(':memory:');
  if (db.prepare('select 1 as ok').get().ok !== 1) throw new Error('SQLite probe failed');
  db.close();
  require(base + '/node_modules/sharp')({create:{width:2,height:2,channels:4,background:'#fff'}})
    .png().toBuffer().then(buffer => {
      if (!buffer.length) throw new Error('Sharp probe failed');
      console.log('Packaged Electron SQLite and sharp passed.');
    }).catch(error => { console.error(error.message); process.exitCode = 1; });
`, archive], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, stdio: "inherit" });

const require = createRequire(join(root, "apps/api/package.json"));
const SQLite = require("better-sqlite3");
const db = new SQLite(":memory:");
if (db.prepare("select 1 as ok").get().ok !== 1) throw new Error("Development SQLite probe failed");
db.close();
console.log(`Desktop verification passed: signature, integrity, ${compared} build files, native libraries and development SQLite.`);
