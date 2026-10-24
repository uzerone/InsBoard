import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const api = join(root, "apps/api");
const require = createRequire(join(api, "package.json"));
const loader = pathToFileURL(require.resolve("tsx")).href;
const suite = process.argv[2] ?? "all";
if (!["all", "unit", "api"].includes(suite)) throw new Error(`Unknown suite: ${suite}`);

function run(label, args, cwd) {
  console.log(`\n${label}`);
  const result = spawnSync(process.execPath, ["--import", loader, ...args], {
    cwd, stdio: "inherit", env: { ...process.env, OPENAI_API_KEY: "" }
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (suite !== "api") {
  const tests = readdirSync(join(root, "tests")).filter(file => file.endsWith(".test.ts")).sort();
  run("Unit and contract tests", ["--test", ...tests.map(file => join(root, "tests", file))], root);
}
if (suite !== "unit") {
  for (const file of readdirSync(join(api, "tests")).filter(file => file.endsWith("-smoke.ts")).sort()) {
    run(file, [join(api, "tests", file)], api);
  }
}
