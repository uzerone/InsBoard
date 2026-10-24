import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoots = ["apps/web/src", "apps/api/src", "apps/desktop/src", "packages/shared/src"];
const failures = [];
const graph = new Map();
const name = file => relative(root, file).replaceAll("\\", "/");

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = join(directory, entry.name);
    return entry.isDirectory() ? files(file) : /\.(ts|tsx)$/.test(file) ? [file] : [];
  });
}

function localTarget(file, specifier) {
  if (specifier === "@insboard/shared") return join(root, "packages/shared/src/index.ts");
  if (specifier === "@insboard/api") return join(root, "apps/api/src/index.ts");
  if (!specifier.startsWith(".")) return null;
  const target = resolve(dirname(file), specifier).replace(/\.js$/, "");
  return [target, `${target}.ts`, `${target}.tsx`, `${target}/index.ts`, `${target}/index.tsx`].find(candidate => existsSync(candidate) && /\.(ts|tsx)$/.test(candidate));
}

function checkImport(file, specifier, typeOnly) {
  const from = name(file);
  const target = localTarget(file, specifier);
  const to = target ? name(target) : specifier;
  const reject = reason => failures.push(`${from} → ${to}: ${reason}`);
  if (specifier.startsWith(".") && !target && !/\.(css|svg|png)$/.test(specifier)) reject("unresolved local import");
  if (from.startsWith("packages/shared/") && (to.startsWith("apps/") || /^(node:|react|electron)/.test(to))) reject("shared contracts must be runtime independent");
  if (from.startsWith("apps/web/") && /^(apps\/(api|desktop)\/|node:|electron)/.test(to)) reject("web code cannot import server or native code");
  if (from.startsWith("apps/web/src/shared/") && to.startsWith("apps/web/src/features/")) reject("shared web code cannot depend on features");
  if (/apps\/web\/src\/features\/canvas\/editor\/.*\.ts$/.test(from) && !typeOnly && (to.endsWith(".tsx") || /^react(?:\/|$)/.test(to))) reject("editor model cannot depend on React views");
  if (from.startsWith("apps/api/src/domain/") && to.startsWith("apps/api/src/server/")) reject("domain code cannot depend on HTTP routes");
  if (from.startsWith("apps/api/src/infrastructure/") && /^apps\/api\/src\/(domain|server)\//.test(to)) reject("infrastructure cannot depend on domain or HTTP code");
  if (sourceRoots.some(prefix => from.startsWith(prefix)) && /(^|\/)tests?\//.test(to)) reject("production code cannot import tests");
  if (target && !typeOnly) graph.get(file).add(target);
}

for (const file of sourceRoots.flatMap(directory => files(join(root, directory)))) {
  graph.set(file, new Set());
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = ts.isImportDeclaration(node) ? node.importClause : node;
      const bindings = ts.isImportDeclaration(node) ? clause?.namedBindings : node.exportClause;
      const allTypes = bindings && (ts.isNamedImports(bindings) || ts.isNamedExports(bindings)) && bindings.elements.length > 0 && bindings.elements.every(item => item.isTypeOnly);
      checkImport(file, node.moduleSpecifier.text, !!clause?.isTypeOnly || (!!allTypes && !clause?.name));
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(node.arguments[0])) {
      checkImport(file, node.arguments[0].text, false);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}

const visited = new Set();
const active = new Set();
function visit(file, chain) {
  if (active.has(file)) {
    failures.push(`runtime import cycle: ${[...chain.slice(chain.indexOf(file)), file].map(name).join(" → ")}`);
    return;
  }
  if (visited.has(file)) return;
  active.add(file);
  for (const target of graph.get(file) ?? []) visit(target, [...chain, file]);
  active.delete(file);
  visited.add(file);
}
for (const file of graph.keys()) visit(file, []);

for (const retired of ["apps/api/src/domain/agent", "apps/web/src/features/agent", "packages/shared/src/agent.ts", "apps/api/src/smoke"]) {
  if (existsSync(join(root, retired))) failures.push(`retired entry point still exists: ${retired}`);
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Architecture checks passed (${graph.size} source modules; no runtime import cycles).`);
}
