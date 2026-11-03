// `pnpm format` and `pnpm lint`'s format check: oxfmt, with its settings pinned to the one at the top
// of the repo. On its own, oxfmt obeys a `.oxfmtrc.json` in any folder and a `.prettierignore` where
// it runs, so a plain file could take code out of the check.
//
// A `.gitignore` is still obeyed, because generated folders need it. `lint.ts` fails when one hides
// a tracked file.
import {spawnSync} from "node:child_process";
import {join} from "node:path";

const ROOT = join(import.meta.dirname, "..");
const ran = spawnSync(
	join(ROOT, "node_modules", ".bin", "oxfmt"),
	[
		`--config=${join(ROOT, ".oxfmtrc.json")}`,
		"--disable-nested-config",
		`--ignore-path=${join(ROOT, ".gitignore")}`,
		...process.argv.slice(2),
	],
	{stdio: "inherit"},
);
process.exit(ran.status ?? 2);
