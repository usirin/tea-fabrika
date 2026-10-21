// Experiment 112's inputs, taken once from what 105b's four real passes left on disk: each pass's
// host log (`lines-real.jsonl`) and its bare repository. From the log: the plan the planner drafted,
// and every review's rows and what it found, in order. From the repository: a git bundle, so the
// commits can be cloned again with nothing else kept.
//
//   node experiments/112-reviewer-noise/extract.ts <pass>=<105 scratch folder> ...
//
// e.g. `pass2=$TMPDIR/exp105-uoptrZ`. Writes `inputs.json` and `repos/<pass>.bundle` beside this
// file. A finding is kept as the log has it: the text an open item with no criterion id carries,
// which is the finding's `wants`, the words the book keeps for it (criteria/book.ts, `withRound`).
//
// Node at the edge: the log is read with readFileSync, git through execFileSync.
import {execFileSync} from "node:child_process";
import {mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {fileURLToPath} from "node:url";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

interface LogRow {
	readonly criterion: string;
	readonly version: number;
	readonly grade: "pass" | "fail";
}
interface LogOpen {
	readonly criterion: string | null;
	readonly text: string;
}
interface LogOutcome {
	readonly name: string;
	readonly head?: string;
	readonly rows?: readonly LogRow[];
	readonly open?: readonly LogOpen[];
	readonly draft?: unknown;
}

/** One review as the lane ran it: its child's name, the head, its rows, and what it found. */
export interface Judged {
	readonly name: string;
	readonly ended: string;
	readonly head: string;
	readonly rows: readonly LogRow[];
	readonly found: readonly string[];
}

export interface PassInput {
	readonly draft: unknown;
	readonly reviews: readonly Judged[];
}

const passes = process.argv.slice(2).map((arg) => {
	const [pass, folder] = arg.split("=");
	if (pass === undefined || folder === undefined) throw new Error(`not <pass>=<folder>: ${arg}`);
	return {pass, folder};
});

const inputs: Record<string, PassInput> = {};
mkdirSync(here("repos"), {recursive: true});
for (const {pass, folder} of passes) {
	let draft: unknown = null;
	const reviews: Judged[] = [];
	for (const text of readFileSync(join(folder, "lines-real.jsonl"), "utf8").split("\n")) {
		if (text === "") continue;
		const line = JSON.parse(text) as {ev?: string; name?: string; outcome?: LogOutcome};
		if (line.ev !== "outcome" || line.name === undefined || line.outcome === undefined) continue;
		const o = line.outcome;
		if (/^lane:\d+:v\d+:plan$/.test(line.name) && o.draft !== undefined) draft = o.draft;
		if (line.name.endsWith(":review") && o.head !== undefined)
			reviews.push({
				name: line.name,
				ended: o.name,
				head: o.head,
				rows: o.rows ?? [],
				found: (o.open ?? []).filter((x) => x.criterion === null).map((x) => x.text),
			});
	}
	if (draft === null) throw new Error(`${pass}: no plan in the log`);
	inputs[pass] = {draft, reviews};
	execFileSync("git", [
		"-C",
		join(folder, "repo-1.git"),
		"bundle",
		"create",
		here(`repos/${pass}.bundle`),
		"--all",
	]);
	console.log(`${pass}: ${reviews.length} reviews`);
}
writeFileSync(here("inputs.json"), `${JSON.stringify(inputs, null, "\t")}\n`);
