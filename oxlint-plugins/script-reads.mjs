import { posix } from "node:path";
import { buildSync } from "esbuild";

/**
 * Today's tooling. Match script basenames even in comments and shell strings.
 * @param {ReadonlyMap<string, string>} tree repo paths under skill scripts folders
 * @returns {{test: string, path: string, via: string}[]}
 */
export const scriptReads = (tree) => {
  const scripts = [...tree.keys()].filter((path) => !path.endsWith(".test.ts"));
  const names = scripts.map((path) => ({
    path,
    word: new RegExp(`(?<![\\w.-])${posix.basename(path).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w.-])`),
  }));
  const missing = [];

  for (const [test, text] of tree) {
    if (!test.endsWith(".test.ts")) {
      continue;
    }

    // Parse imports so comments and fixture strings cannot declare a dependency.
    const parsed = buildSync({
      stdin: { contents: text, sourcefile: test, loader: "ts" },
      format: "esm",
      metafile: true,
      write: false,
      // Keep unused value imports: these declarations exist for the affected walk.
      tsconfigRaw: { compilerOptions: { verbatimModuleSyntax: true } },
    });
    const declared = new Set(
      Object.values(parsed.metafile.outputs)
        .flatMap((output) => output.imports)
        .filter((entry) => entry.kind === "import-statement")
        .map(({ path }) => posix.normalize(posix.join(posix.dirname(test), path.replace(/\?raw$/, "")))),
    );
    const seen = new Set([test]);
    const queue = [test];

    for (const via of queue) {
      const source = tree.get(via) ?? "";

      for (const { path, word } of names) {
        if (seen.has(path) || !word.test(source)) {
          continue;
        }

        seen.add(path);
        queue.push(path);

        if (!declared.has(path)) {
          missing.push({ test, path, via });
        }
      }
    }
  }

  return missing;
};
