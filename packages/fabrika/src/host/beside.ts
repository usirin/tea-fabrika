// A file beside a module, named without its extension. Run from the source, the module is a `.ts`
// file and so is the file beside it; run from the build (`dist/`), both are `.js`. A child process
// or a Miniflare worker is started from a path, and no build rewrites a path in a string, so the
// path takes the extension of the module asking for it.
//
// Node at the edge: a file path from a URL.
import {fileURLToPath} from "node:url";

/** The path of `name` (no extension) beside the module whose `import.meta.url` is `from`. */
export const beside = (from: string, name: string): string =>
	fileURLToPath(new URL(`./${name}${from.slice(from.lastIndexOf("."))}`, from));
