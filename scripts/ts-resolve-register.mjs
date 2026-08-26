// Registers the resolver hook above for `node --test`.
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./ts-resolve.mjs", pathToFileURL("./scripts/"));
