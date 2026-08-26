// Minimal ESM resolver so `node --test` can run the app's own modules.
//
// Next's bundler resolves extensionless relative imports and the `@/` alias;
// Node's loader does neither. Rather than pull in a test framework and a second
// build pipeline just to run assertions over the ledger maths, this teaches the
// built-in runner the same two rules.
import { pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";

const SRC = pathToFileURL(path.join(process.cwd(), "src") + path.sep).href;

export function resolve(specifier, context, next) {
  // Next imports `.json` bare; Node demands an explicit import attribute.
  if (specifier.endsWith(".json")) {
    context = { ...context, importAttributes: { type: "json" } };
  }

  // `@/lib/foo` -> `<cwd>/src/lib/foo`
  if (specifier.startsWith("@/")) {
    return resolve(new URL(specifier.slice(2), SRC).href, context, next);
  }

  // Extensionless relative import -> try .ts, then .tsx.
  if (/^\.{1,2}\//.test(specifier) || specifier.startsWith("file:")) {
    const url = specifier.startsWith("file:")
      ? new URL(specifier)
      : new URL(specifier, context.parentURL);
    if (!path.extname(url.pathname)) {
      for (const ext of [".ts", ".tsx", ".js"]) {
        const candidate = new URL(url.href + ext);
        if (fs.existsSync(candidate)) return next(candidate.href, context);
      }
    }
    return next(url.href, context);
  }

  return next(specifier, context);
}

export function load(url, context, next) {
  if (url.endsWith(".json")) {
    context = { ...context, importAttributes: { type: "json" } };
  }
  return next(url, context);
}
