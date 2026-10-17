// tsh on real pull requests, read only: the launcher as a person runs it
// (`bin/tsh -c '…'`), each line in a fresh home.
//
//   node experiments/67-tsh-real.ts
//
// It needs `gh` signed in, for reads. No model, no key, no writes: tsh's ship
// takes `--mode read` alone, and its write side is `noWrites`. The accounts
// ship counts as the repo's own are read from the pull requests' authors at
// run time, handed to tsh in TSH_OWN, and never saved: the script refuses to
// save a result that holds one. It writes `results/67-tsh.json`.
import {execFileSync, spawnSync} from "node:child_process";
import {mkdtempSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";

const REPO = "kamp-us/demlik";
const PRS = [597, 596, 675] as const;
const url = (n: number) => `https://github.com/${REPO}/pull/${n}`;
const TSH = fileURLToPath(new URL("../bin/tsh", import.meta.url));
const RUBRICS = fileURLToPath(new URL("../fixtures/review/rubrics", import.meta.url));

const own = [
	...new Set(
		PRS.map((n) =>
			execFileSync(
				"gh",
				["pr", "view", String(n), "-R", REPO, "--json", "author", "-q", ".author.login"],
				{
					encoding: "utf8",
				},
			).trim(),
		),
	),
];

const REVIEW = `review-scripted --rubrics ${RUBRICS} --model opus --effort medium --budget 1`;
const CASES = [
	{name: "describe ship", line: "ship --describe"},
	{name: "describe review", line: "review-scripted --describe"},
	{name: "describe one output whole", line: "ship --describe found"},
	{
		name: "review then ship, read only",
		line: `${REVIEW} ${PRS.map((n) => `pr=${url(n)}`).join(" ")} | ship --mode read`,
		json: true,
	},
	{
		name: "review then ship, read only, as a person sees it",
		line: `${REVIEW} ${PRS.map((n) => `pr=${url(n)}`).join(" ")} | ship --mode read`,
	},
	{name: "write mode refused", line: `ship --mode write pr=${url(PRS[0])}`},
	{name: "a pipe that does not fit, refused", line: "seq --to 3 | ship --mode read"},
	{
		name: "a pipe that fits on paper and fails at run time",
		line: "say --text hello | ship --mode read",
	},
] as const;

/** One printed line of a program: `<program> <output> <json>`. */
const parsed = (line: string) => {
	const [program = "", output = "", ...rest] = line.split(" ");
	const json = rest.join(" ");
	return json.startsWith("{")
		? {program, output, value: JSON.parse(json) as Record<string, unknown>}
		: null;
};

const runs = CASES.map(
	(c: {readonly name: string; readonly line: string; readonly json?: true}) => {
		const began = performance.now();
		const done = spawnSync(TSH, [...(c.json === true ? ["--json"] : []), "-c", c.line], {
			encoding: "utf8",
			env: {
				...process.env,
				TSH_HOME: mkdtempSync(join(tmpdir(), "tsh-67-")),
				TSH_OWN: own.join(","),
			},
			timeout: 300_000,
		});
		const ms = Math.round(performance.now() - began);
		const lines = done.stdout.split("\n").filter((l) => l !== "");
		const printed = lines.map(parsed);
		const summary = printed.every((p) => p === null)
			? {out: lines, err: done.stderr.split("\n").filter((l) => l !== "")}
			: {
					err: done.stderr.split("\n").filter((l) => l !== ""),
					said: printed.flatMap((p) => {
						if (p === null) return [];
						const v = p.value;
						const facts = v.facts as Record<string, unknown> | undefined;
						const wouldSend = v.wouldSend as Record<string, unknown> | null | undefined;
						return [
							{
								program: p.program,
								output: p.output,
								pr: Number(String(v.pr).split("/").at(-1)),
								name: v.name ?? null,
								...(facts === undefined
									? {}
									: {
											ours: facts.ours,
											mergeable: facts.mergeable,
											checks: facts.checks,
											reviews: facts.reviews,
										}),
								...(wouldSend === undefined ? {} : {wouldSend: wouldSend?.type ?? null}),
							},
						];
					}),
				};
		console.log(`\n$ tsh -c '${c.name}'  status ${done.status}  ${ms} ms`);
		console.log(lines.map((l) => (l.length > 140 ? `${l.slice(0, 140)}…` : l)).join("\n"));
		if (done.stderr !== "") console.log(done.stderr.trimEnd());
		return {
			case: c.name,
			line: c.line.replace(RUBRICS, "fixtures/review/rubrics"),
			status: done.status,
			ms,
			...summary,
		};
	},
);

const text = `${JSON.stringify({date: new Date().toISOString().slice(0, 10), repo: REPO, prs: PRS, runs}, null, "\t")}\n`;
const leaked = own.filter(
	(login) => login !== "" && text.toLowerCase().includes(login.toLowerCase()),
);
if (leaked.length > 0) {
	console.error(`not saved: the result names ${leaked.length} account(s)`);
	process.exit(1);
}
writeFileSync(new URL("./results/67-tsh.json", import.meta.url), text);
console.log("\nSaved results/67-tsh.json");
