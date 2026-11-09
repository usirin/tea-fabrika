// `pnpm lint`'s first step: oxlint, with one difference. Oxlint has two levels, warn and error, and
// this repo needs a third: printed, and never failing. So oxlint reports everything as JSON here,
// and this prints all of it and fails on all of it but the advice rules.
//
// Why one run and not two: an `oxlint-disable` that names a rule turned off counts as unused. A
// second run for the advice rules would turn their own disable comments into failures of the first.
import {spawnSync} from "node:child_process";
import {readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";
import {checkTracked} from "./gitignore.mjs";
import {scriptReads} from "./script-reads.mjs";

const ADVICE = new Set([
	"fabrika(no-effect-promise)",
	"fabrika(no-raw-try-catch)",
	"fabrika(prefer-schema-arbitrary)",
]);

interface Diagnostic {
	readonly code?: string;
	readonly message: string;
	readonly filename?: string;
	readonly labels?: readonly {readonly span: {readonly line: number; readonly column: number}}[];
}

const ROOT = join(import.meta.dirname, "..");
const scripts = readdirSync(join(ROOT, ".agents/skills"), {recursive: true, withFileTypes: true})
	.filter((entry) => entry.isFile())
	.map((entry) => join(entry.parentPath, entry.name).slice(ROOT.length + 1))
	.filter((path) => /^\.agents\/skills\/[^/]+\/scripts\//.test(path));
const missing = scriptReads(
	new Map(scripts.map((path) => [path, readFileSync(join(ROOT, path), "utf8")])),
);
for (const row of missing)
	console.error(`${row.test}: declare ${row.path}?raw, read through ${row.via}`);
if (missing.length) process.exit(1);

// A `.gitignore` hides a file from oxlint and oxfmt, and neither can be told to stop without also
// walking into `node_modules`. Git keeps a tracked file tracked under a new `.gitignore`, so one line
// in one could take a whole folder out of the checks. Only `.gitignore` files count here, not this
// machine's own ignore list.
const hidden = checkTracked();
if (!hidden.ok) {
	console.error(
		`Git failed or a .gitignore hides tracked files from the lint and format checks: ${hidden.files.map((file: string) => JSON.stringify(file)).join(", ")}`,
	);
	process.exit(2);
}

// The one config at the top of the repo, on purpose. On its own, oxlint obeys a config in any folder
// and a `.eslintignore` where it runs, and either could take a folder out of the checks. The config's
// own `ignorePatterns` still apply, and those are read in review.
const ran = spawnSync(
	join(ROOT, "node_modules", ".bin", "oxlint"),
	[
		`--config=${join(ROOT, ".oxlintrc.json")}`,
		"--disable-nested-config",
		"--no-ignore",
		"--format=json",
		...process.argv.slice(2),
	],
	{cwd: process.cwd(), encoding: "utf8", maxBuffer: 2 ** 30},
);

/** What oxlint said, or `null` when it did not finish and report: that must never read as clean. */
const read = (): readonly Diagnostic[] | null => {
	try {
		const report: {
			readonly diagnostics?: readonly Diagnostic[];
			readonly number_of_files?: number;
		} = JSON.parse(ran.stdout);
		return report.diagnostics !== undefined && report.number_of_files !== 0
			? report.diagnostics
			: null;
	} catch {
		return null;
	}
};

const diagnostics = read();
if (diagnostics === null) {
	console.error(`oxlint did not finish: status ${ran.status}\n${ran.stdout}\n${ran.stderr}`);
	process.exit(2);
}

const where = ({filename, labels}: Diagnostic) => {
	const at = labels?.[0]?.span;
	return at === undefined ? (filename ?? "") : `${filename}:${at.line}:${at.column}`;
};
const blocks = diagnostics.filter((d) => !ADVICE.has(d.code ?? ""));
const advises = diagnostics.filter((d) => ADVICE.has(d.code ?? ""));
for (const d of [...advises, ...blocks]) console.log(`${where(d)} ${d.code ?? ""} ${d.message}`);
console.log(`oxlint: ${blocks.length} blocking, ${advises.length} advice`);
process.exit(blocks.length === 0 ? 0 : 1);
