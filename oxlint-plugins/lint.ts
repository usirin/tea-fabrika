// `pnpm lint`'s first step: oxlint, with one difference. Oxlint has two levels, warn and error, and
// this repo needs a third: printed, and never failing. So oxlint reports everything as JSON here,
// and this prints all of it and fails on all of it but the two advice rules.
//
// Why one run and not two: an `oxlint-disable` that names a rule turned off counts as unused. A
// second run for the advice rules would turn their own disable comments into failures of the first.
import {spawnSync} from "node:child_process";
import {join} from "node:path";

const ADVICE = new Set(["fabrika(no-effect-promise)", "fabrika(no-raw-try-catch)"]);

interface Diagnostic {
	readonly code?: string;
	readonly message: string;
	readonly filename?: string;
	readonly labels?: readonly {readonly span: {readonly line: number; readonly column: number}}[];
}

const ROOT = join(import.meta.dirname, "..");
const ran = spawnSync(
	join(ROOT, "node_modules", ".bin", "oxlint"),
	["--format=json", ...process.argv.slice(2)],
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
