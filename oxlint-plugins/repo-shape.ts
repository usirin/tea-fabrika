// `pnpm lint:shape`: the repo stays as clean as the cleanup left it, by code
// (.decisions/0003-a-clean-repo-kept-clean-by-code.md). Three checks on what git tracks:
//
//   root     a top-level file or folder not on ROOT. A new one is one line here, in the same change.
//   made     a build or run leftover: `dist/`, `out/`, `coverage/`, `node_modules/`, `.DS_Store`, and
//            files ending `.log`, `.out` or `.tsbuildinfo`. `experiments/results/` is a record and is let be.
//   big      a non-image file over 1 MB that is not on BIG. An image is never counted here.
//
//   node oxlint-plugins/repo-shape.ts            # this repo
//   node oxlint-plugins/repo-shape.ts <folder>   # another git tree, as the test does
//
// Exit 0 when clean, 1 on a finding, 2 when it could not read the tree.
import {spawnSync} from "node:child_process";
import {lstatSync} from "node:fs";
import {basename, join} from "node:path";

/** Every top-level entry git tracks. A folder or a file; the name is all that is checked. */
const ROOT: ReadonlySet<string> = new Set([
	".agents",
	".claude",
	".decisions",
	".fabrika",
	".git-blame-ignore-revs",
	".gitattributes",
	".github",
	".gitignore",
	".glossary",
	".oxfmtrc.json",
	".oxlintrc.json",
	".patterns",
	"AGENTS.md",
	"CLAUDE.md",
	"README.md",
	"adapters",
	"allowed_signers",
	"apps",
	"bin",
	"boundary-rules.json",
	"compiler-ledger.json",
	"docs",
	"exam-paths.json",
	"experiments",
	"field",
	"fixtures",
	"jaeger",
	"layer-rules.json",
	"next",
	"node-kinds.json",
	"oxlint-plugins",
	"package.json",
	"packages",
	"patches",
	"pnpm-lock.yaml",
	"pnpm-workspace.yaml",
	"programs",
	"promises",
	"stylelint.config.ts",
	"tsconfig.base.json",
	"tsconfig.json",
	"unreachable-ledger.json",
	"vitest.config.ts",
	"vitest.shards.test.ts",
	"vitest.shards.ts",
]);

/** The non-image files over 1 MB that are kept on purpose: records, not leftovers. */
const BIG: ReadonlySet<string> = new Set([
	"field/runs.jsonl",
	"experiments/results/dup-probe-controls.json",
	"experiments/results/dup-probe.json",
	"experiments/results/missing-probe-package-control.json",
	"experiments/results/missing-probe-package.json",
]);

const LIMIT = 1_000_000;
const IMAGE = /\.(png|jpe?g|gif|webp)$/i;
const MADE_FOLDER = new Set(["dist", "out", "coverage", "node_modules"]);
const MADE_FILE = /(\.log|\.out|\.tsbuildinfo)$/;

const madeBy = (path: string): boolean =>
	path.split("/").some((part) => MADE_FOLDER.has(part)) ||
	basename(path) === ".DS_Store" ||
	MADE_FILE.test(path);

const root = process.argv[2] ?? join(import.meta.dirname, "..");
const tracked = spawnSync("git", ["ls-files", "-z"], {
	cwd: root,
	encoding: "utf8",
	maxBuffer: 2 ** 30,
});
const files = tracked.stdout.split("\0").filter((file) => file !== "");
// No file read must never read as clean.
if (tracked.status !== 0 || files.length === 0) {
	console.error(`repo-shape: git found no files to check.\n${tracked.stderr}`);
	process.exit(2);
}

const sizeOf = (path: string): number => {
	const stat = lstatSync(join(root, path), {throwIfNoEntry: false});
	return stat?.isFile() ? stat.size : 0;
};

const unlisted = [...new Set(files.map((file) => file.split("/")[0] ?? file))]
	.filter((name) => !ROOT.has(name))
	.map((name) => `root: ${name} is not on the root list (oxlint-plugins/repo-shape.ts)`);
const made = files
	.filter((file) => !file.startsWith("experiments/results/") && madeBy(file))
	.map((file) => `made: ${file} is a build or run leftover; remove it and ignore it`);
const big = files
	.filter((file) => !IMAGE.test(file) && !BIG.has(file) && sizeOf(file) > LIMIT)
	.map((file) => `big: ${file} is over 1 MB; keep it small, or list it in BIG on purpose`);

const lines = [...unlisted, ...made, ...big];
for (const line of lines) console.error(line);
if (lines.length > 0) {
	console.error(`repo-shape: ${lines.length} finding(s).`);
	process.exit(1);
}
console.log(`repo-shape: ${files.length} files, ${ROOT.size} root entries, nothing stray`);
