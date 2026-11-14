// `pnpm format` and `pnpm lint`'s format check: oxfmt, with its settings pinned to the one at the top
// of the repo. On its own, oxfmt obeys a `.oxfmtrc.json` in any folder and a `.prettierignore` where
// it runs, so a plain file could take code out of the check.
//
// A `.gitignore` is still obeyed, because generated folders need it. `lint.ts` fails when one hides
// a tracked file.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { liveRoots } from "./frozen.mjs";

const ROOT = join(import.meta.dirname, "..");

/**
 * What oxfmt is started with. A path run formats exactly the paths given. A whole run, with flags
 * alone, formats every top-level entry that is not today's frozen version (0525).
 * @param args what `format.ts` was given
 * @param entries the names `readdirSync` gives for the folder oxfmt runs in
 */
export const oxfmtArgs = (args: readonly string[], entries: readonly string[]): string[] => [
  `--config=${join(ROOT, ".oxfmtrc.json")}`,
  "--disable-nested-config",
  `--ignore-path=${join(ROOT, ".gitignore")}`,
  ...args,
  ...(args.every((arg) => arg.startsWith("-")) ? liveRoots(entries) : []),
];

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const ran = spawnSync(
    join(ROOT, "node_modules", ".bin", "oxfmt"),
    oxfmtArgs(process.argv.slice(2), readdirSync(process.cwd())),
    {
      stdio: "inherit",
    },
  );

  process.exit(ran.status ?? 2);
}
