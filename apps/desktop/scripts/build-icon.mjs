import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const resources = join(root, "apps/desktop/resources");
const scratch = join(root, ".codex-temp");
mkdirSync(scratch, { recursive: true });
const temporary = mkdtempSync(join(scratch, "macos-icon-"));

try {
  const document = join(temporary, "InsBoard.icon");
  const assets = join(document, "Assets");
  const compiled = join(temporary, "compiled");
  mkdirSync(assets, { recursive: true });
  mkdirSync(compiled);
  copyFileSync(join(resources, "icon.json"), join(document, "icon.json"));
  for (const appearance of ["light", "dark"]) {
    copyFileSync(join(resources, `app-icon-${appearance}.png`), join(assets, `${appearance}.png`));
  }
  execFileSync("xcrun", [
    "actool", document,
    "--compile", compiled,
    "--platform", "macosx",
    "--minimum-deployment-target", "12.0",
    "--app-icon", "InsBoard",
    "--output-partial-info-plist", join(temporary, "icon-info.plist")
  ], { stdio: "inherit" });
  const output = join(scratch, "desktop-icon");
  mkdirSync(output, { recursive: true });
  for (const filename of ["InsBoard.icns", "Assets.car"]) {
    copyFileSync(join(compiled, filename), join(output, filename));
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
