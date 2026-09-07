// Node module customization hook (register()'d via node:module) letting `node --test` import
// this project's TypeScript lib/server and lib/domain modules directly, including their real
// runtime cross-file imports and "@/" alias - neither of which the existing
// transpileModule-into-a-data-URL trick (tests/organizing.test.mjs) supports, since that trick
// only works for a single file whose only cross-file imports are `import type` (erased entirely
// by transpilation, so there's nothing left to resolve). commands.ts needs real, executable
// imports from contracts.ts and repository.ts, so this exists instead.
//
// Two things this does that plain Node can't: resolve the "@/" alias to the project root (the
// same mapping Vite/vinext apply at build time - see vite.config.ts), and strip TypeScript
// syntax via the `typescript` package already used elsewhere in this repo (tests/organizing.test.mjs).
// It does NOT type-check - these tests still run `npm run typecheck` separately for that.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const PROJECT_ROOT = fileURLToPath(new URL("../../", import.meta.url));

function withTsExtensionIfNeeded(absPath) {
  return /\.[a-zA-Z0-9]+$/.test(absPath) ? absPath : `${absPath}.ts`;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const abs = withTsExtensionIfNeeded(path.join(PROJECT_ROOT, specifier.slice(2)));
    return { url: pathToFileURL(abs).href, shortCircuit: true };
  }
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[a-zA-Z0-9]+$/.test(specifier)) {
    const parentPath = fileURLToPath(context.parentURL);
    const abs = withTsExtensionIfNeeded(path.join(path.dirname(parentPath), specifier));
    if (existsSync(abs)) return { url: pathToFileURL(abs).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith(".ts")) {
    const filePath = fileURLToPath(url);
    const source = readFileSync(filePath, "utf8");
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      fileName: filePath,
    });
    return { format: "module", source: outputText, shortCircuit: true };
  }
  return nextLoad(url, context);
}
